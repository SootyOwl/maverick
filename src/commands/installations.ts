import { mkdirSync } from "node:fs";
import { Client } from "@xmtp/node-sdk";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { createBlueskySession } from "../identity/atproto.js";
import { getMaverickRecord } from "../identity/bridge.js";
import { createEOASigner, getCachedPrivateKey } from "../identity/xmtp.js";
import { bootstrap } from "./shared.js";

/**
 * Resolve inbox ID and signer WITHOUT creating an XMTP Client.
 *
 * This avoids the 10/10 installation limit catch-22: `Client.create()`
 * registers a new installation, which fails when the limit is already
 * reached — precisely when you need to revoke.
 */
async function resolveInboxAndSigner() {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });

  const bsky = await createBlueskySession(config);
  const privateKey = await getCachedPrivateKey(bsky.handle);
  if (!privateKey) {
    throw new Error(
      "No XMTP private key found. Run `maverick login` first.",
    );
  }

  const record = await getMaverickRecord(bsky.agent, bsky.did);
  if (!record) {
    throw new Error(
      "No XMTP inbox record found on PDS. Run `maverick login` to publish your identity.",
    );
  }

  const signer = createEOASigner(privateKey);
  return { inboxId: record.inboxId, signer, env: config.xmtp.env };
}

export function registerInstallationCommands(program: Command): void {
  // ─── installations ───────────────────────────────────────────────────────

  program
    .command("installations")
    .description("List XMTP installations for your inbox")
    .action(async () => {
      // Try bootstrap first (shows current installation marker).
      // Fall back to static API if Client.create() fails (e.g. 10/10 limit).
      let inboxId: string;
      let currentHex: string | null = null;

      try {
        const { xmtp } = await bootstrap();
        inboxId = xmtp.inboxId;
        currentHex = Buffer.from(xmtp.installationIdBytes).toString("hex");
      } catch {
        console.log("(Using static API — current installation unknown)\n");
        const resolved = await resolveInboxAndSigner();
        inboxId = resolved.inboxId;
      }

      const inboxStates = await Client.fetchInboxStates([inboxId]);
      if (!inboxStates?.[0]?.installations?.length) {
        console.log("No installations found.");
        return;
      }

      const installations = inboxStates[0].installations;
      console.log(`Installations (${installations.length}/10):\n`);

      for (const inst of installations) {
        const instHex = Buffer.from(inst.bytes).toString("hex");
        const isCurrent = currentHex && instHex === currentHex;
        const marker = isCurrent ? " (current)" : "";
        const shortId = instHex.slice(0, 16);
        console.log(`  ${shortId}...${marker}`);
      }

      if (installations.length >= 8) {
        console.warn(
          "\nWARNING: Approaching 10-installation limit. Consider running `maverick revoke-stale`.",
        );
      }
    });

  // ─── revoke-stale ────────────────────────────────────────────────────────

  program
    .command("revoke-stale")
    .description("Revoke stale XMTP installations (uses static API — no new registration)")
    .option("--all", "Revoke ALL other installations (not just stale ones)")
    .action(async (opts: { all?: boolean }) => {
      // Use static API to avoid registering a new installation.
      const { inboxId, signer, env } = await resolveInboxAndSigner();

      const inboxStates = await Client.fetchInboxStates([inboxId], env);
      if (!inboxStates?.[0]?.installations?.length) {
        console.log("No installations found.");
        return;
      }

      const installations = inboxStates[0].installations;
      console.log(`Found ${installations.length} installation(s).`);

      if (!opts.all) {
        console.log(
          "\nAutomatic stale installation detection is not yet available.\n" +
          "Use `maverick revoke-stale --all` to revoke all installations.",
        );
        return;
      }

      // Revoke all installations
      const toRevoke = installations.map((inst) => inst.bytes);
      if (toRevoke.length === 0) {
        console.log("No installations to revoke.");
        return;
      }

      console.log(`Revoking ${toRevoke.length} installation(s)...`);
      await Client.revokeInstallations(signer, inboxId, toRevoke, env);
      console.log("Done. Run `maverick login` to register a fresh installation.");
    });
}
