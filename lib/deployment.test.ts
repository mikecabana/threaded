import { describe, expect, it } from "vitest";
import { relayOrigin, relayState } from "./auth/oauth-relay";
import { isPreviewOrigin, productionOrigin, signInAvailableHere, threadsCallbackUrl } from "./deployment";

const vercel = {
  VERCEL_PROJECT_PRODUCTION_URL: "threaded.vercel.app",
  PREVIEW_ORIGINS: "https://threaded-*-acme.vercel.app",
};

describe("deployment URLs", () => {
  it("uses Vercel's production domain until one is set explicitly", () => {
    expect(productionOrigin(vercel)).toBe("https://threaded.vercel.app");
    expect(threadsCallbackUrl(vercel)).toBe("https://threaded.vercel.app/api/auth/threads/callback");
    // Adding a custom domain in Vercel changes VERCEL_PROJECT_PRODUCTION_URL; APP_URL and the redirect override win.
    expect(productionOrigin({ ...vercel, APP_URL: "https://threaded.app/x" })).toBe("https://threaded.app");
    expect(threadsCallbackUrl({ ...vercel, THREADS_REDIRECT_URI: "http://localhost:3000/cb" })).toBe(
      "http://localhost:3000/cb",
    );
    expect(threadsCallbackUrl({})).toBeNull();
  });

  it("matches this project's preview URLs and nothing else", () => {
    expect(isPreviewOrigin("https://threaded-git-feature-x-acme.vercel.app", vercel)).toBe(true);
    expect(isPreviewOrigin("https://threaded-3k2j1h7-acme.vercel.app", vercel)).toBe(true);
    expect(isPreviewOrigin("https://threaded-3k2j1h7-evil.vercel.app", vercel)).toBe(false);
    expect(isPreviewOrigin("https://threaded-x-acme.vercel.app.evil.com", vercel)).toBe(false);
    expect(isPreviewOrigin("https://threaded.vercel.app", vercel)).toBe(false);
    expect(isPreviewOrigin("https://threaded-x-acme.vercel.app", {})).toBe(false);
  });

  it("offers sign-in on production, and on previews only when they're allowed", () => {
    expect(signInAvailableHere({ ...vercel, VERCEL_ENV: "production" })).toBe(true);
    expect(
      signInAvailableHere({ ...vercel, VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "threaded-git-demo-acme.vercel.app" }),
    ).toBe(true);
    expect(
      signInAvailableHere({
        ...vercel,
        PREVIEW_ORIGINS: "",
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "threaded-git-demo-acme.vercel.app",
      }),
    ).toBe(false);
    expect(signInAvailableHere({ VERCEL_ENV: "production" })).toBe(false);
  });
});

describe("OAuth relay state", () => {
  const origin = "https://threaded-git-demo-acme.vercel.app";

  it("carries the preview's origin, signed with the app secret", () => {
    const state = relayState("nonce1234567890abcdef", origin, "app-secret");
    expect(relayOrigin(state, "app-secret")).toBe(origin);
    expect(relayOrigin(state, "other-secret")).toBeNull();
  });

  it("rejects tampered and ordinary states", () => {
    const state = relayState("nonce1234567890abcdef", origin, "app-secret");
    const [nonce, , signature] = state.split(".");
    const forged = `${nonce}.${Buffer.from("https://evil.example").toString("base64url")}.${signature}`;
    expect(relayOrigin(forged, "app-secret")).toBeNull();
    expect(relayOrigin("plainRandomStateWithoutDots", "app-secret")).toBeNull();
    expect(relayOrigin(null, "app-secret")).toBeNull();
  });
});
