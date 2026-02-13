import type {
  MetaMessage,
  CommunityConfig,
  ChannelCreated,
  Announcement,
  StateSnapshot,
} from "./meta-types.js";

export interface ChannelState {
  channelId: string;
  name: string;
  description?: string;
  xmtpGroupId: string;
  category?: string;
  permissions: "open" | "moderated" | "read-only";
  archived: boolean;
}

export interface CommunityState {
  config: CommunityConfig | null;
  channels: Map<string, ChannelState>;
  roles: Map<string, "owner" | "admin" | "moderator" | "member">;
  /** Maps DID → inboxId for auth context. Populated from role assignments that include targetInboxId. */
  roleInboxIds: Map<string, string>;
  /** Bans by DID (from targetDid in moderation actions). */
  bans: Set<string>;
  /** Bans by inboxId (from targetInboxId in moderation actions). Used for sender enforcement. */
  bannedInboxIds: Set<string>;
  announcements: Announcement[];
}

export interface SenderTaggedMessage {
  message: MetaMessage;
  senderInboxId: string;
}

/**
 * Authorization context tracked during replay with sender info.
 * Maps inboxIds to their roles so we can check permissions.
 */
interface AuthContext {
  /** The inboxId of the community creator (first config sender). */
  creatorInboxId: string | null;
  /** Maps inboxId -> role for authorization checks. */
  authorizedSenders: Map<string, "owner" | "admin" | "moderator" | "member">;
}

export function createEmptyState(): CommunityState {
  return {
    config: null,
    channels: new Map(),
    roles: new Map(),
    roleInboxIds: new Map(),
    bans: new Set(),
    bannedInboxIds: new Set(),
    announcements: [],
  };
}

/**
 * Original replay function without sender authorization.
 * @deprecated Use `replayMetaChannelWithSenders` in production code.
 * This function does NOT verify sender permissions — any message is
 * blindly applied. It exists only for backward-compatible test helpers.
 * @internal
 */
export function replayMetaChannel(messages: MetaMessage[]): CommunityState {
  const state = createEmptyState();

  for (const msg of messages) {
    applyMetaMessage(state, msg);
  }

  return state;
}

/**
 * Replay meta channel with sender authorization.
 * Each message is tagged with the sender's inboxId.
 * Messages from unauthorized senders are silently ignored.
 */
export function replayMetaChannelWithSenders(
  messages: SenderTaggedMessage[],
): CommunityState {
  const state = createEmptyState();
  const authCtx: AuthContext = {
    creatorInboxId: null,
    authorizedSenders: new Map(),
  };

  for (const tagged of messages) {
    applyMetaMessageWithAuth(state, tagged, authCtx);
  }

  return state;
}

/**
 * Check if a sender has at least the required role level.
 * Role hierarchy: owner > admin > moderator > member
 */
function hasMinRole(
  authCtx: AuthContext,
  senderInboxId: string,
  minRole: "owner" | "admin" | "moderator" | "member",
): boolean {
  // The creator is always implicitly super_admin (treated as owner)
  if (senderInboxId === authCtx.creatorInboxId) {
    return true;
  }

  const senderRole = authCtx.authorizedSenders.get(senderInboxId);
  if (!senderRole) {
    return minRole === "member"; // unknown senders have no role
  }

  const hierarchy: Record<string, number> = {
    owner: 4,
    admin: 3,
    moderator: 2,
    member: 1,
  };

  return hierarchy[senderRole] >= hierarchy[minRole];
}

/**
 * Apply a meta message with sender authorization checks.
 * Updates both the community state and the auth context.
 */
