import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { buyCreditsAction } from "@/lib/actions/billing";
import { CREDIT_PACKS, packBonus } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { SubmitButton } from "./submit-button";

export function CreditPacks({
  batchCredits,
  unavailable,
  note,
}: {
  batchCredits: number;
  /** Why buying is off (demo, payments not set up), if it is. */
  unavailable?: string;
  note?: string;
}) {
  return (
    <section aria-labelledby="buy-credits">
      <h2 id="buy-credits" className="font-semibold text-lg">
        Buy credits
      </h2>
      <p className="mt-0.5 text-muted text-sm">
        A one-time payment, no subscription. Credits never expire, and bigger packs come with bonus credits.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {CREDIT_PACKS.map((pack, i) => (
          <form key={pack.id} action={buyCreditsAction}>
            <input type="hidden" name="packId" value={pack.id} />
            {/* A compact row on phones, a column of three from sm up. */}
            <Card
              className={cn(
                "flex h-full items-center gap-4 p-4 sm:flex-col sm:items-stretch sm:gap-0 sm:p-5",
                i === 1 && "border-accent/40",
              )}
            >
              <p className="w-16 shrink-0 font-semibold text-2xl tracking-tight sm:w-auto sm:text-3xl">${pack.usd}</p>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium sm:mt-1">
                  {pack.credits.toLocaleString("en-US")} credits
                  {packBonus(pack) > 0 && (
                    <Badge variant="accent">+{packBonus(pack).toLocaleString("en-US")} bonus</Badge>
                  )}
                </p>
                <p className="mt-0.5 text-subtle text-xs sm:mt-1">
                  About {Math.floor(pack.credits / Math.max(1, batchCredits)).toLocaleString("en-US")} batches of three
                  ideas
                </p>
              </div>
              <SubmitButton
                className="ml-auto sm:mt-4 sm:ml-0 sm:w-full"
                variant={i === 1 ? "primary" : "outline"}
                disabled={Boolean(unavailable)}
                aria-label={`Buy ${pack.credits.toLocaleString("en-US")} credits for $${pack.usd}`}
              >
                Buy
              </SubmitButton>
            </Card>
          </form>
        ))}
      </div>
      {(unavailable || note) && <p className="mt-3 text-sm text-subtle">{unavailable ?? note}</p>}
    </section>
  );
}
