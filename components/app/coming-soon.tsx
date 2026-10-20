import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { ThreadLine } from "@/components/motion/thread-line";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/** Empty state for sections that aren't built yet: what's coming, drawn on the thread line. */
export function ComingSoon({
  icon,
  title,
  description,
  features,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  features: string[];
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl py-8 sm:py-12">
      <Reveal className="flex flex-col items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent/15 text-accent [&_svg]:size-7">
          {icon}
        </span>
        <Badge variant="outline" className="mt-6">
          Coming soon
        </Badge>
        <h1 className="mt-3 font-semibold text-3xl tracking-tight">{title}</h1>
        <p className="mt-3 max-w-lg text-muted leading-relaxed">{description}</p>
      </Reveal>

      <Card className="mt-10 p-6 sm:p-8">
        <Stagger className="flex flex-col" delay={0.2}>
          {features.map((feature, i) => (
            <StaggerItem key={feature} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-accent">
                  <Check className="size-3.5" aria-hidden />
                </span>
                {i < features.length - 1 && <ThreadLine className="min-h-6 flex-1" delay={0.3 + i * 0.1} />}
              </div>
              <p className="pb-5 text-fg/90">{feature}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </Card>
      {children}
    </div>
  );
}
