import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayReachable } from "./models";

// Where Vercel's runtime puts the current request, headers included.
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
const runtime = globalThis as Record<symbol, unknown>;

describe("gatewayReachable", () => {
  afterEach(() => {
    delete runtime[REQUEST_CONTEXT];
    vi.unstubAllEnvs();
  });

  it("finds the OIDC token Vercel sends with each request", () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    expect(gatewayReachable()).toBe(false);
    runtime[REQUEST_CONTEXT] = { get: () => ({ headers: { "x-vercel-oidc-token": "token" } }) };
    expect(gatewayReachable()).toBe(true);
  });

  it("uses the pulled environment variable in local development", () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "token");
    expect(gatewayReachable()).toBe(true);
  });
});
