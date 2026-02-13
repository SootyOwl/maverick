import { z } from "zod/v4";
import { privateKeyToAccount } from "viem/accounts";
import { signInvitePayload, verifyInviteSignature } from "../utils/crypto.js";

const InviteTokenSchema = z.object({
  communityName: z.string(),
  metaChannelGroupId: z.string(),
  inviterDid: z.string(),
  inviterAddress: z.string(),
  role: z.enum(["member", "moderator"]),
  expiry: z.string(),
  signature: z.string(),
});

export type InviteToken = z.infer<typeof InviteTokenSchema>;

export async function createInvite(
  privateKeyHex: string,
  communityName: string,
  metaGroupId: string,
  inviterDid: string,
  role: "member" | "moderator" = "member",
  expiryHours = 72,
): Promise<InviteToken> {
  const expiry = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

  // Derive the public address from the private key
  const account = privateKeyToAccount(privateKeyHex as `0x${string}`);
  const inviterAddress = account.address;

  const payload = buildPayload(communityName, metaGroupId, inviterDid, inviterAddress, role, expiry);
  const signature = await signInvitePayload(payload, privateKeyHex);

  return {
    communityName,
    metaChannelGroupId: metaGroupId,
    inviterDid,
    inviterAddress,
    role,
    expiry,
    signature,
  };
}

/**
 * Verify an invite token using only the public information contained within it.
 * No private key is needed -- the inviterAddress (public) is used to verify
 * the Ethereum signature.
 */
export async function verifyInvite(invite: InviteToken): Promise<boolean> {
  // Check expiry
  if (new Date(invite.expiry) < new Date()) {
    return false;
  }

  const payload = buildPayload(
    invite.communityName,
    invite.metaChannelGroupId,
    invite.inviterDid,
    invite.inviterAddress,
    invite.role,
    invite.expiry,
  );

  return verifyInviteSignature(payload, invite.signature, invite.inviterAddress);
}

export function encodeInvite(invite: InviteToken): string {
  const json = JSON.stringify(invite);
  return Buffer.from(json).toString("base64url");
}

// Max invite token size: 10 KB (generous for a JSON with a few string fields)
const MAX_INVITE_BYTES = 10_240;

export function decodeInvite(encoded: string): InviteToken {
  if (encoded.length > MAX_INVITE_BYTES) {
    throw new Error(
      `Invite token too large: ${encoded.length} chars (max ${MAX_INVITE_BYTES})`,
    );
  }
  const json = Buffer.from(encoded, "base64url").toString("utf-8");
  const parsed = JSON.parse(json);
  return InviteTokenSchema.parse(parsed);
}

function buildPayload(
  communityName: string,
  metaGroupId: string,
  inviterDid: string,
  inviterAddress: string,
  role: string,
  expiry: string,
): string {
  // Use canonical JSON with sorted keys to avoid delimiter injection.
  // Previously used ':' concatenation, which was ambiguous when fields
  // contained ':' (e.g., community name "A:B" could collide with
  // a different community/group combination).
  return JSON.stringify({
    communityName,
    expiry,
    inviterAddress,
    inviterDid,
    metaGroupId,
    role,
  });
}
