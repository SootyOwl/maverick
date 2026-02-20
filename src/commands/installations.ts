import type { Command } from "commander";
import { bootstrap } from "./shared.js";

export function registerInstallationCommands(program: Command): void {
  // ─── installations ───────────────────────────────────────────────────────

  program
    .command("installations")
    .description("List XMTP installations for your inbox")
    .action(async () => {
      const { xmtp } = await bootstrap();

      const inboxStates = await xmtp.preferences.fetchInboxStates([xmtp.inboxId]);
      if (!inboxStates?.[0]?.installations?.length) {
        console.log("No installations found.");
        return;
      }

      const installations = inboxStates[0].installations;
      console.log(`Installations (${installations.length}/10):\n`);

      const currentHex = Buffer.from(xmtp.installationIdBytes).toString("hex");

      for (const inst of installations) {
        const instHex = Buffer.from(inst.bytes).toString("hex");
        const isCurrent = instHex === currentHex;
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
    .description("Revoke stale XMTP installations")
    .option("--all", "Revoke ALL other installations (not just stale ones)")
    .action(async (opts: { all?: boolean }) => {
      const { xmtp } = await bootstrap();

      const inboxStates = await xmtp.preferences.fetchInboxStates([xmtp.inboxId]);
      if (!inboxStates?.[0]?.installations?.length) {
        console.log("No installations found.");
        return;
      }

      const installations = inboxStates[0].installations;
      const currentHex = Buffer.from(xmtp.installationIdBytes).toString("hex");

      // Find installations to revoke
      const toRevoke: Uint8Array[] = [];
      for (const inst of installations) {
        const instHex = Buffer.from(inst.bytes).toString("hex");
        if (instHex === currentHex) continue; // Never revoke current

        if (opts.all) {
          toRevoke.push(inst.bytes);
        }
        // For non-all mode, we'd check key package health here
        // but fetchKeyPackageStatuses may not be available in all SDK versions.
        // For now, --all is the only supported mode; without it we skip.
      }

      if (toRevoke.length === 0) {
        if (!opts.all && installations.length > 1) {
          console.log(
            "Automatic stale installation detection is not yet available.\n" +
            "Use `maverick revoke-stale --all` to revoke all other installations.",
          );
        } else {
          console.log("No installations to revoke.");
        }
        return;
      }

      console.log(`Revoking ${toRevoke.length} installation(s)...`);
      await xmtp.revokeInstallations(toRevoke);
      console.log("Done.");
    });
}
