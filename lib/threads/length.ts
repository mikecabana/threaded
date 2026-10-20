// Threads caps posts at 500 characters, but counts emoji by their UTF-8 byte
// length (per Meta's publishing docs; ⚠ re-verify against the live docs).
// Everything else counts as one character per grapheme.

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
