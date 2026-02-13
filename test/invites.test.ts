import { describe, it, expect } from "vitest";
import {
  createInvite,
  verifyInvite,
  encodeInvite,
  decodeInvite,
} from "../src/community/invites.js";
import {
  signInvitePayload,
  verifyInviteSignature,
  generateNonce,
} from "../src/utils/crypto.js";
import { privateKeyToAccount } from "viem/accounts";

const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const TEST_ACCOUNT = privateKeyToAccount(TEST_KEY);
const TEST_ADDRESS = TEST_ACCOUNT.address;

describe("crypto utils", () => {
  it("signs and verifies a payload with asymmetric Ethereum signing", async () => {
    const payload = "test:payload:data";
    const sig = await signInvitePayload(payload, TEST_KEY);
    expect(sig).toBeTruthy();
    // Verification uses the PUBLIC address, not the private key
    const valid = await verifyInviteSignature(payload, sig, TEST_ADDRESS);
    expect(valid).toBe(true);
  });

  it("rejects tampered payload", async () => {
    const payload = "test:payload:data";
    const sig = await signInvitePayload(payload, TEST_KEY);
    const valid = await verifyInviteSignature("tampered:payload", sig, TEST_ADDRESS);
    expect(valid).toBe(false);
  });

  it("rejects wrong address", async () => {
    const payload = "test:payload:data";
    const sig = await signInvitePayload(payload, TEST_KEY);
    // Use a different address (not the one that signed)
    const wrongAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const valid = await verifyInviteSignature(payload, sig, wrongAddress);
    expect(valid).toBe(false);
  });

  it("generates unique nonces", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBe(32); // 16 bytes = 32 hex chars
  });
});

describe("invite tokens", () => {
  it("creates and verifies an invite using Ethereum address (public info only)", async () => {
    const invite = await createInvite(
      TEST_KEY,
      "Test Community",
      "meta-group-123",
      "did:plc:alice",
      "member",
      72,
    );

    expect(invite.communityName).toBe("Test Community");
    expect(invite.role).toBe("member");
    expect(invite.signature).toBeTruthy();
    // Invite should include the inviter's Ethereum address
    expect(invite.inviterAddress).toBe(TEST_ADDRESS);

    // Verify uses ONLY the address from the token (public info), NOT the private key
    const valid = await verifyInvite(invite);
    expect(valid).toBe(true);
  });

  it("verifyInvite works with only public info from the token", async () => {
    const invite = await createInvite(
      TEST_KEY,
      "Test Community",
      "meta-group-123",
      "did:plc:alice",
      "member",
      72,
    );

    // Simulate receiving the invite: we only have the token, no private key
    // verifyInvite should not require a private key parameter
    const valid = await verifyInvite(invite);
    expect(valid).toBe(true);
  });

  it("rejects expired invite", async () => {
    // Create an invite with 0 expiry hours (expires immediately)
    const invite = await createInvite(
      TEST_KEY,
      "Test Community",
      "meta-group-123",
      "did:plc:alice",
      "member",
      0, // expires immediately
    );

    // Wait a tiny bit to ensure it's expired
    invite.expiry = new Date(Date.now() - 10000).toISOString();

    const valid = await verifyInvite(invite);
    expect(valid).toBe(false);
  });

  it("rejects tampered invite (modified communityName)", async () => {
    const invite = await createInvite(
      TEST_KEY,
      "Test Community",
      "meta-group-123",
      "did:plc:alice",
      "member",
      72,
    );

    // Tamper with a field after signing
    invite.communityName = "Hacked Community";

    const valid = await verifyInvite(invite);
    expect(valid).toBe(false);
  });

  it("rejects tampered invite (modified role)", async () => {
    const invite = await createInvite(
      TEST_KEY,
      "Test Community",
      "meta-group-123",
      "did:plc:alice",
      "member",
      72,
    );

    // Tamper with role
    invite.role = "moderator";

    const valid = await verifyInvite(invite);
    expect(valid).toBe(false);
  });

  it("rejects tampered invite (modified inviterAddress)", async () => {
    const invite = await createInvite(
      TEST_KEY,
      "Test Community",
      "meta-group-123",
      "did:plc:alice",
      "member",
      72,
    );

    // Attacker tries to claim it was signed by a different address
    invite.inviterAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

    const valid = await verifyInvite(invite);
    expect(valid).toBe(false);
  });

  it("encodes and decodes invite tokens", async () => {
    const invite = await createInvite(
      TEST_KEY,
      "Test Community",
      "meta-group-123",
      "did:plc:alice",
      "moderator",
    );

    const encoded = encodeInvite(invite);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decodeInvite(encoded);
    expect(decoded).toEqual(invite);
  });

  it("rejects malformed invite payload (missing fields)", () => {
    const malformed = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
    expect(() => decodeInvite(malformed)).toThrow();
  });

  it("rejects invite payload with extra/wrong-typed fields", () => {
    const badTypes = Buffer.from(
      JSON.stringify({
        communityName: 123, // should be string
        metaChannelGroupId: "ok",
        inviterDid: "ok",
        inviterAddress: "ok",
        role: "superuser", // invalid enum value
        expiry: "ok",
        signature: "ok",
      }),
    ).toString("base64url");
    expect(() => decodeInvite(badTypes)).toThrow();
  });

  it("rejects non-JSON invite payload", () => {
    const notJson = Buffer.from("not json at all!").toString("base64url");
    expect(() => decodeInvite(notJson)).toThrow();
  });

  it("resists delimiter injection in community names", async () => {
    // An attacker creates a community named "Evil:fake-group" to try to
    // produce a signature that also validates for community "Evil" with
    // metaGroupId "fake-group:...". With JSON-based payload serialization,
    // these produce different canonical payloads.
    const invite1 = await createInvite(
      TEST_KEY,
      "Evil:fake-group",
      "real-group-123",
      "did:plc:alice",
      "member",
      72,
    );

    const invite2 = await createInvite(
      TEST_KEY,
      "Evil",
      "fake-group:real-group-123",
      "did:plc:alice",
      "member",
      72,
    );

    // The signatures MUST be different — same signer but different payloads
    expect(invite1.signature).not.toBe(invite2.signature);

    // Both should verify with their own data
    expect(await verifyInvite(invite1)).toBe(true);
    expect(await verifyInvite(invite2)).toBe(true);

    // Swapping the metaGroupId should fail verification
    const tampered = { ...invite1, metaChannelGroupId: invite2.metaChannelGroupId };
    expect(await verifyInvite(tampered)).toBe(false);
  });

  it("round-trips all fields correctly including inviterAddress", async () => {
    const invite = await createInvite(
      TEST_KEY,
      "My Awesome Community",
      "grp-abc-123",
      "did:plc:xyz789",
      "moderator",
      24,
    );

    const roundTripped = decodeInvite(encodeInvite(invite));

    expect(roundTripped.communityName).toBe("My Awesome Community");
    expect(roundTripped.metaChannelGroupId).toBe("grp-abc-123");
    expect(roundTripped.inviterDid).toBe("did:plc:xyz789");
    expect(roundTripped.inviterAddress).toBe(TEST_ADDRESS);
    expect(roundTripped.role).toBe("moderator");
    expect(roundTripped.signature).toBe(invite.signature);
  });
});
