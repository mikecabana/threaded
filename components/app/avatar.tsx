import { cn } from "@/lib/utils";

function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\s&]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .filter((w) => w !== "&")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** Initials on a soft gradient. Real profile pictures arrive with Threads sync. */
export function Avatar({ name, hue, className }: { name: string; hue: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 select-none items-center justify-center rounded-full font-semibold text-white text-xs ring-1 ring-white/10",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, oklch(0.68 0.16 ${hue}), oklch(0.45 0.14 ${(hue + 50) % 360}))`,
      }}
    >
      {initials(name)}
    </span>
  );
}
