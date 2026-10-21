import { LogOut } from "lucide-react";
import { exitDemoAction, startDemoAction } from "@/lib/actions/demo";
import { DEMO_PERSONA_IDS, DEMO_PERSONAS, type DemoPersonaId } from "@/lib/demo/personas";
import { cn } from "@/lib/utils";

/** Thin bar that makes demo mode obvious and lets visitors switch accounts. */
export function DemoBanner({ current }: { current: DemoPersonaId }) {
  return (
    <div className="flex items-center gap-3 border-border border-b bg-surface/60 px-4 py-2 text-xs md:px-8">
      <span className="flex shrink-0 items-center gap-2 whitespace-nowrap font-medium text-fg">
        <span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden />
        <span>
          Demo<span className="sr-only sm:not-sr-only"> account</span>
        </span>
      </span>
      <form action={startDemoAction} className="flex min-w-0 items-center gap-1 overflow-x-auto">
        <span className="sr-only">Switch demo account</span>
        {DEMO_PERSONA_IDS.map((id) => (
          <button
            key={id}
            type="submit"
            name="persona"
            value={id}
            aria-pressed={id === current}
            className={cn(
              "whitespace-nowrap rounded-full px-2.5 py-1 transition-colors",
              id === current ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
            )}
          >
            {DEMO_PERSONAS[id].label}
          </button>
        ))}
      </form>
      <form action={exitDemoAction} className="ml-auto">
        <button type="submit" className="flex items-center gap-1.5 text-muted hover:text-fg">
          <LogOut className="size-3.5" aria-hidden />
          <span className="sr-only sm:not-sr-only">Exit demo</span>
        </button>
      </form>
    </div>
  );
}
