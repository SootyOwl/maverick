import { randomBytes, scryptSync } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { WORDLIST } from "./wordlist.js";
import { SCRYPT_PARAMS } from "../utils/crypto-constants.js";

const PHRASE_WORD_COUNT = 6;

// Maximum number of counter iterations for secp256k1 edge case
const MAX_DERIVE_ATTEMPTS = 256;

/**
 * Normalize a recovery phrase: lowercase, trim, collapse multiple spaces.
 */
export function normalizePhrase(phrase: string): string {
  return phrase.toLowerCase().trim().replace(/\s+/g, " ");
}

// Filter out hyphenated words (drop-down, felt-tip, t-shirt, yo-yo) from
// generation to avoid UX hazards: users writing "drop down" on paper would
// fail recovery. Validation still accepts them for forward compatibility.
const GENERATION_WORDLIST = WORDLIST.filter((w) => !w.includes("-"));

/**
 * Generate a 6-word recovery phrase from the EFF large Diceware wordlist.
 * Uses crypto.randomBytes for cryptographically secure random selection.
 * ~77 bits of entropy (6 * log2(7772) ≈ 77.5).
 */
export function generateRecoveryPhrase(): string {
  const words: string[] = [];
  const listLen = GENERATION_WORDLIST.length;
  for (let i = 0; i < PHRASE_WORD_COUNT; i++) {
    // Generate 2 random bytes (16 bits) for each word selection.
    // Rejection sampling to avoid modulo bias.
    let index: number;
    do {
      const buf = randomBytes(2);
      index = buf.readUInt16BE(0);
    } while (index >= Math.floor(65536 / listLen) * listLen);
    words.push(GENERATION_WORDLIST[index % listLen]);
  }
  return words.join(" ");
}

/**
 * Validate that a phrase has exactly 6 words and all words are in the WORDLIST.
 * Case-insensitive. Trims whitespace and collapses multiple spaces.
 */
export function validateRecoveryPhrase(phrase: string): boolean {
  const normalized = normalizePhrase(phrase);
  const words = normalized.split(" ");
  if (words.length !== PHRASE_WORD_COUNT) {
    return false;
  }
  // Build a Set for O(1) lookup (lazy-initialized via module scope)
  const wordSet = getWordSet();
  return words.every((word) => wordSet.has(word));
}

/**
 * Derive a deterministic private key from a recovery phrase and Bluesky DID.
 *
 * Uses scrypt(phrase, did) with the same parameters as keys.ts.
 * The DID acts as salt so the same phrase with different accounts produces different keys.
 *
 * Handles the (extremely unlikely ~1/2^128) secp256k1 edge case where the derived
 * value is not a valid private key by appending a counter byte and re-deriving.
 */
export function derivePrivateKey(
  phrase: string,
  did: string,
): `0x${string}` {
  const normalized = normalizePhrase(phrase);

  for (let counter = 0; counter < MAX_DERIVE_ATTEMPTS; counter++) {
    const input = counter === 0 ? normalized : `${normalized}\x00${counter}`;
    const derived = scryptSync(input, did, SCRYPT_PARAMS.keyLen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: SCRYPT_PARAMS.maxmem,
    }) as Buffer;

    const hex = `0x${derived.toString("hex")}` as `0x${string}`;

    try {
      // Validate that this is a valid secp256k1 private key
      privateKeyToAccount(hex);
      return hex;
    } catch {
      // Invalid secp256k1 key (value >= curve order or zero) — retry with counter
      continue;
    }
  }

  // This should never happen in practice (probability ~(1/2^128)^256)
  throw new Error(
    "Failed to derive a valid secp256k1 private key after maximum attempts",
  );
}

// Lazily-initialized Set for O(1) word lookup
let _wordSet: Set<string> | null = null;

function getWordSet(): Set<string> {
  if (_wordSet === null) {
    _wordSet = new Set(WORDLIST);
  }
  return _wordSet;
}
