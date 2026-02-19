import { Client, type Signer } from "@xmtp/node-sdk";
import { IdentifierKind } from "@xmtp/node-sdk";
import { createHmac } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { toBytes } from "viem";
import type { Config } from "../config.js";
import { getStoredKey, storeKey, migrateLegacyKey } from "../storage/keys.js";
import { generateRecoveryPhrase, derivePrivateKey } from "./recovery-phrase.js";
import { MetaMessageCodec } from "../community/meta-codec.js";
import { MaverickMessageCodec } from "../messaging/codec.js";

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

/**
 * Non-interactive: load a cached XMTP private key from the keychain/file.
 * Returns null if no key is stored for this handle.
 */
export async function getCachedPrivateKey(
  handle: string,
): Promise<`0x${string}` | null> {
  return (await getStoredKey(handle)) as `0x${string}` | null;
}

/**
 * Create a new XMTP identity: generate a recovery phrase and derive the
 * private key from it. The key is NOT cached yet — the caller must call
 * commitIdentity() after the user has confirmed the recovery phrase.
 *
 * Returns both the recovery phrase (which the user must save) and the
 * derived private key.
 */
export async function createNewIdentity(
  _handle: string,
  did: string,
): Promise<{ recoveryPhrase: string; privateKey: `0x${string}` }> {
  const recoveryPhrase = generateRecoveryPhrase();
  const privateKey = derivePrivateKey(recoveryPhrase, did);
  return { recoveryPhrase, privateKey };
}

/**
 * Persist a newly-created XMTP private key after the user has confirmed
 * their recovery phrase. Must be called after createNewIdentity() once the
 * user has acknowledged and verified the phrase.
 */
export async function commitIdentity(
  handle: string,
  privateKey: `0x${string}`,
): Promise<void> {
  await storeKey(handle, privateKey);
}

/**
 * Recover an XMTP identity from a recovery phrase: derive the private key
 * from the phrase + DID and return it WITHOUT persisting.
 *
 * Callers MUST verify the key works (e.g. by calling createXmtpClient())
 * before persisting it via storeKey(). Storing before verification can
 * poison the key cache — a wrong recovery phrase would permanently cache
 * an incorrect key, causing all subsequent logins to fail.
 */
export async function recoverIdentity(
  _handle: string,
  did: string,
  phrase: string,
): Promise<`0x${string}`> {
  const privateKey = derivePrivateKey(phrase, did);
  return privateKey;
}

/**
 * Import a raw XMTP private key directly (e.g. from an external backup).
 * Caches it in the keychain/file for future use.
 */
export async function importRawKey(
  handle: string,
  key: `0x${string}`,
): Promise<void> {
  await storeKey(handle, key);
}

/**
 * Migrate a legacy passphrase-encrypted key file to the new storage system.
 * Decrypts the old file with the Bluesky app password, stores it in the
 * new format (keychain + plaintext 0600 file), and removes the encrypted file.
 *
 * Returns the decrypted key on success, null if no legacy file exists or
 * decryption fails.
 */
export async function migrateLegacyIdentity(
  handle: string,
  passphrase: string,
): Promise<`0x${string}` | null> {
  const key = await migrateLegacyKey(handle, passphrase);
  if (key) {
    return key as `0x${string}`;
  }
  return null;
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
