import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  return db;
}

// ── Versioned migration system ──────────────────────────────────────────

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial schema",
    up: (db) => {
      db.exec(`
        -- Communities (cached from meta channel)
        CREATE TABLE IF NOT EXISTS communities (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          config_json TEXT,
          updated_at INTEGER NOT NULL
        );

        -- Channels (cached from meta channel)
        CREATE TABLE IF NOT EXISTS channels (
          id TEXT PRIMARY KEY,
          community_id TEXT NOT NULL,
          xmtp_group_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          category TEXT,
          permissions TEXT DEFAULT 'open',
          archived INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (community_id) REFERENCES communities(id)
        );

        -- Messages
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          sender_inbox_id TEXT NOT NULL,
          sender_did TEXT,
          sender_handle TEXT,
          text TEXT NOT NULL,
          edit_of TEXT,
          delete_of TEXT,
          created_at INTEGER NOT NULL,
          raw_content BLOB,
          FOREIGN KEY (channel_id) REFERENCES channels(id)
        );

        -- Multi-parent threading
        -- NOTE: parent_id intentionally has NO foreign key constraint.
        -- Messages can arrive out of order (XMTP sync/streaming), so a reply
        -- may be persisted before its parent. A FK would silently fail in the
        -- try/catch, permanently losing the parent relationship.
        CREATE TABLE IF NOT EXISTS message_parents (
          message_id TEXT NOT NULL,
          parent_id TEXT NOT NULL,
          PRIMARY KEY (message_id, parent_id),
          FOREIGN KEY (message_id) REFERENCES messages(id)
        );

        -- Roles (cached from meta channel)
        CREATE TABLE IF NOT EXISTS roles (
          community_id TEXT NOT NULL,
          did TEXT NOT NULL,
          role TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (community_id, did)
        );

        -- Profile cache
        CREATE TABLE IF NOT EXISTS profiles (
          did TEXT PRIMARY KEY,
          inbox_id TEXT,
          handle TEXT,
          display_name TEXT,
          avatar_url TEXT,
          updated_at INTEGER NOT NULL
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_parents_parent ON message_parents(parent_id);
        CREATE INDEX IF NOT EXISTS idx_channels_community ON channels(community_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_inbox_id ON profiles(inbox_id) WHERE inbox_id IS NOT NULL;
      `);
    },
  },
  {
    version: 2,
    description: "Add inbox_id column to profiles",
    up: (db) => {
      // For existing DBs created before inbox_id existed.
      // Only reached when user_version < 2 (pre-versioned DBs).
      const columns = db.pragma("table_info(profiles)") as { name: string }[];
      const hasInboxId = columns.some((c) => c.name === "inbox_id");
      if (!hasInboxId) {
        db.exec("ALTER TABLE profiles ADD COLUMN inbox_id TEXT");
        db.exec(
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_inbox_id ON profiles(inbox_id) WHERE inbox_id IS NOT NULL",
        );
      }
    },
  },
  {
    version: 3,
    description: "Drop FK constraint on message_parents.parent_id",
    up: (db) => {
      // Messages can arrive out of order, so the FK was causing silent data loss.
      // SQLite can't ALTER constraints, so we recreate the table.
      // Only needed for pre-versioned DBs that had the old FK.
      const fkInfo = db.pragma("foreign_key_list(message_parents)") as { table: string; from: string }[];
      const hasParentFk = fkInfo.some((fk) => fk.from === "parent_id" && fk.table === "messages");
      if (hasParentFk) {
        db.pragma("foreign_keys = OFF");
        db.exec(`
          CREATE TABLE message_parents_new (
            message_id TEXT NOT NULL,
            parent_id TEXT NOT NULL,
            PRIMARY KEY (message_id, parent_id),
            FOREIGN KEY (message_id) REFERENCES messages(id)
          );
          INSERT INTO message_parents_new SELECT * FROM message_parents;
          DROP TABLE message_parents;
          ALTER TABLE message_parents_new RENAME TO message_parents;
          CREATE INDEX IF NOT EXISTS idx_parents_parent ON message_parents(parent_id);
        `);
        db.pragma("foreign_keys = ON");
      }
    },
  },
];

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function runMigrations(db: Database.Database): void {
  const currentVersion = (db.pragma("user_version", { simple: true }) as number) ?? 0;

  if (currentVersion >= LATEST_VERSION) return;

  // Run only migrations newer than current version
  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  for (const migration of pending) {
    if (migration.version === 3) {
      // v3 needs to toggle foreign_keys outside a transaction
      migration.up(db);
    } else {
      db.transaction(() => migration.up(db))();
    }
  }

  db.pragma(`user_version = ${LATEST_VERSION}`);
}
