import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "bg-surface-2 text-muted",
        accent: "bg-accent/15 text-accent",
        positive: "bg-positive/15 text-positive",
        negative: "bg-negative/15 text-negative",
        outline: "border border-border-strong text-muted",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
