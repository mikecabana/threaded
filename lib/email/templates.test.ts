import { describe, expect, it } from "vitest";
import {
  planLapsedEmail,
  postFailedEmail,
  rechargeDeclinedEmail,
  reconnectSoonEmail,
  snippet,
  verifyEmail,
} from "./templates";

const url = "https://getthreaded.app/queue?x=1&y=2";

describe("email templates", () => {
  it("escapes what the user wrote, in HTML only", () => {
    const email = postFailedEmail({ text: 'Ship <b>it</b> & "go"', reason: "Threads said no.", url });
    expect(email.html).toContain("Ship &lt;b&gt;it&lt;/b&gt; &amp; &quot;go&quot;");
    expect(email.html).toContain('href="https://getthreaded.app/queue?x=1&amp;y=2"');
    expect(email.text).toContain('"Ship <b>it</b> & "go""');
    expect(email.text).toContain(`Open your Queue: ${url}`);
  });

  it("gives every alert a subject, one action and the way to stop them", () => {
    for (const email of [
      postFailedEmail({ text: "Hi", reason: "No.", url }),
      rechargeDeclinedEmail({ message: "Your card was declined.", url }),
      planLapsedEmail({ url }),
      reconnectSoonEmail({ username: "maya", lapsesOn: "Monday, November 2", url }),
    ]) {
      expect(email.subject.length).toBeGreaterThan(10);
      expect(email.text).toContain(url);
      expect(email.text).toContain("Remove it in Settings to stop alerts.");
    }
    expect(verifyEmail({ url }).text).toContain("If you didn't ask for this, ignore it");
  });

  it("shortens long posts on a word boundary", () => {
    expect(snippet("short")).toBe("short");
    expect(snippet(`${"word ".repeat(30)}end`, 20)).toBe("word word word word…");
  });
});
