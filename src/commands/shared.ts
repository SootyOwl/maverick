import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { loadConfig } from "../config.js";
import { createBlueskySession } from "../identity/atproto.js";
import { publishMaverickRecord } from "../identity/bridge.js";
import {
  createXmtpClient,
  getCachedPrivateKey,
  migrateLegacyIdentity,
} from "../identity/xmtp.js";
import { createDatabase } from "../storage/db.js";
import { CommunityManager } from "../community/manager.js";
import { saveSession } from "../storage/session.js";
import type { Client } from "@xmtp/node-sdk";
import type { AtpAgent } from "@atproto/api";
import type { Config } from "../config.js";
import type { BlueskySession } from "../identity/atproto.js";

export interface BootstrapResult {
  config: Config;
  bsky: BlueskySession;
  xmtp: Client;
  privateKey: `0x${string}`;
}

// ─── Non-interactive bootstrap ───────────────────────────────────────────
// Used by all commands except `login` and `recover`.
// Fails with guidance if no cached key exists.

export async function bootstrap(): Promise<BootstrapResult> {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });

  let bsky: BlueskySession;
  try {
    bsky = await createBlueskySession(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Missing Bluesky credentials/i.test(msg)) {
      throw new Error(
        "Missing Bluesky credentials. Run 'maverick login' first, or set MAVERICK_BLUESKY_HANDLE and MAVERICK_BLUESKY_PASSWORD environment variables.",
      );
    }
    throw err;
  }

  // Try cache first
  let privateKey = await getCachedPrivateKey(bsky.handle);

  // Try legacy migration (old passphrase-encrypted key file)
  if (!privateKey) {
    privateKey = await migrateLegacyIdentity(bsky.handle, config.bluesky.password);
    if (privateKey) {
      console.log("Migrated legacy key to new storage format.");
    }
  }

  // No key found — fail with guidance
  if (!privateKey) {
    throw new Error(
      "No identity found. Run `maverick login` to set up or recover your identity.",
    );
  }

  const xmtp = await createXmtpClient(config, privateKey);

  return { config, bsky, xmtp, privateKey };
}

// ─── Shared utilities ────────────────────────────────────────────────────

export function createPrompt(): { ask: (q: string) => Promise<string>; close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (q) => new Promise<string>((resolve) => rl.question(q, resolve)),
    close: () => rl.close(),
  };
}

export async function ensureCredentials(config: Config): Promise<Config> {
  if (config.bluesky.handle && config.bluesky.password) return config;

  const credPrompt = createPrompt();
  console.log("No Bluesky credentials found. Please enter them below.\n");
  const handle = config.bluesky.handle || await credPrompt.ask("Bluesky handle: ");
  const password = config.bluesky.password || await credPrompt.ask("App password: ");
  credPrompt.close();

  return {
    ...config,
    bluesky: { ...config.bluesky, handle, password },
  };
}

export async function recoverAndFinish(
  config: Config,
  bsky: { agent: AtpAgent; did: string; handle: string },
  xmtp: Client,
  privateKey?: `0x${string}`,
): Promise<void> {
  // Persist the verified key now that createXmtpClient() succeeded.
  // This must happen AFTER verification to avoid poisoning the key cache
  // with an incorrect key derived from a wrong recovery phrase.
  if (privateKey) {
    const { storeKey } = await import("../storage/keys.js");
    await storeKey(bsky.handle, privateKey);
  }

  const db = createDatabase(config.sqlitePath);
  const manager = new CommunityManager(xmtp, db);
  const result = await manager.recoverAllCommunities({
    onProgress: (msg) => console.log(`  ${msg}`),
  });
  console.log(
    `Recovered ${result.communities.length} community(ies), ${result.channelsRecovered} channels.`,
  );
  db.close();

  await publishMaverickRecord(bsky.agent, xmtp);
  saveSession(bsky.handle, config.bluesky.password);
}
