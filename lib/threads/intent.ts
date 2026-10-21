/** Opens Threads' composer with the text prefilled: the no-API fallback for posting (Meta's web intents). */
export function threadsIntentUrl(text: string): string {
  return `https://www.threads.com/intent/post?text=${encodeURIComponent(text)}`;
}
