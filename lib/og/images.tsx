import "server-only";
import { ImageResponse } from "next/og";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import { siteUrl } from "@/lib/seo";
import { SITE } from "@/lib/site";
import { OG_FONTS } from "./fonts";

// Share images (Open Graph and X cards), drawn with ImageResponse in the
// app's dark theme. The landing image shows the product the way the hero
// does, with the same demo persona; other pages get a titled card.

export const OG_SIZE = { width: 1200, height: 630 };

const COLOR = {
  bg: "#0a0a0b",
  surface: "#141416",
  surface2: "#1c1c1f",
  border: "rgba(255,255,255,0.10)",
  fg: "#f5f5f6",
  muted: "#9a9aa1",
  subtle: "#63636a",
  // The goal accents (app/globals.css), converted from oklch.
  followers: "#a981ff",
  views: "#25d2fc",
  engagement: "#ff6e74",
};

/** The logo mark: an avatar, the thread line, and the next post in the accent. */
function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="5.5" r="3.5" fill="none" stroke={COLOR.fg} strokeWidth="2" />
      <path d="M12 9v6" stroke={COLOR.fg} strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="18.5" r="3.5" fill={COLOR.engagement} />
    </svg>
  );
}

function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Mark size={40} />
      <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: -0.5 }}>{SITE.name}</span>
    </div>
  );
}

/** A soft accent glow behind the content. */
function Glow({ x, y, color }: { x: string; y: string; color: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        backgroundImage: `radial-gradient(circle at ${x} ${y}, ${color}33 0%, ${color}00 45%)`,
      }}
    />
  );
}

/** The goal-fit score ring from Studio. */
function Ring({ value }: { value: number }) {
  const r = 20;
  const circumference = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", position: "relative", width: 52, height: 52 }}>
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden>
        <circle cx="26" cy="26" r={r} fill="none" stroke={COLOR.surface2} strokeWidth="5" />
        <circle
          cx="26"
          cy="26"
          r={r}
          fill="none"
          stroke={COLOR.engagement}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
          transform="rotate(-90 26 26)"
        />
      </svg>
      <span
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 52,
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 17,
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Author({ name, username }: { name: string; username: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        style={{
          display: "flex",
          width: 40,
          height: 40,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          backgroundImage: `linear-gradient(135deg, ${COLOR.engagement}, #f2a65a)`,
          color: COLOR.bg,
          fontSize: 17,
          fontWeight: 600,
        }}
      >
        {name
          .split(" ")
          .map((part) => part[0])
          .join("")}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{name}</span>
        <span style={{ fontSize: 15, color: COLOR.subtle }}>@{username}</span>
      </div>
    </div>
  );
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The words of a headline as separate boxes, so mixed fonts wrap like one line of text. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((word, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed sentence
        <span key={i} style={{ marginRight: 16 }}>
          {word}
        </span>
      ))}
    </>
  );
}

