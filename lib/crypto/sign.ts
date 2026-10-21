import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/env";

/** URL-safe random token with `bytes` of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function mac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/** Appends an HMAC so a value round-tripped through the client can't be altered. */
export function sign(value: string, secret = requireEnv("SESSION_SECRET")): string {
  return `${value}.${mac(value, secret)}`;
}

/** Returns the original value, or null if the signature doesn't match. */
export function unsign(signed: string, secret = requireEnv("SESSION_SECRET")): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  return safeEqual(signed.slice(dot + 1), mac(value, secret)) ? value : null;
}
