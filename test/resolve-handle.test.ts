import { describe, it, expect } from "vitest";
import { AtpAgent } from "@atproto/api";

const HANDLE = "maverick-test.bsky.social";
const EXPECTED_DID = "did:plc:zx375b5o5tqey4slfxnnbdfp";
const EXPECTED_PDS = "agrocybe.us-west.host.bsky.network";

describe("Handle → InboxId resolution chain", () => {
  const agent = new AtpAgent({ service: "https://bsky.social" });

  it("step 1: resolveHandle returns the DID", async () => {
    const res = await agent.resolveHandle({ handle: HANDLE });
    expect(res.data.did).toBe(EXPECTED_DID);
  });

  it("step 2: PLC directory returns DID document with PDS endpoint", async () => {
    const res = await fetch(
      `https://plc.directory/${encodeURIComponent(EXPECTED_DID)}`,
    );
    expect(res.ok).toBe(true);
    const didDoc = (await res.json()) as Record<string, unknown>;

    expect(didDoc.id).toBe(EXPECTED_DID);
    expect(Array.isArray(didDoc.service)).toBe(true);

    const services = didDoc.service as Array<Record<string, unknown>>;
    const pdsSvc = services.find(
      (s) =>
        s.id === "#atproto_pds" || s.id === `${EXPECTED_DID}#atproto_pds`,
    );
    expect(pdsSvc).toBeDefined();
    expect(typeof pdsSvc!.serviceEndpoint).toBe("string");
    expect(String(pdsSvc!.serviceEndpoint)).toContain(EXPECTED_PDS);
  });

  it("step 3: getRecord via target PDS directly returns the inbox record", async () => {
    const pdsAgent = new AtpAgent({
      service: `https://${EXPECTED_PDS}`,
    });
    const res = await pdsAgent.com.atproto.repo.getRecord({
      repo: EXPECTED_DID,
      collection: "org.xmtp.inbox",
      rkey: "self",
    });
    const record = res.data.value as {
      id?: string;
      verificationSignature?: string;
    };
    expect(record.id).toBeTruthy();
    expect(record.verificationSignature).toBeTruthy();
  });

  it("step 4: getPublishedInboxRecord works via PLC directory resolution", async () => {
    const { getPublishedInboxRecord } = await import(
      "../src/identity/bridge.js"
    );
    const record = await getPublishedInboxRecord(agent, EXPECTED_DID);
    expect(record).not.toBeNull();
    expect(record!.inboxId).toBeTruthy();
  });

  it("step 5: full resolveHandleToInbox works end-to-end", async () => {
    const { resolveHandleToInbox } = await import(
      "../src/identity/resolver.js"
    );
    const result = await resolveHandleToInbox(agent, HANDLE);
    expect(result.did).toBe(EXPECTED_DID);
    expect(result.inboxId).toBeTruthy();
  });
});
