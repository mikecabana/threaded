// Cookie consent (docs/PLAN.md §13). Threaded's own cookies only keep people
// signed in, so they need no consent; the optional ones (analytics and
// advertising) are set by tags in Google Tag Manager, which loads on every
// page under Google's Consent Mode v2. Where the law asks first (Quebec under
// Law 25, the EU/EEA, the UK and Switzerland) consent defaults to denied until
// the visitor says yes; elsewhere it defaults to granted, and "Cookie
// settings" turns it off. A saved choice is the default on later visits. This
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

/** What the page learns at load: the container, whether to ask first, and any saved choice. */
export interface ConsentConfig {
  gtmId: string;
  required: boolean;
  stored: ConsentChoice | null;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    /** Set by consentBootScript; resolves once consent defaults are in and Tag Manager is loading. */
    threadedConsent?: Promise<ConsentConfig | null>;
  }
}

/**
 * Runs inline in <head> on every page, before anything else can load tags:
 * asks /api/consent for the container and whether this visitor's region needs
 * consent first, sets Consent Mode's defaults (the saved choice if there is
 * one, else denied where consent is needed and granted elsewhere), then loads
 * Tag Manager. The banner (components/consent) only ever updates consent.
 * Mirrors readChoice and consentSignals; consent.test.ts checks they agree.
 */
export const consentBootScript = `(function(){
var w=window,d=document;
w.dataLayer=w.dataLayer||[];
function gtag(){w.dataLayer.push(arguments)}
function signals(c){var ads=c.advertising?"granted":"denied";return{analytics_storage:c.analytics?"granted":"denied",ad_storage:ads,ad_user_data:ads,ad_personalization:ads}}
var stored=null;
try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(CONSENT_KEY)})||"null");if(s&&typeof s.analytics==="boolean"&&typeof s.advertising==="boolean")stored={analytics:s.analytics,advertising:s.advertising,at:String(s.at||"")}}catch(e){}
w.threadedConsent=fetch("/api/consent",{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(c){
if(!c||!c.gtmId)return null;
var allowed=!c.required;
gtag("consent","default",signals(stored||{analytics:allowed,advertising:allowed}));
gtag("set","ads_data_redaction",true);
w.dataLayer.push({"gtm.start":Date.now(),event:"gtm.js"});
var t=d.createElement("script");t.async=true;t.src="https://www.googletagmanager.com/gtm.js?id="+encodeURIComponent(c.gtmId);d.head.appendChild(t);
return{gtmId:c.gtmId,required:!!c.required,stored:stored};
}).catch(function(){return null});
})()`;
