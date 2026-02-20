import type { Client } from "@xmtp/node-sdk";
import type { CommunityManager } from "./manager.js";

export interface RecoveryOptions {
  onProgress?: (message: string) => void;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface RecoveryResult {
  communities: { groupId: string; name: string }[];
  channelsRecovered: number;
  historyRequested: boolean;
}

/**
 * Recovers all communities after key restoration on a new device.
 *
 * Sends a history sync request to other installations first, then polls
 * with syncAll() until communities appear or the timeout expires.
 * Finally replays each community's meta channel to rebuild the local cache.
 *
 * Individual community sync failures are logged but do not abort the
 * overall recovery process.
 */
export async function recoverAllCommunities(
  xmtpClient: Client,
  manager: CommunityManager,
  options?: RecoveryOptions,
): Promise<RecoveryResult> {
  const log = options?.onProgress ?? (() => {});
  const pollTimeout = options?.pollTimeoutMs ?? 60_000;
  const pollInterval = options?.pollIntervalMs ?? 3_000;

  // 1. Request history sync from other installations FIRST.
  //    This tells existing installations to upload their data so we can
  //    pull it in subsequent syncAll() calls.
  let historyRequested = false;
  try {
    log("Requesting history from other installations...");
    await xmtpClient.sendSyncRequest();
    historyRequested = true;
  } catch {
    // sendSyncRequest may fail if no other installations exist or
    // the method is unavailable — this is non-fatal for recovery.
    log("No other installations found for history sync.");
  }

  // 2. Initial sync — may already find groups if the installation was
  //    quickly welcomed into existing conversations.
  log("Syncing conversations from network...");
  await xmtpClient.conversations.syncAll();
  let communities = await manager.listCommunities();

  // 3. If no communities found and we sent a sync request, poll —
  //    history sync is async and the other installation needs time to
  //    process the request, create a payload, upload it, and send a reply.
  if (communities.length === 0 && historyRequested) {
    log("Waiting for history sync from other installations...");
    const deadline = Date.now() + pollTimeout;
    let attempt = 0;

    while (communities.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      attempt++;
      log(`Polling for communities (attempt ${attempt})...`);
      await xmtpClient.conversations.syncAll();
      communities = await manager.listCommunities();
    }

    if (communities.length === 0) {
      log(
        "No communities found after waiting. " +
          "Ensure another installation is online, or try `maverick recover` again later.",
      );
    }
  }

  // 4. For each discovered community, replay meta channel to rebuild local cache
  let channelsRecovered = 0;
  for (const community of communities) {
    try {
      log(`Syncing community "${community.name}"...`);
      const state = await manager.syncCommunityState(community.groupId);
      for (const [, ch] of state.channels) {
        if (!ch.archived) {
          channelsRecovered++;
        }
      }
    } catch (err) {
      console.error(
        `Failed to sync community "${community.name}" (${community.groupId}):`,
        err,
      );
    }
  }

  return { communities, channelsRecovered, historyRequested };
}
