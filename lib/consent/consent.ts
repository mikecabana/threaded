// Cookie consent (docs/PLAN.md §13). Threaded's own cookies only keep people
// signed in, so they need no consent; the optional ones come from Google Tag
// Manager (analytics and advertising). Where the law asks first (Quebec under
// Law 25, the EU/EEA, the UK and Switzerland) they stay off until the visitor
// says yes; elsewhere they're on, and "Cookie settings" turns them off. This
// module is shared by the server (the region) and the browser (the choice).

// The EU and EEA, then the UK and Switzerland.
const OPT_IN_COUNTRIES = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH".split(" "),
);

export interface Geo {
  country: string | null;
  /** Province or state code, e.g. "QC". */
  region: string | null;
}

const upper = (value: string | null) => value?.trim().toUpperCase() || null;

/**
 * Where a request comes from. Behind Cloudflare, Vercel only sees Cloudflare's
 * address, so Cloudflare's headers win (the region needs its "visitor
 * location headers" transform); otherwise Vercel's.
 */
export function geoFrom(headers: Headers): Geo {
  const cloudflare = upper(headers.get("cf-ipcountry"));
  if (cloudflare) return { country: cloudflare, region: upper(headers.get("cf-region-code")) };
  return {
    country: upper(headers.get("x-vercel-ip-country")),
    region: upper(headers.get("x-vercel-ip-country-region")),
  };
}

/** Whether optional cookies wait for a yes. When the location is unclear, they do. */
export function consentRequired({ country, region }: Geo): boolean {
  // XX: unknown; T1: Tor.
  if (!country || country === "XX" || country === "T1") return true;
  if (country === "CA") return region === null || region === "QC";
  return OPT_IN_COUNTRIES.has(country);
}

export interface ConsentChoice {
  analytics: boolean;
  advertising: boolean;
  /** When it was made (ISO), the record Law 25 asks us to be able to show. */
  at: string;
}

export const CONSENT_KEY = "threaded-consent";
/** Fired by "Cookie settings" links to reopen the choices. */
export const COOKIE_SETTINGS_EVENT = "threaded:cookie-settings";

type Signal = "granted" | "denied";

/** Google Consent Mode v2 signals for a choice. */
export function consentSignals(choice: Pick<ConsentChoice, "analytics" | "advertising">): Record<string, Signal> {
  const ads: Signal = choice.advertising ? "granted" : "denied";
  return {
    analytics_storage: choice.analytics ? "granted" : "denied",
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
  };
}

/** A stored choice, if there's a valid one. Storage can be missing or blocked, so this never throws. */
export function readChoice(storage: Pick<Storage, "getItem"> | undefined): ConsentChoice | null {
  try {
    const parsed = JSON.parse(storage?.getItem(CONSENT_KEY) ?? "null") as Partial<ConsentChoice> | null;
    if (typeof parsed?.analytics !== "boolean" || typeof parsed.advertising !== "boolean") return null;
    return { analytics: parsed.analytics, advertising: parsed.advertising, at: String(parsed.at ?? "") };
  } catch {
    return null;
  }
}

export function saveChoice(storage: Pick<Storage, "setItem"> | undefined, choice: ConsentChoice): void {
  try {
    storage?.setItem(CONSENT_KEY, JSON.stringify(choice));
  } catch {
    // Blocked storage: the choice holds for this page, and the banner asks again next time.
  }
}
