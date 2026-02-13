import { Client, type Signer } from "@xmtp/node-sdk";
import { IdentifierKind } from "@xmtp/node-sdk";
import { createHmac } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toBytes } from "viem";
import type { Config } from "../config.js";
import { getStoredKey, storeKey } from "../storage/keys.js";
import { MetaMessageCodec } from "../community/meta-codec.js";
import { MaverickMessageCodec } from "../messaging/codec.js";

export { generatePrivateKey };

export function createEOASigner(privateKey: `0x${string}`): Signer {
  const account = privateKeyToAccount(privateKey);

  return {
    type: "EOA" as const,
    getIdentifier: () => ({
      identifier: account.address.toLowerCase(),
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const signature = await account.signMessage({
        message,
      });
      return toBytes(signature);
    },
  };
}

export class KeyDecryptionError extends Error {
  constructor(handle: string) {
    super(
      `Failed to decrypt XMTP private key for "${handle}". ` +
      `This usually means your Bluesky app password changed since the key was stored. ` +
      `If you changed your password, use your OLD password to recover your XMTP identity, ` +
      `or delete ~/.maverick/keys/${handle.replace(/[^a-zA-Z0-9._-]/g, "_")}.key to generate a new identity (WARNING: this loses your existing XMTP inbox).`,
    );
    this.name = "KeyDecryptionError";
  }
}

export async function getOrCreatePrivateKey(
  handle: string,
  passphrase: string,
): Promise<`0x${string}`> {
  const stored = await getStoredKey(handle, passphrase);
  if (stored) {
    return stored as `0x${string}`;
  }

  // Check if a key file exists but couldn't be decrypted (wrong passphrase).
  // This prevents silently generating a new key when the user changed their
  // Bluesky app password, which would permanently lose their XMTP identity.
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const keysDir = process.env.__MAVERICK_KEYS_DIR ?? join(homedir(), ".maverick", "keys");
  const safe = handle.replace(/[^a-zA-Z0-9._-]/g, "_");
  const keyFile = join(keysDir, `${safe}.key`);

  if (existsSync(keyFile)) {
    throw new KeyDecryptionError(handle);
  }

  const key = generatePrivateKey();
  await storeKey(handle, key, passphrase);
  return key;
}

export async function createXmtpClient(
  config: Config,
  privateKey: `0x${string}`,
): Promise<Client> {
  const signer = createEOASigner(privateKey);
  const dbEncryptionKey = generateDbEncryptionKey(privateKey);

  const client = await Client.create(signer, {
    env: config.xmtp.env,
    dbPath: config.xmtp.dbPath,
    dbEncryptionKey,
    codecs: [new MetaMessageCodec(), new MaverickMessageCodec()],
  });

  return client;
}

export function generateDbEncryptionKey(privateKey: `0x${string}`): Uint8Array {
  // Derive a separate key using HMAC-SHA256 with a domain-specific context.
  // This ensures the DB encryption key is cryptographically independent of
  // the private key — compromising the XMTP DB does not leak the signing key.
  const hex = privateKey.slice(2);
  const keyBytes = Buffer.from(hex, "hex");
  const derived = createHmac("sha256", keyBytes)
    .update("maverick-xmtp-db-encryption-v1")
    .digest();
  return new Uint8Array(derived);
}
