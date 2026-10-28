import { z } from "zod";
import { SPICE_LEVELS, type SpiceLevel } from "./schemas";

// The author's voice settings (Settings → Voice): emoji, casing, words to
// never use, and Studio's default tone. Unset emoji and casing mean "like my
// posts": the voice learned from their posts decides. The writer is told the
// rules (./prompt.ts), and ideas that still break the hard ones are dropped
// (./postprocess.ts).

export const EMOJI_LEVELS = ["none", "some", "lots"] as const;
export const CASINGS = ["normal", "lowercase"] as const;
export const MAX_BANNED = 30;
export const MAX_BANNED_LENGTH = 40;

export interface VoicePrefs {
  emoji?: (typeof EMOJI_LEVELS)[number];
  casing?: (typeof CASINGS)[number];
  bannedWords?: string[];
  spice?: SpiceLevel;
}

const choice = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), z.enum(values).optional());

/** Splits the banned-words box: commas or new lines, trimmed, without repeats. */
export function parseBannedWords(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[,\n]/)
    .map((word) => word.trim().replace(/\s+/g, " "))
    .filter((word) => {
      const key = word.toLowerCase();
      if (!word || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export const voiceFormSchema = z.object({
  emoji: choice(EMOJI_LEVELS),
  casing: choice(CASINGS),
  spice: choice(SPICE_LEVELS),
  bannedWords: z
    .string()
    .default("")
    .transform(parseBannedWords)
    .pipe(
      z
        .array(z.string().max(MAX_BANNED_LENGTH, `Keep each word or phrase under ${MAX_BANNED_LENGTH} characters.`))
        .max(MAX_BANNED, `Up to ${MAX_BANNED} words or phrases.`),
    ),
});

/** What the writer is told, beyond the voice learned from the author's posts. */
export function voiceRules(prefs: VoicePrefs | null | undefined): string[] {
  if (!prefs) return [];
  const rules: string[] = [];
  if (prefs.emoji === "none") rules.push("No emoji at all.");
  if (prefs.emoji === "some") rules.push("At most one emoji per post, and only where it adds something.");
  if (prefs.emoji === "lots") rules.push("Use emoji generously: a few per post.");
  if (prefs.casing === "lowercase") rules.push("Write everything in lowercase, including the start of sentences.");
  if (prefs.casing === "normal") rules.push("Use normal sentence case.");
  if (prefs.bannedWords?.length) {
    rules.push(`Never use these words or phrases: ${prefs.bannedWords.map((w) => `"${w}"`).join(", ")}.`);
  }
  return rules;
}

/** Emoji shown as pictures (not text symbols like © or ™). */
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;

export const hasEmoji = (text: string) => EMOJI.test(text);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first banned word or phrase in the text, as a whole word and ignoring case, or null. */
export function bannedWordIn(text: string, banned: readonly string[]): string | null {
  for (const word of banned) {
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "iu").test(text)) return word;
  }
  return null;
}
