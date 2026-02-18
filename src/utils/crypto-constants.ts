/**
 * Shared scrypt parameters for key derivation.
 *
 * Used by both `storage/keys.ts` (legacy encrypted-key decryption) and
 * `identity/recovery-phrase.ts` (phrase → private-key derivation).
 *
 * N = 2^17 (131 072) — CPU/memory cost
 * r = 8              — block size
 * p = 1              — parallelization
 * maxmem = 256 MiB   — Node.js scryptSync memory limit
 * keyLen = 32         — output length in bytes (256-bit AES / secp256k1 key)
 */
export const SCRYPT_PARAMS = {
  N: 131072,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
  keyLen: 32,
} as const;
