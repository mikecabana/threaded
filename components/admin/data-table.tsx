import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface Column<T> {
  label: string;
  cell: (row: T) => ReactNode;
  /** Numbers are right-aligned and tabular. */
  numeric?: boolean;
  className?: string;
}

/** A plain, readable table in a card, scrolling sideways on small screens. */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: string;
}) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="px-4 pt-4 pb-2 text-left font-medium">{caption}</caption>
        <thead>
          <tr className="border-border border-b text-muted">
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-4 py-2 font-medium",
                  column.numeric ? "text-right" : "text-left",
                  column.className,
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-border border-b last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.label}
                    className={cn(
                      "px-4 py-2.5 align-top",
                      column.numeric && "whitespace-nowrap text-right font-mono tabular-nums",
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}

/** One headline number. */
export function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="p-4">
      <p className="text-muted text-sm">{label}</p>
      <p className="mt-1 font-mono font-semibold text-2xl tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-subtle text-xs">{detail}</p>}
    </Card>
  );
}
