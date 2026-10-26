// Alert emails: plain, short, one action each. Every email has an HTML part
// (inline styles, since email clients ignore stylesheets) and a text part.
// Pure functions, so they're easy to test.

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** A post's opening, for a subject line or a quote. */
export function snippet(text: string, max = 80): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

const ALERT_FOOTER =
  "You're getting this because you added this address to Threaded. Remove it in Settings to stop alerts.";

function layout(input: {
  heading: string;
  paragraphs: string[];
  quote?: string;
  action: { label: string; url: string };
  footer?: string;
}): { html: string; text: string } {
  const footer = input.footer ?? ALERT_FOOTER;
  const paragraph = (p: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#27272a">${escapeHtml(p)}</p>`;
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px">
    <tr><td style="padding:28px 28px 8px">
      <p style="margin:0 0 20px;font-size:14px;font-weight:600;color:#0a0a0b">Threaded</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0a0a0b">${escapeHtml(input.heading)}</h1>
      ${input.paragraphs.map(paragraph).join("\n      ")}
      ${
        input.quote
          ? `<p style="margin:0 0 16px;padding:12px 14px;border-left:3px solid #d4d4d8;background:#fafafa;font-size:14px;line-height:1.5;color:#3f3f46">${escapeHtml(input.quote)}</p>`
          : ""
      }
      <p style="margin:8px 0 24px"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;padding:11px 18px;border-radius:999px;background:#0a0a0b;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">${escapeHtml(input.action.label)}</a></p>
    </td></tr>
    <tr><td style="padding:16px 28px 24px;border-top:1px solid #f4f4f5">
      <p style="margin:0;font-size:12px;line-height:1.5;color:#71717a">${escapeHtml(footer)}</p>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [
    input.heading,
    "",
    ...input.paragraphs.flatMap((p) => [p, ""]),
    ...(input.quote ? [`"${input.quote}"`, ""] : []),
    `${input.action.label}: ${input.action.url}`,
    "",
    "--",
    footer,
  ].join("\n");
  return { html, text };
}

export function verifyEmail(input: { url: string }): EmailContent {
  return {
    subject: "Confirm your email for Threaded alerts",
    ...layout({
      heading: "Confirm your email",
      paragraphs: [
        "Confirm this address and Threaded will email you when something needs you: a scheduled post that didn't go out, a card that was declined, or a Threads connection about to lapse.",
        "The link works for 24 hours.",
      ],
      action: { label: "Confirm email", url: input.url },
      footer: "If you didn't ask for this, ignore it and nothing changes.",
    }),
  };
}

export function postFailedEmail(input: { text: string; reason: string; url: string }): EmailContent {
  return {
    subject: "A scheduled post didn't go out",
    ...layout({
      heading: "A scheduled post didn't go out",
      paragraphs: [input.reason, "It's in your Queue: retry it, edit it, or remove it."],
      quote: snippet(input.text, 280),
      action: { label: "Open your Queue", url: input.url },
    }),
  };
}

export function rechargeDeclinedEmail(input: { message: string; url: string }): EmailContent {
  return {
    subject: "Auto-recharge couldn't charge your card",
    ...layout({
      heading: "Auto-recharge is off for now",
      paragraphs: [
        input.message,
        "Your credits never expire, so nothing you've bought is lost. Update your card and turn auto-recharge back on in Billing.",
      ],
      action: { label: "Open Billing", url: input.url },
    }),
  };
}

export function planLapsedEmail(input: { url: string }): EmailContent {
  return {
    subject: "Your Threaded plan has ended",
    ...layout({
      heading: "Your own-key plan has ended",
      paragraphs: [
        "Threaded is back on credits, so Studio keeps working, charged to your credit balance. Your saved key was removed with the plan.",
        "You can start the plan again any time from Billing.",
      ],
      action: { label: "Open Billing", url: input.url },
    }),
  };
}

export function reconnectSoonEmail(input: { username: string; lapsesOn: string; url: string }): EmailContent {
  return {
    subject: "Reconnect Threads to keep posting from Threaded",
    ...layout({
      heading: `Threaded loses access to @${input.username} on ${input.lapsesOn}`,
      paragraphs: [
        "Threads asks private profiles to approve apps again every 90 days. Until you do, scheduled posts can't go out and your numbers stop updating.",
        "Reconnecting takes a few seconds, and keeps everything you've set up.",
      ],
      action: { label: "Reconnect Threads", url: input.url },
    }),
  };
}
