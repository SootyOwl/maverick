import { describe, it, expect } from "vitest";
import { createBlueskySession } from "../src/identity/atproto.js";
import type { Config } from "../src/config.js";

function makeConfig(overrides: Partial<Config["bluesky"]> = {}): Config {
  return {
    bluesky: {
      handle: overrides.handle ?? "",
      password: overrides.password ?? "",
      pdsUrl: overrides.pdsUrl ?? "https://bsky.social",
    },
    xmtp: { env: "dev", dbPath: "/tmp/test-xmtp.db3" },
    dataDir: "/tmp/test-maverick",
    sqlitePath: "/tmp/test-maverick/maverick.db",
  };
}

describe("createBlueskySession error message", () => {
  it("throws when handle is empty", async () => {
    const config = makeConfig({ handle: "", password: "some-password" });
    await expect(createBlueskySession(config)).rejects.toThrow(
      /Missing Bluesky credentials/,
    );
  });

  it("throws when password is empty", async () => {
    const config = makeConfig({ handle: "alice.bsky.social", password: "" });
    await expect(createBlueskySession(config)).rejects.toThrow(
      /Missing Bluesky credentials/,
    );
  });

  it("throws when both handle and password are empty", async () => {
    const config = makeConfig({ handle: "", password: "" });
    await expect(createBlueskySession(config)).rejects.toThrow(
      /Missing Bluesky credentials/,
    );
  });

  it("error message mentions 'maverick login' as an alternative", async () => {
    const config = makeConfig({ handle: "", password: "" });
    await expect(createBlueskySession(config)).rejects.toThrow(
      /maverick login/,
    );
  });

  it("error message mentions environment variables", async () => {
    const config = makeConfig({ handle: "", password: "" });
    await expect(createBlueskySession(config)).rejects.toThrow(
      /MAVERICK_BLUESKY_HANDLE/,
    );
  });
});
