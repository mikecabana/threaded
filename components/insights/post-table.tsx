"use client";

import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PostRow } from "@/lib/analysis/insights";
import { formatMetric, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "timestamp" | "views" | "engagementRate" | "replies" | "reposts" | "outperformance";

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "views", label: "Views" },
  { key: "engagementRate", label: "Eng. rate", className: "hidden sm:table-cell" },
  { key: "replies", label: "Replies", className: "hidden md:table-cell" },
  { key: "reposts", label: "Reposts", className: "hidden md:table-cell" },
  { key: "outperformance", label: "vs usual" },
];

const PAGE = 20;

/** Every post, newest first by default, sortable by any number. */
export function PostTable({ rows, now }: { rows: PostRow[]; now: string }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "timestamp", desc: true });
  const [limit, setLimit] = useState(PAGE);

  const sorted = [...rows].sort((a, b) => {
    const order = a[sort.key] < b[sort.key] ? -1 : a[sort.key] > b[sort.key] ? 1 : 0;
    return sort.desc ? -order : order;
  });
  const shown = sorted.slice(0, limit);

  function sortBy(key: SortKey) {
    setSort((current) => (current.key === key ? { key, desc: !current.desc } : { key, desc: true }));
  }

  function header(key: SortKey, label: string, className?: string, align = "text-right") {
    const activeSort = sort.key === key;
    return (
      <th
        key={key}
        scope="col"
        aria-sort={activeSort ? (sort.desc ? "descending" : "ascending") : "none"}
        className={cn("whitespace-nowrap px-2 py-2 font-medium", align, className)}
      >
        <button
          type="button"
          onClick={() => sortBy(key)}
          className={cn(
            "inline-flex items-center gap-1 rounded hover:text-fg focus-visible:outline-2 focus-visible:outline-accent",
            activeSort ? "text-fg" : "text-muted",
          )}
        >
          {label}
          {activeSort && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </button>
      </th>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Your posts. Column headers sort the table.</caption>
        <thead className="border-border border-b text-xs">
          <tr>
            {header("timestamp", "Post", undefined, "text-left")}
            {COLUMNS.map((c) => header(c.key, c.label, c.className))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.id} className="border-border border-b align-top last:border-0">
              <td className="w-full max-w-0 py-3 pr-2">
                <p className="line-clamp-2 text-fg leading-snug">{row.text || "(no text)"}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-subtle text-xs">
                  <span>{timeAgo(row.timestamp, new Date(now))}</span>
                  {row.formatLabel && <Badge variant="outline">{row.formatLabel}</Badge>}
                  {row.topic && <Badge variant="neutral">{row.topic}</Badge>}
                  {row.viaThreaded && <Badge variant="accent">Threaded</Badge>}
                  {row.permalink && (
                    <a
                      href={row.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 hover:text-fg"
                      aria-label="Open on Threads"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </td>
              <td className="px-2 py-3 text-right font-mono tabular-nums">{formatMetric(row.views, "compact")}</td>
              <td className="hidden px-2 py-3 text-right font-mono tabular-nums sm:table-cell">
                {formatMetric(row.engagementRate, "percent")}
              </td>
              <td className="hidden px-2 py-3 text-right font-mono tabular-nums md:table-cell">{row.replies}</td>
              <td className="hidden px-2 py-3 text-right font-mono tabular-nums md:table-cell">{row.reposts}</td>
              <td className="py-3 pl-2 text-right">
                {row.settled ? (
                  <Badge
                    variant={row.outperformance >= 1.5 ? "accent" : row.outperformance < 0.67 ? "outline" : "neutral"}
                    className="font-mono tabular-nums"
                  >
                    {formatMetric(row.outperformance, "multiplier")}
                  </Badge>
                ) : (
                  <span className="text-subtle text-xs">settling</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > limit && (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE * 2)}>
            Show more ({sorted.length - limit} left)
          </Button>
        </div>
      )}
    </div>
  );
}
