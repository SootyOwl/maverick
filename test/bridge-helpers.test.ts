import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AtpAgent } from "@atproto/api";

// We'll dynamically import the module after mocking
// Using .js extension for ESM compatibility

/**
 * Creates a mock AtpAgent with configurable getRecord behavior.
 */
function createMockAgent(
  service: string,
  getRecordImpl?: (params: {
    repo: string;
    collection: string;
    rkey: string;
  }) => Promise<{ data: { value: Record<string, unknown> } }>,
): AtpAgent {
  const impl =
    getRecordImpl ??
    (() => {
      throw new Error("getRecord not available");
    });
  return {
    service,
    com: {
      atproto: {
        repo: {
          getRecord: impl,
        },
        identity: {
          resolveDid: () => {
            throw new Error("resolveDid not available");
          },
        },
      },
    },
  } as unknown as AtpAgent;
}

describe("fetchPdsRecord", () => {
  // We test fetchPdsRecord by importing it. Since it depends on resolvePds
  // internally, and resolvePds makes network calls, we test through the
  // public functions getMaverickRecord and getLegacyInboxRecord, mocking
  // at the AtpAgent level.

  // For direct fetchPdsRecord testing, we'll import it and mock resolvePds
  // by controlling what the agent returns.

  let fetchPdsRecord: typeof import("../src/identity/bridge.js")["fetchPdsRecord"];

  beforeEach(async () => {
    const mod = await import("../src/identity/bridge.js");
    fetchPdsRecord = mod.fetchPdsRecord;
  });

  it("calls extract with the record value on success", async () => {
    const extractFn = vi.fn((value: Record<string, unknown>) => ({
      found: true,
      data: value["name"],
    }));

    const agent = createMockAgent("https://bsky.social", async () => ({
      data: {
        value: { name: "test-value" },
      },
    }));

    // resolvePds will fail (agent's resolveDid throws), so PDS agent won't
    // be created, and it will fall back to using the caller's agent directly.
    const result = await fetchPdsRecord(
      agent,
      "did:plc:test123",
      "some.collection",
      extractFn,
    );

    expect(extractFn).toHaveBeenCalledWith({ name: "test-value" });
    expect(result).toEqual({ found: true, data: "test-value" });
  });

  it("returns null when both agents fail", async () => {
    const agent = createMockAgent("https://bsky.social", async () => {
      throw new Error("Record not found");
    });

    const result = await fetchPdsRecord(
      agent,
      "did:plc:missing",
      "some.collection",
      () => ({ value: "should not be called" }),
    );

    expect(result).toBeNull();
  });

  it("returns null when extract returns null", async () => {
    const agent = createMockAgent("https://bsky.social", async () => ({
      data: {
        value: { incomplete: true },
      },
    }));

    const result = await fetchPdsRecord(
      agent,
      "did:plc:test",
      "some.collection",
      () => null, // extract returns null
    );

    expect(result).toBeNull();
  });

  it("tries PDS agent first, then falls back to caller agent", async () => {
    // This test validates fallback behavior. Since resolvePds uses the agent's
    // resolveDid internally (which we can mock), and falls back to PLC directory
    // fetch (which we can't easily mock in this context), we test indirectly:
    //
    // When the caller agent's getRecord fails, fetchPdsRecord returns null
    // (since resolvePds will also fail with our mock, no PDS agent is created).

    const callOrder: string[] = [];
    const agent = createMockAgent("https://bsky.social", async () => {
      callOrder.push("caller-agent");
      throw new Error("Not found");
    });

    const result = await fetchPdsRecord(
      agent,
      "did:plc:test",
      "test.collection",
      (v) => ({ v }),
    );

    // Since resolvePds fails (mock agent), only the caller agent is tried
    expect(callOrder).toEqual(["caller-agent"]);
    expect(result).toBeNull();
  });
});

