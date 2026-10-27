import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubEvent, scrubText } from "./scrub";

describe("what reaches Sentry", () => {
  it("takes secrets out of URLs and messages", () => {
    expect(scrubText("GET https://graph.threads.net/v1.0/me?fields=id&access_token=THQWJ123abc&x=1")).toBe(
      "GET https://graph.threads.net/v1.0/me?fields=id&access_token=[Filtered]&x=1",
    );
    expect(scrubText("/api/auth/threads/callback?code=AQB12&state=sig.payload")).toBe(
      "/api/auth/threads/callback?code=[Filtered]&state=[Filtered]",
    );
    expect(scrubText("Authorization: Bearer vck_live_secret.value")).toBe("Authorization: Bearer [Filtered]");
    expect(scrubText("Stripe said no to sk_live_51abcDEFghiJKL")).toBe("Stripe said no to [Filtered]");
  });

  it("never quotes a failing database row", () => {
    expect(
      scrubText(
        'null value in column "x" violates not-null constraint. Failing row contains (p1, My private draft, 2026).',
      ),
    ).toBe('null value in column "x" violates not-null constraint. Failing row contains ([Filtered]).');
    expect(scrubText("Key (email)=(someone@example.com) already exists.")).toBe(
      "Key (email)=([Filtered]) already exists.",
    );
  });

  it("drops request bodies, cookies, headers and the user, keeping the route", () => {
    const event = scrubEvent({
      type: undefined,
      message: "Generation failed",
      user: { id: "u1", ip_address: "203.0.113.9" },
      request: {
        method: "POST",
        url: "https://getthreaded.app/api/generate?token=abc",
        data: { topic: "my secret launch" },
        cookies: { threaded_session: "s" },
        headers: { cookie: "threaded_session=s", "user-agent": "x" },
      },
      exception: { values: [{ type: "Error", value: "Failing row contains (secret post)" }] },
      breadcrumbs: [
        { category: "console", message: "Draft: my secret launch" },
        { category: "fetch", data: { url: "https://graph.threads.net/me?access_token=abc", method: "GET" } },
      ],
    } as ErrorEvent);
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({
      method: "POST",
      url: "https://getthreaded.app/api/generate?token=[Filtered]",
      query_string: undefined,
    });
    expect(event.exception?.values?.[0].value).toBe("Failing row contains ([Filtered])");
    expect(event.breadcrumbs).toEqual([
      { category: "fetch", data: { url: "https://graph.threads.net/me?access_token=[Filtered]", method: "GET" } },
    ]);
    expect(JSON.stringify(event)).not.toContain("secret");
  });

  it("keeps navigation breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "navigation", data: { from: "/home", to: "/studio" } })).toEqual({
      category: "navigation",
      message: undefined,
      data: { from: "/home", to: "/studio" },
    });
  });
});
