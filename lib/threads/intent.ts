/**
 * Opens Threads' composer with the text prefilled: the no-API fallback for
 * posting (⚠ confirm the intent URL is still supported before relying on it).
 */
export function threadsIntentUrl(text: string): string {
  return `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`;
}