describe("getMaverickRecord (via fetchPdsRecord)", () => {
  let getMaverickRecord: typeof import("../src/identity/bridge.js")["getMaverickRecord"];

  beforeEach(async () => {
    const mod = await import("../src/identity/bridge.js");
    getMaverickRecord = mod.getMaverickRecord;
  });

  it("returns inboxId and createdAt from a valid record", async () => {
    const agent = createMockAgent("https://bsky.social", async (params) => {
      if (params.collection === "community.maverick.inbox") {
        return {
          data: {
            value: {
              inboxId: "inbox-abc-123",
              createdAt: "2025-01-01T00:00:00Z",
            },
          },
        };
      }
      throw new Error("Unknown collection");
    });

    const result = await getMaverickRecord(agent, "did:plc:test");
    expect(result).toEqual({
      inboxId: "inbox-abc-123",
      createdAt: "2025-01-01T00:00:00Z",
    });
  });

  it("returns null when inboxId is missing", async () => {
    const agent = createMockAgent("https://bsky.social", async () => ({
      data: {
        value: { createdAt: "2025-01-01T00:00:00Z" },
      },
    }));

    const result = await getMaverickRecord(agent, "did:plc:test");
    expect(result).toBeNull();
  });

  it("defaults createdAt to empty string when missing", async () => {
    const agent = createMockAgent("https://bsky.social", async () => ({
      data: {
        value: { inboxId: "inbox-123" },
      },
    }));

    const result = await getMaverickRecord(agent, "did:plc:test");
    expect(result).toEqual({
      inboxId: "inbox-123",
      createdAt: "",
    });
  });

  it("returns null when getRecord throws", async () => {
    const agent = createMockAgent("https://bsky.social", async () => {
      throw new Error("Not found");
    });

    const result = await getMaverickRecord(agent, "did:plc:test");
    expect(result).toBeNull();
  });
});

describe("getLegacyInboxRecord (via fetchPdsRecord)", () => {
  let getLegacyInboxRecord: typeof import("../src/identity/bridge.js")["getLegacyInboxRecord"];

  beforeEach(async () => {
    const mod = await import("../src/identity/bridge.js");
    getLegacyInboxRecord = mod.getLegacyInboxRecord;
  });

  it("returns inboxId, verificationSignature, and createdAt from a valid record", async () => {
    const agent = createMockAgent("https://bsky.social", async (params) => {
      if (params.collection === "org.xmtp.inbox") {
        return {
          data: {
            value: {
              id: "inbox-legacy-456",
              verificationSignature: "sig-base64",
              createdAt: "2024-06-15T12:00:00Z",
            },
          },
        };
      }
      throw new Error("Unknown collection");
    });

    const result = await getLegacyInboxRecord(agent, "did:plc:test");
    expect(result).toEqual({
      inboxId: "inbox-legacy-456",
      verificationSignature: "sig-base64",
      createdAt: "2024-06-15T12:00:00Z",
    });
  });

  it("returns null when id is missing", async () => {
    const agent = createMockAgent("https://bsky.social", async () => ({
      data: {
        value: {
          verificationSignature: "sig",
          createdAt: "2024-01-01T00:00:00Z",
        },
      },
    }));

    const result = await getLegacyInboxRecord(agent, "did:plc:test");
    expect(result).toBeNull();
  });

  it("returns null when verificationSignature is missing", async () => {
    const agent = createMockAgent("https://bsky.social", async () => ({
      data: {
        value: {
          id: "inbox-456",
          createdAt: "2024-01-01T00:00:00Z",
        },
      },
    }));

    const result = await getLegacyInboxRecord(agent, "did:plc:test");
    expect(result).toBeNull();
  });

  it("defaults createdAt to empty string when missing", async () => {
    const agent = createMockAgent("https://bsky.social", async () => ({
      data: {
        value: {
          id: "inbox-456",
          verificationSignature: "sig-base64",
        },
      },
    }));

    const result = await getLegacyInboxRecord(agent, "did:plc:test");
    expect(result).toEqual({
      inboxId: "inbox-456",
      verificationSignature: "sig-base64",
      createdAt: "",
    });
  });

  it("returns null when getRecord throws", async () => {
    const agent = createMockAgent("https://bsky.social", async () => {
      throw new Error("Record not found");
    });

    const result = await getLegacyInboxRecord(agent, "did:plc:test");
    expect(result).toBeNull();
  });
});
