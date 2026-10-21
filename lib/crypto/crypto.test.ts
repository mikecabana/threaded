import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, needsRotation, parseKeyring } from "./secrets";
import { safeEqual, sign, unsign } from "./sign";

const key = () => randomBytes(32).toString("base64");

describe("secrets", () => {
  const ring = parseKeyring(`k2:${key()},k1:${key()}`);

  it("round-trips with the current key", () => {
    const sealed = encryptSecret("token-123", "profile:1", ring);
    expect(sealed.startsWith("k2.")).toBe(true);
    expect(decryptSecret(sealed, "profile:1", ring)).toBe("token-123");
  });

  it("uses a fresh IV every time", () => {
    expect(encryptSecret("same", "ctx", ring)).not.toBe(encryptSecret("same", "ctx", ring));
  });

  it("refuses a ciphertext moved to another context", () => {
    const sealed = encryptSecret("token-123", "profile:1", ring);
    expect(() => decryptSecret(sealed, "profile:2", ring)).toThrow();
  });

  it("refuses tampered ciphertext", () => {
    const [id, iv, data, tag] = encryptSecret("token-123", "ctx", ring).split(".");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] ^= 1;
    expect(() => decryptSecret([id, iv, flipped.toString("base64url"), tag].join("."), "ctx", ring)).toThrow();
  });

  it("decrypts with an older key and flags it for rotation", () => {
    const old = parseKeyring(`k1:${key()}`);
    const sealed = encryptSecret("legacy", "ctx", old);
    const rotated = { currentId: "k2", keys: new Map([...ring.keys].filter(([id]) => id === "k2")) };
    rotated.keys.set("k1", old.keys.get("k1") as Buffer);
    expect(decryptSecret(sealed, "ctx", rotated)).toBe("legacy");
    expect(needsRotation(sealed, rotated)).toBe(true);
  });

  it("accepts a bare key as k1 and rejects bad keys", () => {
    expect(parseKeyring(key()).currentId).toBe("k1");
    expect(() => parseKeyring("short:AAAA")).toThrow(/32 bytes/);
    expect(() => parseKeyring("")).toThrow();
  });
});

describe("sign", () => {
  it("round-trips and rejects tampering", () => {
    const signed = sign("state.with.dots", "secret");
    expect(unsign(signed, "secret")).toBe("state.with.dots");
    expect(unsign(signed.replace("state", "State"), "secret")).toBeNull();
    expect(unsign(signed, "other-secret")).toBeNull();
    expect(unsign("no-signature", "secret")).toBeNull();
  });

  it("compares in constant time without throwing on length mismatch", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
