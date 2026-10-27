"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  COOKIE_SETTINGS_EVENT,
  type ConsentChoice,
  type ConsentConfig,
  consentSignals,
  readChoice,
  saveChoice,
} from "@/lib/consent/consent";

// The cookie banner. Tag Manager is already running by the time this mounts:
// consentBootScript (in the root layout) set Consent Mode's defaults for the
// visitor's region, or from their saved choice, and loaded it. This asks
// where the law says to, then updates consent and saves the choice, which
// becomes the default on later visits. Nothing shows without a container
// (GTM_ID).

type Choices = Pick<ConsentChoice, "analytics" | "advertising">;

function gtag(..._args: unknown[]) {
  // Consent Mode reads the arguments object, as Google's own gtag() pushes it.
  window.dataLayer = window.dataLayer ?? [];
  // biome-ignore lint/complexity/noArguments: the dataLayer expects the arguments object
  window.dataLayer.push(arguments);
}

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export function ConsentManager() {
  const [config, setConfig] = useState<ConsentConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [choices, setChoices] = useState<Choices>({ analytics: false, advertising: false });

  useEffect(() => {
    let active = true;
    Promise.resolve(window.threadedConsent ?? null)
      .then((result) => {
        if (!active || !result) return;
        setConfig(result);
        document.documentElement.dataset.cookieChoices = "on";
        setChoices(result.stored ?? { analytics: !result.required, advertising: !result.required });
        if (result.required && !result.stored) setOpen(true);
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
    saveChoice(storage(), { ...next, at: new Date().toISOString() });
    gtag("consent", "update", consentSignals(next));
    setChoices(next);
    setOpen(false);
    setChoosing(false);
  }

  return (
    <section
      aria-label="Cookie choices"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg rounded-2xl border border-border-strong bg-surface p-4 shadow-2xl sm:bottom-5"
    >
      <h2 className="font-medium text-sm">Cookies and measurement</h2>
      <p className="mt-1 text-muted text-sm leading-relaxed">
        {config.required
          ? "We'd like to use optional cookies to see how people find and use Threaded, and to measure our ads. They stay off unless you turn them on."
          : "We use optional cookies to see how people find and use Threaded, and to measure our ads. They're on now, and you can turn them off here."}{" "}
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
