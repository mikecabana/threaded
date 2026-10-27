import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The brand fonts as TTF for share images (ImageResponse can't read the
// woff2 that next/font serves). Licensed under the SIL OFL; see assets/fonts.
// They're read when the module loads, so prerendering an image never waits
// on a file read (which Cache Components would count as request-time work).

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

const [regular, semibold, serifItalic] = await Promise.all([
  font("Geist-Regular.ttf"),
  font("Geist-SemiBold.ttf"),
  font("InstrumentSerif-Italic.ttf"),
]);

export const OG_FONTS = [
  { name: "Geist", data: regular, weight: 400 as const, style: "normal" as const },
  { name: "Geist", data: semibold, weight: 600 as const, style: "normal" as const },
  { name: "Instrument Serif", data: serifItalic, weight: 400 as const, style: "italic" as const },
];
