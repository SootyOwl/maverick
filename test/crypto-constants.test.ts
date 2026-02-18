import { describe, it, expect } from "vitest";
import { SCRYPT_PARAMS } from "../src/utils/crypto-constants.js";

describe("SCRYPT_PARAMS shared constants", () => {
  it("N is 2^17 (131072)", () => {
    expect(SCRYPT_PARAMS.N).toBe(2 ** 17);
    expect(SCRYPT_PARAMS.N).toBe(131072);
  });

  it("r (block size) is 8", () => {
    expect(SCRYPT_PARAMS.r).toBe(8);
  });

  it("p (parallelization) is 1", () => {
    expect(SCRYPT_PARAMS.p).toBe(1);
  });

  it("maxmem is 256 MiB", () => {
    expect(SCRYPT_PARAMS.maxmem).toBe(256 * 1024 * 1024);
  });

  it("keyLen is 32 bytes (256 bits)", () => {
    expect(SCRYPT_PARAMS.keyLen).toBe(32);
  });

  it("object is frozen (as const)", () => {
    // Verify that the object shape has exactly the expected keys
    const keys = Object.keys(SCRYPT_PARAMS).sort();
    expect(keys).toEqual(["N", "keyLen", "maxmem", "p", "r"]);
  });
});
