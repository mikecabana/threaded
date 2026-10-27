"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  COOKIE_SETTINGS_EVENT,
  type ConsentChoice,
  consentSignals,
  readChoice,
  saveChoice,
} from "@/lib/consent/consent";

// Loads Google Tag Manager under Consent Mode v2 (lib/consent/consent.ts) and
// asks first where the law says to. Nothing loads, and no banner shows,
// without a container configured (GTM_ID).

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

type Choices = Pick<ConsentChoice, "analytics" | "advertising">;

function gtag(..._args: unknown[]) {
  // Consent Mode reads the arguments object, as Google's own gtag() pushes it.
  // biome-ignore lint/complexity/noArguments: the dataLayer expects the arguments object
  window.dataLayer?.push(arguments);
}

let tagsLoaded = false;

/** Applies a choice: updates consent if Tag Manager is running, else loads it when anything is allowed. */
function applyChoice(gtmId: string, choices: Choices) {
  window.dataLayer = window.dataLayer ?? [];
  const signals = consentSignals(choices);
  if (tagsLoaded) {
    gtag("consent", "update", signals);
    return;
  }
  // With everything declined, Tag Manager doesn't load at all.
  if (!choices.analytics && !choices.advertising) return;
  gtag("consent", "default", signals);
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
  document.head.appendChild(script);
  tagsLoaded = true;
}

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export function ConsentManager() {
  const [config, setConfig] = useState<{ gtmId: string; required: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [choices, setChoices] = useState<Choices>({ analytics: false, advertising: false });

  useEffect(() => {
    let active = true;
    fetch("/api/consent", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((result: { gtmId: string | null; required: boolean } | null) => {
        if (!active || !result?.gtmId) return;
        const gtmId = result.gtmId;
        setConfig({ gtmId, required: result.required });
        document.documentElement.dataset.cookieChoices = "on";
        const stored = readChoice(storage());
        if (stored) {
          setChoices(stored);
          applyChoice(gtmId, stored);
        } else if (result.required) {
          setOpen(true);
        } else {
          const allowed = { analytics: true, advertising: true };
          setChoices(allowed);
          applyChoice(gtmId, allowed);
        }
      })
      .catch(() => {});
    const reopen = () => {
      setChoosing(true);
      setOpen(true);
    };
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen);
    return () => {
      active = false;
      window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen);
    };
  }, []);

  if (!config || !open) return null;

  function decide(next: Choices) {
    if (!config) return;
    saveChoice(storage(), { ...next, at: new Date().toISOString() });
    setChoices(next);
    applyChoice(config.gtmId, next);
    setOpen(false);
    setChoosing(false);
  }

  return (
    <section
      aria-label="Cookie choices"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg rounded-2xl border border-border-strong bg-surface p-4 shadow-2xl sm:bottom-5"
    >
      <h2 className="font-medium text-sm">Cookies for measuring visits</h2>
      <p className="mt-1 text-muted text-sm leading-relaxed">
        Threaded uses Google Tag Manager to see how people find and use the site.{" "}
        {config.required
          ? "Those cookies stay off unless you turn them on."
          : "They're on now, and you can turn them off here."}{" "}
        <Link href="/legal/privacy#cookies" className="text-fg underline underline-offset-2">
          Privacy
        </Link>
      </p>
      {choosing && (
        <fieldset className="mt-3 grid gap-2 text-sm">
          <legend className="sr-only">Optional cookies</legend>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={choices.analytics}
              onChange={(e) => setChoices((c) => ({ ...c, analytics: e.target.checked }))}
            />
            <span>
              <span className="font-medium">Analytics</span>
              <span className="block text-muted">Count visits and see which pages help.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={choices.advertising}
              onChange={(e) => setChoices((c) => ({ ...c, advertising: e.target.checked }))}
            />
            <span>
              <span className="font-medium">Advertising</span>
              <span className="block text-muted">Measure our ads and show relevant ones.</span>
            </span>
          </label>
        </fieldset>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {choosing ? (
          <>
            <Button size="sm" onClick={() => decide(choices)}>
              Save choices
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // Before a first answer where one is needed, go back to the three choices.
                if (config.required && !readChoice(storage())) setChoosing(false);
                else setOpen(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => decide({ analytics: true, advertising: true })}>
              Accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => decide({ analytics: false, advertising: false })}>
              Decline
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChoosing(true)}>
              Choose
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

/** Reopens the cookie choices, or explains them on the Privacy page when there are none to make. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (document.documentElement.dataset.cookieChoices === "on") {
          window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT));
        } else {
          window.location.assign("/legal/privacy#cookies");
        }
      }}
    >
      Cookie settings
    </button>
  );
}
