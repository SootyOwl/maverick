import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";

/**
 * Sign an invite payload using Ethereum asymmetric signing.
 * Uses the private key to produce a signature that anyone can verify
 * using only the corresponding public address.
 */
export async function signInvitePayload(
  payload: string,
  privateKeyHex: string,
): Promise<string> {
  const account = privateKeyToAccount(privateKeyHex as `0x${string}`);
  const signature = await account.signMessage({ message: payload });
  return signature;
}

/**
 * Verify an invite signature using only the signer's public Ethereum address.
 * This is the key improvement: no private key needed for verification.
 */
export async function verifyInviteSignature(
  payload: string,
  signature: string,
  address: string,
): Promise<boolean> {
  try {
    const valid = await verifyMessage({
      message: payload,
      signature: signature as `0x${string}`,
      address: address as `0x${string}`,
    });
    return valid;
  } catch {
    return false;
  }
}

export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}
