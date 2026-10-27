import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  CONSENT_KEY,
  type ConsentConfig,
  consentBootScript,
  consentRequired,
  consentSignals,
  geoFrom,
  readChoice,
  saveChoice,
} from "./consent";

const headers = (values: Record<string, string>) => new Headers(values);

describe("where cookies wait for a yes", () => {
  it("reads Cloudflare's location first, since Vercel only sees Cloudflare behind it", () => {
    expect(geoFrom(headers({ "cf-ipcountry": "ca", "cf-region-code": "qc", "x-vercel-ip-country": "US" }))).toEqual({
      country: "CA",
      region: "QC",
    });
    expect(geoFrom(headers({ "x-vercel-ip-country": "FR", "x-vercel-ip-country-region": "IDF" }))).toEqual({
      country: "FR",
      region: "IDF",
    });
    expect(geoFrom(headers({}))).toEqual({ country: null, region: null });
  });

  it("asks in Quebec, the EU and EEA, the UK and Switzerland", () => {
    for (const [country, region] of [
      ["CA", "QC"],
      ["FR", null],
      ["DE", "BE"],
      ["NO", null],
      ["GB", "ENG"],
      ["CH", null],
    ] as const) {
      expect(consentRequired({ country, region })).toBe(true);
    }
  });

  it("doesn't ask elsewhere in Canada or in the US", () => {
    expect(consentRequired({ country: "CA", region: "ON" })).toBe(false);
    expect(consentRequired({ country: "US", region: "CA" })).toBe(false);
  });

  it("asks when it can't tell: no location, an unknown one, Tor, or Canada without a province", () => {
    expect(consentRequired({ country: null, region: null })).toBe(true);
    expect(consentRequired({ country: "XX", region: null })).toBe(true);
    expect(consentRequired({ country: "T1", region: null })).toBe(true);
    expect(consentRequired({ country: "CA", region: null })).toBe(true);
  });
});

describe("the choice", () => {
  it("maps to Google's Consent Mode signals", () => {
    expect(consentSignals({ analytics: true, advertising: false })).toEqual({
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  });

  it("is kept in the browser, and a missing, broken or blocked store means no choice yet", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
    expect(readChoice(storage)).toBeNull();
    saveChoice(storage, { analytics: true, advertising: false, at: "2026-10-27T03:00:00.000Z" });
    expect(readChoice(storage)).toEqual({ analytics: true, advertising: false, at: "2026-10-27T03:00:00.000Z" });

    store.set(CONSENT_KEY, "{not json");
    expect(readChoice(storage)).toBeNull();
    store.set(CONSENT_KEY, JSON.stringify({ analytics: "yes" }));
    expect(readChoice(storage)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readChoice(blocked)).toBeNull();
    expect(() => saveChoice(blocked, { analytics: false, advertising: false, at: "" })).not.toThrow();
    expect(readChoice(undefined)).toBeNull();
  });
});

describe("the boot script on every page", () => {
  /** Runs the inline script against a stand-in browser and returns what it did. */
  async function boot(options: { api: unknown; stored?: string; storageThrows?: boolean; apiFails?: boolean }) {
    const dataLayer: unknown[] = [];
    const scripts: { src: string; async: boolean }[] = [];
    const window: Record<string, unknown> = { dataLayer };
    const fetchCalls: string[] = [];
    runInNewContext(consentBootScript, {
      window,
      document: {
        createElement: () => ({ src: "", async: false }),
        head: { appendChild: (script: { src: string; async: boolean }) => scripts.push(script) },
      },
      localStorage: {
        getItem: (key: string) => {
          if (options.storageThrows) throw new Error("SecurityError");
          return key === CONSENT_KEY ? (options.stored ?? null) : null;
        },
      },
      fetch: (url: string) => {
        fetchCalls.push(url);
        return options.apiFails
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ ok: true, json: () => Promise.resolve(options.api) });
      },
      Date,
      JSON,
      String,
      Promise,
      encodeURIComponent,
    });
    const config = (await window.threadedConsent) as ConsentConfig | null;
    const commands = dataLayer.map((entry) =>
      typeof entry === "object" && entry && "length" in entry ? Array.from(entry as ArrayLike<unknown>) : entry,
    );
    return { config, commands, scripts, fetchCalls };
  }

  it("loads Tag Manager straight away, with consent denied where the law asks first", async () => {
    const { config, commands, scripts, fetchCalls } = await boot({ api: { gtmId: "GTM-TEST1", required: true } });
    expect(fetchCalls).toEqual(["/api/consent"]);
    expect(commands[0]).toEqual(["consent", "default", consentSignals({ analytics: false, advertising: false })]);
    expect(commands[1]).toEqual(["set", "ads_data_redaction", true]);
    expect(commands[2]).toMatchObject({ event: "gtm.js" });
    expect(scripts).toEqual([{ src: "https://www.googletagmanager.com/gtm.js?id=GTM-TEST1", async: true }]);
    expect(config).toEqual({ gtmId: "GTM-TEST1", required: true, stored: null });
  });

  it("grants consent by default elsewhere", async () => {
    const { commands } = await boot({ api: { gtmId: "GTM-TEST1", required: false } });
    expect(commands[0]).toEqual(["consent", "default", consentSignals({ analytics: true, advertising: true })]);
  });

  it("uses a saved choice as the default on later visits, wherever the visitor is", async () => {
    const saved = { analytics: true, advertising: false, at: "2026-10-27T03:00:00.000Z" };
    for (const required of [true, false]) {
      const { config, commands } = await boot({ api: { gtmId: "GTM-TEST1", required }, stored: JSON.stringify(saved) });
      expect(commands[0]).toEqual(["consent", "default", consentSignals(saved)]);
      // Reads storage exactly as the banner does.
      expect(config?.stored).toEqual(readChoice({ getItem: () => JSON.stringify(saved) }));
    }
  });

  it("falls back to the region when the saved choice is broken or storage is blocked", async () => {
    const denied = ["consent", "default", consentSignals({ analytics: false, advertising: false })];
    expect((await boot({ api: { gtmId: "G-1", required: true }, stored: "{not json" })).commands[0]).toEqual(denied);
    expect((await boot({ api: { gtmId: "G-1", required: true }, storageThrows: true })).commands[0]).toEqual(denied);
  });

  it("does nothing without a container, or when the region can't be fetched", async () => {
    for (const run of [
      await boot({ api: { gtmId: null, required: true } }),
      await boot({ api: null, apiFails: true }),
    ]) {
      expect(run.config).toBeNull();
      expect(run.commands).toEqual([]);
      expect(run.scripts).toEqual([]);
    }
  });
});
