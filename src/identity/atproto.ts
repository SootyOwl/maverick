import { AtpAgent } from "@atproto/api";
import type { Config } from "../config.js";

export interface BlueskySession {
  agent: AtpAgent;
  did: string;
  handle: string;
}

export async function createBlueskySession(
  config: Config,
): Promise<BlueskySession> {
  if (!config.bluesky.handle || !config.bluesky.password) {
    throw new Error(
      "Missing Bluesky credentials. Run 'maverick login' first, or set MAVERICK_BLUESKY_HANDLE and MAVERICK_BLUESKY_PASSWORD environment variables.",
    );
  }

  const agent = new AtpAgent({ service: config.bluesky.pdsUrl });
  await agent.login({
    identifier: config.bluesky.handle,
    password: config.bluesky.password,
  });

  return {
    agent,
    did: agent.session!.did,
    handle: agent.session!.handle,
  };
}
