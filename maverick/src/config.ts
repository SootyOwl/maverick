import { homedir } from "node:os";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

// Load .env file from project root (won't override existing env vars)
loadDotenv({ quiet: true });

export interface Config {
  bluesky: {
    handle: string;
    password: string;
    pdsUrl: string;
  };
  xmtp: {
    env: "dev" | "production";
    dbPath: string;
  };
  dataDir: string;
  sqlitePath: string;
}

export function loadConfig(): Config {
  const dataDir = process.env.MAVERICK_DATA_DIR ?? join(homedir(), ".maverick");
  const rawXmtpEnv = process.env.MAVERICK_XMTP_ENV ?? "dev";
  if (rawXmtpEnv !== "dev" && rawXmtpEnv !== "production") {
    throw new Error(
      `Invalid MAVERICK_XMTP_ENV: "${rawXmtpEnv}". Must be "dev" or "production".`,
    );
  }
  const xmtpEnv = rawXmtpEnv;

  return {
    bluesky: {
      handle: process.env.MAVERICK_BLUESKY_HANDLE ?? "",
      password: process.env.MAVERICK_BLUESKY_PASSWORD ?? "",
      pdsUrl: process.env.MAVERICK_BLUESKY_PDS_URL ?? "https://bsky.social",
    },
    xmtp: {
      env: xmtpEnv,
      dbPath: join(dataDir, "xmtp.db3"),
    },
    dataDir,
    sqlitePath: join(dataDir, "maverick.db"),
  };
}
