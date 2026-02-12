import { z } from "zod/v4";

// Limits to prevent DoS via oversized payloads
const MAX_NAME = 200;
const MAX_DESCRIPTION = 5000;
const MAX_ID = 512;
const MAX_CHANNELS = 500;
const MAX_ROLES = 1000;
const MAX_BANS = 5000;

export const CommunityConfigSchema = z.object({
  type: z.literal("community.config"),
  name: z.string().max(MAX_NAME),
  description: z.string().max(MAX_DESCRIPTION).optional(),
  settings: z.object({
    allowMemberInvites: z.boolean(),
    defaultChannelPermissions: z.enum(["open", "moderated"]),
  }),
});

export const ChannelCreatedSchema = z.object({
  type: z.literal("channel.created"),
  channelId: z.string().max(MAX_ID),
  name: z.string().max(MAX_NAME),
  description: z.string().max(MAX_DESCRIPTION).optional(),
  xmtpGroupId: z.string().max(MAX_ID),
  category: z.string().max(MAX_NAME).optional(),
  permissions: z.enum(["open", "moderated", "read-only"]),
});

export const ChannelUpdatedSchema = z.object({
  type: z.literal("channel.updated"),
  channelId: z.string().max(MAX_ID),
  name: z.string().max(MAX_NAME).optional(),
  description: z.string().max(MAX_DESCRIPTION).optional(),
  category: z.string().max(MAX_NAME).optional(),
  permissions: z.enum(["open", "moderated", "read-only"]).optional(),
});

export const ChannelArchivedSchema = z.object({
  type: z.literal("channel.archived"),
  channelId: z.string().max(MAX_ID),
  reason: z.string().max(MAX_DESCRIPTION).optional(),
});

export const RoleAssignmentSchema = z.object({
  type: z.literal("community.role"),
  targetDid: z.string().max(MAX_ID),
  targetInboxId: z.string().max(MAX_ID).optional(), // XMTP inbox ID for auth; use when targetDid is an ATProto DID
  role: z.enum(["owner", "admin", "moderator", "member"]),
});

export const AnnouncementSchema = z.object({
  type: z.literal("community.announcement"),
  title: z.string().max(MAX_NAME),
  body: z.string().max(MAX_DESCRIPTION),
  priority: z.enum(["normal", "important"]),
});

export const ModerationActionSchema = z.object({
  type: z.literal("moderation.action"),
  action: z.enum(["redact", "ban", "unban", "mute"]),
  targetMessageId: z.string().max(MAX_ID).optional(),
  targetDid: z.string().max(MAX_ID).optional(),
  targetInboxId: z.string().max(MAX_ID).optional(), // XMTP inbox ID for ban enforcement; use when targetDid is an ATProto DID
  reason: z.string().max(MAX_DESCRIPTION).optional(),
  channelId: z.string().max(MAX_ID).optional(),
});

// Snapshot: sent after adding a new member so they can see current state
// despite MLS forward secrecy hiding pre-join messages.
// The fold treats this as a single atomic state reset — not N duplicate events.
export const StateSnapshotSchema = z.object({
  type: z.literal("community.snapshot"),
  config: CommunityConfigSchema.omit({ type: true }),
  channels: z.array(
    z.object({
      channelId: z.string().max(MAX_ID),
      name: z.string().max(MAX_NAME),
      description: z.string().max(MAX_DESCRIPTION).optional(),
      xmtpGroupId: z.string().max(MAX_ID),
      category: z.string().max(MAX_NAME).optional(),
      permissions: z.enum(["open", "moderated", "read-only"]),
    }),
  ).max(MAX_CHANNELS),
  roles: z.array(
    z.object({
      did: z.string().max(MAX_ID),
      inboxId: z.string().max(MAX_ID).optional(), // XMTP inbox ID for auth context rebuild
      role: z.enum(["owner", "admin", "moderator", "member"]),
    }),
  ).max(MAX_ROLES),
  bans: z.array(z.string().max(MAX_ID)).max(MAX_BANS).default([]),
  bannedInboxIds: z.array(z.string().max(MAX_ID)).max(MAX_BANS).default([]),
});

export const MetaMessageSchema = z.discriminatedUnion("type", [
  CommunityConfigSchema,
  ChannelCreatedSchema,
  ChannelUpdatedSchema,
  ChannelArchivedSchema,
  RoleAssignmentSchema,
  AnnouncementSchema,
  ModerationActionSchema,
  StateSnapshotSchema,
]);

export type MetaMessage = z.infer<typeof MetaMessageSchema>;
export type CommunityConfig = z.infer<typeof CommunityConfigSchema>;
export type ChannelCreated = z.infer<typeof ChannelCreatedSchema>;
export type ChannelUpdated = z.infer<typeof ChannelUpdatedSchema>;
export type ChannelArchived = z.infer<typeof ChannelArchivedSchema>;
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;
export type Announcement = z.infer<typeof AnnouncementSchema>;
export type ModerationAction = z.infer<typeof ModerationActionSchema>;
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;
