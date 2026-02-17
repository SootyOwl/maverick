import { describe, it, expect } from "vitest";
import {
  generateRecoveryPhrase,
  validateRecoveryPhrase,
  derivePrivateKey,
  normalizePhrase,
} from "../src/identity/recovery-phrase.js";
import { WORDLIST } from "../src/identity/wordlist.js";

describe("normalizePhrase", () => {
  it("lowercases all words", () => {
    expect(normalizePhrase("HELLO WORLD")).toBe("hello world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizePhrase("  hello world  ")).toBe("hello world");
  });

  it("collapses multiple spaces between words", () => {
    expect(normalizePhrase("hello   world   foo")).toBe("hello world foo");
  });

  it("handles mixed case, extra spaces, and whitespace together", () => {
    expect(normalizePhrase("  Hello   WORLD  foo  ")).toBe("hello world foo");
  });

  it("handles tabs and newlines as whitespace", () => {
    expect(normalizePhrase("\thello\n  world\t")).toBe("hello world");
  });
});

describe("generateRecoveryPhrase", () => {
  it("returns exactly 6 words", () => {
    const phrase = generateRecoveryPhrase();
    const words = phrase.split(" ");
    expect(words).toHaveLength(6);
  });

  it("all words are in the WORDLIST", () => {
    const phrase = generateRecoveryPhrase();
    const wordSet = new Set(WORDLIST);
    const words = phrase.split(" ");
    for (const word of words) {
      expect(wordSet.has(word)).toBe(true);
    }
  });

  it("words are lowercase", () => {
    const phrase = generateRecoveryPhrase();
    expect(phrase).toBe(phrase.toLowerCase());
  });

  it("generates different phrases on subsequent calls", () => {
    // With 7776^6 possible phrases, collision probability is negligible
    const phrases = new Set<string>();
    for (let i = 0; i < 10; i++) {
      phrases.add(generateRecoveryPhrase());
    }
    // At least 9 out of 10 should be unique (virtually guaranteed all 10)
    expect(phrases.size).toBeGreaterThanOrEqual(9);
  });

  it("generated phrase validates successfully", () => {
    const phrase = generateRecoveryPhrase();
    expect(validateRecoveryPhrase(phrase)).toBe(true);
  });
});

describe("validateRecoveryPhrase", () => {
  it("accepts a valid 6-word phrase from the wordlist", () => {
    // Pick 6 known words from the wordlist
    const phrase = [
      WORDLIST[0],
      WORDLIST[100],
      WORDLIST[200],
      WORDLIST[300],
      WORDLIST[400],
      WORDLIST[500],
    ].join(" ");
    expect(validateRecoveryPhrase(phrase)).toBe(true);
  });

  it("is case-insensitive", () => {
    const phrase = [
      WORDLIST[0].toUpperCase(),
      WORDLIST[100],
      WORDLIST[200].toUpperCase(),
      WORDLIST[300],
      WORDLIST[400],
      WORDLIST[500],
    ].join(" ");
    expect(validateRecoveryPhrase(phrase)).toBe(true);
  });

  it("handles extra whitespace", () => {
    const phrase = `  ${WORDLIST[0]}   ${WORDLIST[100]}  ${WORDLIST[200]}  ${WORDLIST[300]}  ${WORDLIST[400]}  ${WORDLIST[500]}  `;
    expect(validateRecoveryPhrase(phrase)).toBe(true);
  });

  it("rejects a phrase with fewer than 6 words", () => {
    const phrase = [WORDLIST[0], WORDLIST[100], WORDLIST[200]].join(" ");
    expect(validateRecoveryPhrase(phrase)).toBe(false);
  });

  it("rejects a phrase with more than 6 words", () => {
    const phrase = [
      WORDLIST[0],
      WORDLIST[100],
      WORDLIST[200],
      WORDLIST[300],
      WORDLIST[400],
      WORDLIST[500],
      WORDLIST[600],
    ].join(" ");
    expect(validateRecoveryPhrase(phrase)).toBe(false);
  });

  it("rejects a phrase with words not in the wordlist", () => {
    const phrase = "foo bar baz qux quux corge";
    expect(validateRecoveryPhrase(phrase)).toBe(false);
  });

  it("rejects a phrase with some valid and some invalid words", () => {
    const phrase = `${WORDLIST[0]} ${WORDLIST[100]} xyzzy ${WORDLIST[300]} ${WORDLIST[400]} ${WORDLIST[500]}`;
    expect(validateRecoveryPhrase(phrase)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateRecoveryPhrase("")).toBe(false);
  });

  it("rejects a single word", () => {
    expect(validateRecoveryPhrase(WORDLIST[0])).toBe(false);
  });
});

describe("derivePrivateKey", () => {
  // Use fixed phrase and DID for determinism tests
  const testPhrase = `${WORDLIST[0]} ${WORDLIST[100]} ${WORDLIST[200]} ${WORDLIST[300]} ${WORDLIST[400]} ${WORDLIST[500]}`;
  const testDid = "did:plc:testuser123456";
  const altDid = "did:plc:otheruser789012";

  it("returns a 0x-prefixed hex string of 66 characters", () => {
    const key = derivePrivateKey(testPhrase, testDid);
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    expect(key).toHaveLength(66);
  });

  it("is deterministic: same phrase + same DID produces the same key", () => {
    const key1 = derivePrivateKey(testPhrase, testDid);
    const key2 = derivePrivateKey(testPhrase, testDid);
    expect(key1).toBe(key2);
  });

  it("produces different keys for different DIDs with the same phrase", () => {
    const key1 = derivePrivateKey(testPhrase, testDid);
    const key2 = derivePrivateKey(testPhrase, altDid);
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different phrases with the same DID", () => {
    const altPhrase = `${WORDLIST[10]} ${WORDLIST[110]} ${WORDLIST[210]} ${WORDLIST[310]} ${WORDLIST[410]} ${WORDLIST[510]}`;
    const key1 = derivePrivateKey(testPhrase, testDid);
    const key2 = derivePrivateKey(altPhrase, testDid);
    expect(key1).not.toBe(key2);
  });

  it("normalizes input phrase before derivation", () => {
    const messyPhrase = `  ${WORDLIST[0].toUpperCase()}   ${WORDLIST[100]}  ${WORDLIST[200]}  ${WORDLIST[300]}   ${WORDLIST[400]}  ${WORDLIST[500]}  `;
    const key1 = derivePrivateKey(testPhrase, testDid);
    const key2 = derivePrivateKey(messyPhrase, testDid);
    expect(key1).toBe(key2);
  });

  it("produces a valid key that can create a viem account", async () => {
    const { privateKeyToAccount } = await import("viem/accounts");
    const key = derivePrivateKey(testPhrase, testDid);
    // Should not throw
    const account = privateKeyToAccount(key);
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
