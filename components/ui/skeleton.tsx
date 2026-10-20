import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative overflow-hidden rounded-xl bg-surface-2 motion-safe:after:absolute motion-safe:after:inset-0 motion-safe:after:-translate-x-full motion-safe:after:animate-[shimmer_1.6s_infinite] motion-safe:after:bg-gradient-to-r motion-safe:after:from-transparent motion-safe:after:via-fg/5 motion-safe:after:to-transparent",
        className,
      )}
      {...props}
    />
  );
}
