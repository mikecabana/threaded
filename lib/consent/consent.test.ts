import { describe, expect, it } from "vitest";
import { CONSENT_KEY, consentRequired, consentSignals, geoFrom, readChoice, saveChoice } from "./consent";

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
