import { rankHours } from "@/lib/analysis/summary";
import type { AccountViewer } from "@/lib/session/viewer";
import type { ComposerConfig } from "./provider";

/** What the composer needs from the signed-in account; null when it can't post. */
export function composerConfig(viewer: AccountViewer): ComposerConfig | null {
  if (!viewer.connected) return null;
  const { name, username, isVerified, avatarHue } = viewer.profile;
  return {
    author: { name, username, isVerified, avatarHue },
    timeZone: viewer.timezone,
    bestHours: rankHours(viewer.goal, viewer.data.posts, viewer.timezone, viewer.now).map((h) => h.hour),
  };
}