function applyMetaMessageWithAuth(
  state: CommunityState,
  tagged: SenderTaggedMessage,
  authCtx: AuthContext,
): void {
  const { message: msg, senderInboxId } = tagged;

  // Banned senders are silently ignored for all message types.
  // Check both bannedInboxIds (preferred, matches senderInboxId directly)
  // and bans (fallback, for when targetDid happens to equal senderInboxId).
  // Exception: the creator can never be effectively banned.
  if (senderInboxId !== authCtx.creatorInboxId) {
    if (state.bannedInboxIds.has(senderInboxId) || state.bans.has(senderInboxId)) {
      return;
    }
  }

  switch (msg.type) {
    case "community.config": {
      // The FIRST message in the meta channel bootstraps the community.
      // If no creator has been established yet, accept and establish creator.
      if (authCtx.creatorInboxId === null) {
        authCtx.creatorInboxId = senderInboxId;
        state.config = msg;
      } else if (hasMinRole(authCtx, senderInboxId, "admin")) {
        state.config = msg;
      }
      // else: silently ignored (unauthorized)
      break;
    }

    case "channel.created": {
      if (!hasMinRole(authCtx, senderInboxId, "admin")) break;
      state.channels.set(msg.channelId, {
        channelId: msg.channelId,
        name: msg.name,
        description: msg.description,
        xmtpGroupId: msg.xmtpGroupId,
        category: msg.category,
        permissions: msg.permissions,
        archived: false,
      });
      break;
    }

    case "channel.updated": {
      if (!hasMinRole(authCtx, senderInboxId, "admin")) break;
      const existing = state.channels.get(msg.channelId);
      if (existing) {
        if (msg.name !== undefined) existing.name = msg.name;
        if (msg.description !== undefined)
          existing.description = msg.description;
        if (msg.category !== undefined) existing.category = msg.category;
        if (msg.permissions !== undefined)
          existing.permissions = msg.permissions;
      }
      break;
    }

    case "channel.archived": {
      if (!hasMinRole(authCtx, senderInboxId, "admin")) break;
      const ch = state.channels.get(msg.channelId);
      if (ch) ch.archived = true;
      break;
    }

    case "community.role": {
      // Only the creator or admin+ can assign roles.
      if (!hasMinRole(authCtx, senderInboxId, "admin")) break;
      // Reject empty/whitespace-only target identifiers.
      if (!msg.targetDid || !msg.targetDid.trim()) break;
      if (msg.targetInboxId !== undefined && !msg.targetInboxId.trim()) break;

      const hierarchy: Record<string, number> = {
        owner: 4,
        admin: 3,
        moderator: 2,
        member: 1,
      };

      // Enforce role hierarchy (creator bypasses all checks).
      if (senderInboxId !== authCtx.creatorInboxId) {
        const senderLevel = hierarchy[
          authCtx.authorizedSenders.get(senderInboxId) ?? "member"
        ] ?? 0;
        const newRoleLevel = hierarchy[msg.role] ?? 0;

        // 1. Cannot assign a role higher than your own level.
        if (newRoleLevel > senderLevel) break;

        // 2. Cannot modify users at or above your own level.
        //    (Prevents admins from demoting owners or peer admins.)
        //    Check both targetInboxId and targetDid — the target may have been
        //    registered under either key depending on how the original role was assigned.
        const targetRoleByInboxId = msg.targetInboxId
          ? authCtx.authorizedSenders.get(msg.targetInboxId)
          : undefined;
        const targetRoleByDid = authCtx.authorizedSenders.get(msg.targetDid);
        const targetCurrentRole = targetRoleByInboxId ?? targetRoleByDid;
        if (targetCurrentRole) {
          const targetCurrentLevel = hierarchy[targetCurrentRole] ?? 0;
          if (targetCurrentLevel >= senderLevel) break;
        }
      }

      state.roles.set(msg.targetDid, msg.role);
      // Track the DID→inboxId mapping for snapshot rebuilds
      if (msg.targetInboxId) {
        state.roleInboxIds.set(msg.targetDid, msg.targetInboxId);
      }

      // Update the auth context. Prefer targetInboxId (the actual XMTP identity)
      // for authorization lookups. Fall back to targetDid for backward compat
      // (when targetDid happens to contain an inboxId).
      const authKey = msg.targetInboxId ?? msg.targetDid;
      authCtx.authorizedSenders.set(authKey, msg.role);
      break;
    }

    case "community.announcement": {
      if (!hasMinRole(authCtx, senderInboxId, "admin")) break;
      state.announcements.push(msg);
      break;
    }

    case "moderation.action": {
      if (!hasMinRole(authCtx, senderInboxId, "moderator")) break;

      // For ban/unban: enforce that the target's role is below the sender's.
      // Prevents moderators from banning admins/owners.
      if ((msg.action === "ban" || msg.action === "unban") && msg.targetDid?.trim()) {
        if (senderInboxId !== authCtx.creatorInboxId) {
          const modHierarchy: Record<string, number> = {
            owner: 4, admin: 3, moderator: 2, member: 1,
          };
          const senderLevel = modHierarchy[
            authCtx.authorizedSenders.get(senderInboxId) ?? "member"
          ] ?? 0;
          // Check target's role by both DID and inboxId (target may be known by either key)
          const targetRoleByInboxId = msg.targetInboxId
            ? authCtx.authorizedSenders.get(msg.targetInboxId)
            : undefined;
          const targetRoleByDid = authCtx.authorizedSenders.get(msg.targetDid!);
          const targetRole = targetRoleByInboxId ?? targetRoleByDid;
          const targetLevel = modHierarchy[targetRole ?? "member"] ?? 0;
          if (targetLevel >= senderLevel) break; // Cannot ban/unban peers or superiors
        }

        if (msg.action === "ban") {
          state.bans.add(msg.targetDid);
          if (msg.targetInboxId) {
            state.bannedInboxIds.add(msg.targetInboxId);
          }
        } else {
          state.bans.delete(msg.targetDid);
          if (msg.targetInboxId) {
            state.bannedInboxIds.delete(msg.targetInboxId);
          }
        }
      }
      // Other moderation actions (redact, mute) don't have the same level restriction
      break;
    }

    case "community.snapshot": {
      // Snapshots require admin+ authorization. A snapshot should never be
      // the first message that bootstraps creator authority — that's the
      // job of community.config. If no creator is established yet, reject
      // the snapshot (a rogue member could race the admin to send one,
      // granting themselves implicit creator status).
      if (authCtx.creatorInboxId === null) {
        break; // No creator yet — only community.config can bootstrap
      }
      if (!hasMinRole(authCtx, senderInboxId, "admin")) {
        break;
      }
      // Snapshot replaces state wholesale
      state.config = {
        type: "community.config" as const,
        name: msg.config.name,
        description: msg.config.description,
        settings: msg.config.settings,
      };
      state.channels.clear();
      for (const ch of msg.channels) {
        state.channels.set(ch.channelId, {
          channelId: ch.channelId,
          name: ch.name,
          description: ch.description,
          xmtpGroupId: ch.xmtpGroupId,
          category: ch.category,
          permissions: ch.permissions,
          archived: false,
        });
      }
      state.roles.clear();
      state.roleInboxIds.clear();
      authCtx.authorizedSenders.clear();
      // Preserve the creator
      if (authCtx.creatorInboxId) {
        authCtx.authorizedSenders.set(authCtx.creatorInboxId, "owner");
      }
      for (const r of msg.roles) {
        state.roles.set(r.did, r.role);
        if (r.inboxId) {
          state.roleInboxIds.set(r.did, r.inboxId);
        }
        // Use inboxId for auth context when available (inboxId is what
        // senderInboxId will match against), fall back to did for compat.
        const authKey = r.inboxId ?? r.did;
        authCtx.authorizedSenders.set(authKey, r.role);
      }
      state.bans.clear();
      state.bannedInboxIds.clear();
      for (const did of msg.bans) {
        state.bans.add(did);
      }
      for (const inboxId of msg.bannedInboxIds ?? []) {
        state.bannedInboxIds.add(inboxId);
      }
      break;
    }
  }
}

