import type { ReactNode } from "react";

/** Shared layout for legal documents. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
      <p className="mb-6 rounded-xl border border-border-strong border-dashed bg-surface px-4 py-3 text-muted text-sm">
        Draft for review. This document hasn't been reviewed by a lawyer yet and isn't in effect.
      </p>
      <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-subtle">Last updated {updated}</p>
      <div className="mt-10 space-y-8 text-muted leading-relaxed [&_h2]:mb-3 [&_h2]:font-semibold [&_h2]:text-fg [&_h2]:text-lg [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </article>
  );
}
