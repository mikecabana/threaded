import { cn } from "@/lib/utils";

/** The mark: an avatar, the thread line, and the next post in the goal accent. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6", className)}>
      <circle cx="12" cy="5.5" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 9v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="18.5" r="3.5" fill="var(--accent)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold text-fg tracking-tight", className)}>
      <LogoMark />
      <span className="text-lg">Threaded</span>
    </span>
  );
}
