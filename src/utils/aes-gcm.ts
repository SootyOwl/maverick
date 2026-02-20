import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/** v1 backup format used 16-byte IV. */
export const IV_SIZE_V1 = 16;
/** v2+ uses 12-byte IV per NIST SP 800-38D recommendation for GCM. */
export const IV_SIZE_V2 = 12;

const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

/** Derive a 256-bit key from a passphrase and salt using scrypt. */
export function deriveKey(passphrase: string, salt: Buffer, keyLen = 32): Buffer {
  return scryptSync(passphrase, salt, keyLen, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  }) as Buffer;
}

export interface EncryptResult {
  salt: Buffer;
  iv: Buffer;
  encrypted: Buffer;
  authTag: Buffer;
}

/** Encrypt plaintext with AES-256-GCM using a passphrase (scrypt-derived key). */
export function encrypt(plaintext: Buffer, passphrase: string): EncryptResult {
  const salt = randomBytes(32);
  const iv = randomBytes(IV_SIZE_V2);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { salt, iv, encrypted, authTag };
}

/** Decrypt AES-256-GCM ciphertext using a passphrase (scrypt-derived key). */
export function decrypt(
  encrypted: Buffer,
  passphrase: string,
  salt: Buffer,
  iv: Buffer,
  authTag: Buffer,
): Buffer {
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
