// Threads caps posts at 500 characters, but counts emoji by their UTF-8 byte
// length ("Emojis are counted as the number of UTF-8 bytes", Meta's publishing
// docs). Everything else counts as one character per grapheme.

export const THREADS_MAX_LENGTH = 500;

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const encoder = new TextEncoder();
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function threadsLength(text: string): number {
  let length = 0;
  for (const { segment } of segmenter.segment(text)) {
    length += EMOJI.test(segment) ? encoder.encode(segment).length : 1;
  }
  return length;
}

export function fitsThreads(text: string): boolean {
  return threadsLength(text) <= THREADS_MAX_LENGTH;
}

/** Since Dec 22, 2025, Threads rejects posts with more than five links (Meta's docs). */
export const THREADS_MAX_LINKS = 5;

/** Distinct links in a post, counted the way that limit counts them (unique URLs). */
export function threadsLinkCount(text: string): number {
  const links = text.match(/\b(?:https?:\/\/|www\.)[^\s]+/gi) ?? [];
  return new Set(links.map((link) => link.toLowerCase().replace(/[.,!?)]+$/, ""))).size;
}
