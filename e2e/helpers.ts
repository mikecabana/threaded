import type { Locator } from "@playwright/test";

/**
 * Only the visible matches. While a Suspense boundary streams in, React
 * briefly keeps a hidden copy of its content (`<div hidden id="S:…">`) next to
 * the revealed one. Role queries skip hidden elements on their own; text and
 * label queries don't, so page-wide ones go through this.
 */
export const shown = (locator: Locator) => locator.filter({ visible: true });
