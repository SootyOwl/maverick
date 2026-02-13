import type Database from "better-sqlite3";

export interface ProfileParams {
  did: string;
  inboxId?: string;
  handle?: string;
  displayName?: string;
}

export function upsertProfile(
  db: Database.Database,
  profile: ProfileParams,
): void {
  db.prepare(
    `INSERT INTO profiles (did, inbox_id, handle, display_name, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(did) DO UPDATE SET
       inbox_id = COALESCE(excluded.inbox_id, profiles.inbox_id),
       handle = COALESCE(excluded.handle, profiles.handle),
       display_name = COALESCE(excluded.display_name, profiles.display_name),
       updated_at = excluded.updated_at`,
  ).run(
    profile.did,
    profile.inboxId ?? null,
    profile.handle ?? null,
    profile.displayName ?? null,
    Date.now(),
  );
}

export function getProfileByInboxId(
  db: Database.Database,
  inboxId: string,
): { did: string; inboxId: string; handle: string | null; displayName: string | null } | null {
  return db
    .prepare(
      `SELECT did, inbox_id as inboxId, handle, display_name as displayName
       FROM profiles WHERE inbox_id = ?`,
    )
    .get(inboxId) as { did: string; inboxId: string; handle: string | null; displayName: string | null } | undefined ?? null;
}

export function resolveInboxIdToHandle(
  db: Database.Database,
  inboxId: string,
): string | null {
  const row = db
    .prepare(`SELECT handle FROM profiles WHERE inbox_id = ?`)
    .get(inboxId) as { handle: string | null } | undefined;
  return row?.handle ?? null;
}
