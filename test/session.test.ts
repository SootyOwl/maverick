import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// Use a temp directory so tests don't touch the real ~/.maverick
const TEST_DIR = join(
  tmpdir(),
  `maverick-session-test-${randomBytes(8).toString("hex")}`,
);
mkdirSync(TEST_DIR, { recursive: true });
process.env.MAVERICK_DATA_DIR = TEST_DIR;

import { saveSession, loadSession, clearSession } from "../src/storage/session.js";

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("session storage", () => {
  beforeEach(() => {
    try {
      clearSession();
    } catch {
      // May already be empty
    }
  });

  it("saveSession + loadSession roundtrip", () => {
    saveSession("alice.bsky.social", "app-pass-1234");
    const session = loadSession();
    expect(session).not.toBeNull();
    expect(session!.handle).toBe("alice.bsky.social");
    expect(session!.password).toBe("app-pass-1234");
  });

  it("loadSession returns null when no session stored", () => {
    clearSession();
    const session = loadSession();
    expect(session).toBeNull();
  });

  it("clearSession removes stored credentials", () => {
    saveSession("bob.bsky.social", "secret-pass");
    const before = loadSession();
    expect(before).not.toBeNull();

    clearSession();
    const after = loadSession();
    expect(after).toBeNull();
  });

  it("saveSession overwrites previous credentials", () => {
    saveSession("alice.bsky.social", "old-password");
    saveSession("bob.bsky.social", "new-password");

    const session = loadSession();
    expect(session).not.toBeNull();
    expect(session!.handle).toBe("bob.bsky.social");
    expect(session!.password).toBe("new-password");
  });

  it("clearSession is idempotent (no error when already empty)", () => {
    clearSession();
    expect(() => clearSession()).not.toThrow();
  });
});
