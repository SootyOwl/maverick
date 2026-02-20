import { Command } from "commander";
import { registerLoginCommand } from "./commands/login.js";
import { registerRecoverCommand } from "./commands/recover.js";
import { registerAuthSimpleCommands } from "./commands/auth-simple.js";
import { registerInstallationCommands } from "./commands/installations.js";
import { registerKeyCommands } from "./commands/keys.js";
import { registerBackupCommands } from "./commands/backup.js";
import { registerCommunityCommands } from "./commands/community.js";
import { registerInviteCommands } from "./commands/invite.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerTuiCommand } from "./commands/tui.js";

const program = new Command();

program
  .name("maverick")
  .description("Private community chat on ATProto + XMTP")
  .version("0.1.0");

registerLoginCommand(program);
registerRecoverCommand(program);
registerAuthSimpleCommands(program);
registerInstallationCommands(program);
registerKeyCommands(program);
registerBackupCommands(program);
registerCommunityCommands(program);
registerInviteCommands(program);
registerChatCommand(program);
registerTuiCommand(program);

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
