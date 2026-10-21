import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActivityList } from "@/components/billing/activity-list";
import { AutoRechargeForm } from "@/components/billing/auto-recharge-form";
import { BalanceCard } from "@/components/billing/balance-card";
import { CheckoutBanner } from "@/components/billing/checkout-banner";
import { CreditPacks } from "@/components/billing/credit-packs";
import { ManagePlanButton, OwnKeyCard } from "@/components/billing/own-key-card";
import { Reveal } from "@/components/motion/reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { catalogFor, DEFAULT_CATALOG, pickModel } from "@/lib/ai/catalog";
import { TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS, typicalCredits } from "@/lib/ai/cost";
import { DEFAULT_AUTO_RECHARGE } from "@/lib/billing/auto-recharge";
import { isStripeConfigured, savedCard } from "@/lib/billing/stripe";
import { billingActivity, billingOverview } from "@/lib/data/billing";
import { CREDIT_EXPIRY_MONTHS } from "@/lib/pricing";
import { type AccountViewer, requireViewer, type Viewer } from "@/lib/session/viewer";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage(props: PageProps<"/settings/billing">) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <Reveal>
        <Link href="/settings" className="inline-flex items-center gap-1 text-muted text-sm hover:text-fg">
          <ChevronLeft className="size-4" aria-hidden /> Settings
        </Link>
        <h1 className="mt-2 font-semibold text-2xl tracking-tight sm:text-3xl">Billing</h1>
        <p className="mt-1 text-muted">Pay as you go with credits, or bring your own AI Gateway key.</p>
      </Reveal>
      <Suspense fallback={<BillingSkeleton />}>
        <BillingContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

/** Credits for a typical batch of three ideas on the default model, for "about N batches". */
async function batchCredits(viewer: Viewer) {
  const entries =
    viewer.kind === "account"
      ? await catalogFor("generate")
      : DEFAULT_CATALOG.filter((m) => m.enabled && m.tasks.includes("generate"));
  return typicalCredits(pickModel(entries, "generate", null), TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS[3]);
}

const dateFormatter = (timeZone: string) => (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });

async function BillingContent({ searchParams }: { searchParams: PageProps<"/settings/billing">["searchParams"] }) {
  const [viewer, params] = await Promise.all([requireViewer(), searchParams]);
  const perBatch = await batchCredits(viewer);
  const formatDate = dateFormatter(viewer.timezone);

  if (viewer.kind === "demo") {
    return (
      <>
        <BalanceCard
          credits={viewer.credits}
          mode="credits"
          batchCredits={perBatch}
          expiring={null}
          autoRecharge={null}
          formatDate={formatDate}
        />
        <CreditPacks
          batchCredits={perBatch}
          unavailable="This is a demo account. Connect your Threads account to buy credits; new accounts start with 100 free."
        />
      </>
    );
  }
  return <AccountBilling viewer={viewer} params={params} perBatch={perBatch} formatDate={formatDate} />;
}

async function AccountBilling({
  viewer,
  params,
  perBatch,
  formatDate,
}: {
  viewer: AccountViewer;
  params: Record<string, string | string[] | undefined>;
  perBatch: number;
  formatDate: (date: Date) => string;
}) {
  const stripeReady = isStripeConfigured();
  const unavailable = stripeReady ? undefined : "Payments aren't set up on this deployment yet.";
  const [overview, activity] = await Promise.all([
    billingOverview(viewer.workspaceId, viewer.now),
    billingActivity(viewer.workspaceId),
  ]);
  const card = stripeReady
    ? await savedCard(overview.customerId).catch((error) => {
        console.error("Couldn't load the saved card", error);
        return null;
      })
    : null;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  return (
    <>
      <CheckoutBanner checkout={one(params.checkout)} status={one(params.status)} />
      <BalanceCard
        credits={overview.balance}
        mode={overview.mode}
        batchCredits={perBatch}
        expiring={overview.expiring}
        autoRecharge={overview.autoRecharge}
        formatDate={formatDate}
      />
      <CreditPacks
        batchCredits={perBatch}
        unavailable={unavailable}
        note={overview.mode === "byok" ? "You're on your own key, so Studio doesn't use credits right now." : undefined}
      />
      <AutoRechargeForm
        settings={overview.autoRecharge ?? DEFAULT_AUTO_RECHARGE}
        card={card ? `${card.brand[0].toUpperCase()}${card.brand.slice(1)} •••• ${card.last4}` : null}
        unavailable={unavailable}
      />
      <OwnKeyCard
        workspaceId={viewer.workspaceId}
        overview={overview}
        formatDate={formatDate}
        unavailable={unavailable}
      />
      <ActivityList items={activity} formatDate={formatDate} />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-subtle">
        <p>
          Credits expire {CREDIT_EXPIRY_MONTHS} months after purchase and aren't refundable except where the law
          requires.{" "}
          <Link href="/legal/terms" className="underline underline-offset-2">
            Terms
          </Link>
        </p>
        {overview.customerId && stripeReady && <ManagePlanButton label="Invoices and cards" />}
      </div>
    </>
  );
}

function BillingSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-40 rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
      </div>
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  );
}