/**
 * Apply a single meta message without authorization.
 * @deprecated Use `applyMetaMessageWithAuth` (via `replayMetaChannelWithSenders`) in production code.
 * This function does NOT verify sender permissions.
 * @internal
 */
export function applyMetaMessage(
  state: CommunityState,
  msg: MetaMessage,
): void {
  switch (msg.type) {
    case "community.config":
      state.config = msg;
      break;

    case "channel.created":
      state.channels.set(msg.channelId, {
        channelId: msg.channelId,
        name: msg.name,
        description: msg.description,
        xmtpGroupId: msg.xmtpGroupId,
        category: msg.category,
        permissions: msg.permissions,
        archived: false,
      });
      break;

    case "channel.updated": {
      const existing = state.channels.get(msg.channelId);
      if (existing) {
        if (msg.name !== undefined) existing.name = msg.name;
        if (msg.description !== undefined)
          existing.description = msg.description;
        if (msg.category !== undefined) existing.category = msg.category;
        if (msg.permissions !== undefined)
          existing.permissions = msg.permissions;
      }
      break;
    }

    case "channel.archived": {
      const ch = state.channels.get(msg.channelId);
      if (ch) ch.archived = true;
      break;
    }

    case "community.role":
      state.roles.set(msg.targetDid, msg.role);
      if (msg.targetInboxId) {
        state.roleInboxIds.set(msg.targetDid, msg.targetInboxId);
      }
      break;

    case "community.announcement":
      state.announcements.push(msg);
      break;

    case "moderation.action":
      if (msg.action === "ban" && msg.targetDid) {
        state.bans.add(msg.targetDid);
        if (msg.targetInboxId) state.bannedInboxIds.add(msg.targetInboxId);
      } else if (msg.action === "unban" && msg.targetDid) {
        state.bans.delete(msg.targetDid);
        if (msg.targetInboxId) state.bannedInboxIds.delete(msg.targetInboxId);
      }
      break;

    case "community.snapshot":
      // Snapshot replaces state wholesale — used after adding new members
      // so they see current state despite MLS forward secrecy.
      state.config = {
        type: "community.config" as const,
        name: msg.config.name,
        description: msg.config.description,
        settings: msg.config.settings,
      };
      state.channels.clear();
      for (const ch of msg.channels) {
        state.channels.set(ch.channelId, {
          channelId: ch.channelId,
          name: ch.name,
          description: ch.description,
          xmtpGroupId: ch.xmtpGroupId,
          category: ch.category,
          permissions: ch.permissions,
          archived: false,
        });
      }
      state.roles.clear();
      state.roleInboxIds.clear();
      for (const r of msg.roles) {
        state.roles.set(r.did, r.role);
        if (r.inboxId) {
          state.roleInboxIds.set(r.did, r.inboxId);
        }
      }
      state.bans.clear();
      state.bannedInboxIds.clear();
      for (const did of msg.bans) {
        state.bans.add(did);
      }
      for (const inboxId of msg.bannedInboxIds ?? []) {
        state.bannedInboxIds.add(inboxId);
      }
      break;
  }
}