/** The home page's share image: the promise, the goals, and a suggested post next to the author's best. */
export function landingImage() {
  const persona = DEMO_PERSONAS.creator;
  const idea = persona.suggestions.engagement[0];
  const best = persona.posts[7];
  const goals = [
    { label: "More Followers", color: COLOR.followers },
    { label: "More Views", color: COLOR.views },
    { label: "More Engagement", color: COLOR.engagement },
  ];

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        backgroundColor: COLOR.bg,
        color: COLOR.fg,
        fontFamily: "Geist",
      }}
    >
      <Glow x="82%" y="30%" color={COLOR.engagement} />
      <Glow x="8%" y="100%" color={COLOR.followers} />

      <div style={{ display: "flex", flexDirection: "column", width: 640, padding: "64px 0 64px 72px" }}>
        <Wordmark />
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            marginTop: 52,
            fontSize: 62,
            fontWeight: 600,
            lineHeight: 1.08,
            letterSpacing: -2,
          }}
        >
          <Words text="Grow on Threads with posts that sound like" />
          <span
            style={{
              fontFamily: "Instrument Serif",
              fontStyle: "italic",
              fontWeight: 400,
              color: COLOR.engagement,
              letterSpacing: 0,
            }}
          >
            you.
          </span>
        </div>
        <p style={{ marginTop: 28, fontSize: 26, lineHeight: 1.4, color: COLOR.muted }}>
          AI post ideas, analytics and scheduling, tuned to what your audience rewards.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: "auto" }}>
          {goals.map((goal) => (
            <div
              key={goal.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 16px",
                borderRadius: 999,
                border: `1px solid ${COLOR.border}`,
                backgroundColor: COLOR.surface,
                fontSize: 18,
              }}
            >
              <div style={{ display: "flex", width: 10, height: 10, borderRadius: 999, backgroundColor: goal.color }} />
              {goal.label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", width: 460, marginLeft: 28, paddingTop: 64 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: 24,
            borderRadius: 24,
            border: `1px solid ${COLOR.border}`,
            backgroundColor: COLOR.surface,
          }}
        >
          <span style={{ fontSize: 13, letterSpacing: 1.5, color: COLOR.subtle }}>YOUR BEST POST THIS MONTH</span>
          <div style={{ display: "flex", marginTop: 16 }}>
            <Author name={persona.profile.name ?? persona.profile.username} username={persona.profile.username} />
          </div>
          <p style={{ marginTop: 14, marginBottom: 0, fontSize: 18, lineHeight: 1.45, color: COLOR.muted }}>
            {clip(best.text, 90)}
          </p>
        </div>

        <div style={{ display: "flex", height: 34, paddingLeft: 43 }}>
          <div style={{ display: "flex", width: 3, height: "100%", backgroundColor: COLOR.engagement, opacity: 0.7 }} />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: 24,
            borderRadius: 24,
            border: `1px solid ${COLOR.engagement}66`,
            backgroundColor: COLOR.surface,
            boxShadow: `0 24px 64px -24px ${COLOR.engagement}80`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, letterSpacing: 1.5, color: COLOR.engagement }}>
              THREADED SUGGESTS · MORE ENGAGEMENT
            </span>
            <Ring value={idea.goalFit} />
          </div>
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 21, lineHeight: 1.45 }}>{clip(idea.text, 120)}</p>
          <div
            style={{
              display: "flex",
              marginTop: 16,
              padding: "10px 14px",
              borderRadius: 14,
              backgroundColor: COLOR.surface2,
              fontSize: 16,
              color: COLOR.muted,
            }}
          >
            <span style={{ flexShrink: 0, color: COLOR.fg, fontWeight: 600, marginRight: 6 }}>Why:</span>
            <span>{clip(idea.rationale, 90)}</span>
          </div>
        </div>
      </div>
    </div>,
    { ...OG_SIZE, fonts: OG_FONTS },
  );
}

/** A titled share image for any other public page. */
export function pageImage({ title, subtitle }: { title: string; subtitle: string }) {
  const host = siteUrl().host;
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        position: "relative",
        padding: 72,
        backgroundColor: COLOR.bg,
        color: COLOR.fg,
        fontFamily: "Geist",
      }}
    >
      <Glow x="90%" y="10%" color={COLOR.engagement} />
      <Glow x="0%" y="100%" color={COLOR.followers} />
      <Wordmark />
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
        <div style={{ display: "flex", width: 64, height: 4, borderRadius: 4, backgroundColor: COLOR.engagement }} />
        <h1 style={{ margin: "28px 0 0", fontSize: 76, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1.05 }}>
          {title}
        </h1>
        <p style={{ margin: "24px 0 0", maxWidth: 900, fontSize: 30, lineHeight: 1.4, color: COLOR.muted }}>
          {subtitle}
        </p>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 56,
          paddingTop: 28,
          borderTop: `1px solid ${COLOR.border}`,
          fontSize: 22,
          color: COLOR.subtle,
        }}
      >
        <span>{SITE.tagline}</span>
        <span>{host}</span>
      </div>
    </div>,
    { ...OG_SIZE, fonts: OG_FONTS },
  );
}

/** The home-screen icon for iOS (and the logo in structured data): the mark on the app's background. */
export function appleIcon() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: COLOR.bg,
      }}
    >
      <Mark size={120} />
    </div>,
    { width: 180, height: 180 },
  );
}
