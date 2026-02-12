import type Database from "better-sqlite3";

export interface CommunityRow {
  id: string;
  name: string;
  description: string | null;
  config_json: string | null;
  updated_at: number;
}

export interface ChannelRow {
  id: string;
  community_id: string;
  xmtp_group_id: string;
  name: string;
  description: string | null;
  category: string | null;
  permissions: string;
  archived: number;
  created_at: number;
}

export function upsertCommunity(
  db: Database.Database,
  community: {
    id: string;
    name: string;
    description?: string;
    configJson?: string;
  },
): void {
  db.prepare(
    `INSERT INTO communities (id, name, description, config_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       config_json = excluded.config_json,
       updated_at = excluded.updated_at`,
  ).run(
    community.id,
    community.name,
    community.description ?? null,
    community.configJson ?? null,
    Date.now(),
  );
}

export function upsertChannel(
  db: Database.Database,
  channel: {
    id: string;
    communityId: string;
    xmtpGroupId: string;
    name: string;
    description?: string;
    category?: string;
    permissions?: string;
    archived?: boolean;
    createdAt?: number;
  },
): void {
  db.prepare(
    `INSERT INTO channels (id, community_id, xmtp_group_id, name, description, category, permissions, archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       category = excluded.category,
       permissions = excluded.permissions,
       archived = excluded.archived`,
  ).run(
    channel.id,
    channel.communityId,
    channel.xmtpGroupId,
    channel.name,
    channel.description ?? null,
    channel.category ?? null,
    channel.permissions ?? "open",
    channel.archived ? 1 : 0,
    channel.createdAt ?? Date.now(),
  );
}

export function upsertRole(
  db: Database.Database,
  communityId: string,
  did: string,
  role: string,
): void {
  db.prepare(
    `INSERT INTO roles (community_id, did, role, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(community_id, did) DO UPDATE SET
       role = excluded.role,
       updated_at = excluded.updated_at`,
  ).run(communityId, did, role, Date.now());
}

export function getCommunity(
  db: Database.Database,
  id: string,
): CommunityRow | null {
  return (
    (db
      .prepare(`SELECT * FROM communities WHERE id = ?`)
      .get(id) as CommunityRow | undefined) ?? null
  );
}

export function getChannels(
  db: Database.Database,
  communityId: string,
): ChannelRow[] {
  return db
    .prepare(
      `SELECT * FROM channels WHERE community_id = ? ORDER BY created_at ASC`,
    )
    .all(communityId) as ChannelRow[];
}

export function getRole(
  db: Database.Database,
  communityId: string,
  did: string,
): string {
  const row = db
    .prepare(
      `SELECT role FROM roles WHERE community_id = ? AND did = ?`,
    )
    .get(communityId, did) as { role: string } | undefined;
  return row?.role ?? "member";
}

export function archiveChannel(
  db: Database.Database,
  channelId: string,
): void {
  db.prepare(`UPDATE channels SET archived = 1 WHERE id = ?`).run(channelId);
}
