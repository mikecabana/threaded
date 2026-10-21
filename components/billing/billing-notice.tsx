import { TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { dismissBillingNoticeAction } from "@/lib/actions/billing";
import type { BillingNotice } from "@/lib/db/schema";

/** A billing problem (a declined auto-recharge, a lapsed plan), shown across the app until dismissed or fixed. */
export function BillingNoticeBanner({ notice }: { notice: BillingNotice }) {
  return (
    <div className="flex items-center gap-2 border-negative/30 border-b bg-negative/10 px-4 py-2 text-fg text-xs md:px-8">
      <TriangleAlert className="size-3.5 shrink-0 text-negative" aria-hidden />
      <span className="min-w-0 flex-1">{notice.message}</span>
      <Link href="/settings/billing" className="shrink-0 font-medium underline underline-offset-2">
        Billing
      </Link>
      <form action={dismissBillingNoticeAction}>
        <button type="submit" aria-label="Dismiss" className="rounded p-0.5 text-muted hover:text-fg">
          <X className="size-3.5" aria-hidden />
        </button>
      </form>
    </div>
  );
}
