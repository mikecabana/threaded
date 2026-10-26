import { FORMAT_LABELS } from "@/lib/analysis/formats";
import type { FormatTopicMatrix } from "@/lib/analysis/insights";
import { formatMetric } from "@/lib/format";
import { cn } from "@/lib/utils";

const NOTABLE = 1.3;

/** Shading only marks cells that beat the author's median, deeper the further ahead. */
function shade(multiplier: number | null): string | undefined {
  if (multiplier === null || multiplier < NOTABLE) return undefined;
  const strength = multiplier >= 2 ? 55 : 28;
  return `color-mix(in oklch, var(--accent) ${strength}%, transparent)`;
}

/**
 * Formats down the side, the author's main topics across, each cell showing
 * the goal's lead metric against their median. Cells from a single post are
 * faded: one post isn't a pattern.
 */
export function FormatTopicMatrixTable({ matrix, metricLabel }: { matrix: FormatTopicMatrix; metricLabel: string }) {
  const cell = (format: string, topic: string) => matrix.cells.find((c) => c.format === format && c.topic === topic);
  return (
    <div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-separate border-spacing-[3px] text-xs">
          <caption className="sr-only">
            {metricLabel} for each format and topic, against your median. 1× is your median.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                Format
              </th>
              {matrix.topics.map((topic) => (
                <th key={topic} scope="col" className="max-w-24 truncate px-1 pb-1 text-left font-medium text-muted">
                  {topic}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.formats.map((format) => (
              <tr key={format}>
                <th scope="row" className="whitespace-nowrap pr-2 text-left font-medium text-muted">
                  {FORMAT_LABELS[format]}
                </th>
                {matrix.topics.map((topic) => {
                  const c = cell(format, topic);
                  return (
                    <td
                      key={topic}
                      className={cn(
                        "h-11 min-w-16 rounded-lg px-2 align-middle",
                        c ? "bg-surface-2" : "bg-transparent",
                        c && c.posts < 2 && "opacity-55",
                      )}
                      style={c ? { background: shade(c.multiplier) } : undefined}
                    >
                      {c ? (
                        <>
                          <span className="block font-mono font-semibold text-fg tabular-nums">
                            {c.multiplier === null ? "–" : formatMetric(c.multiplier, "multiplier")}
                          </span>
                          <span className="block text-[10px] text-subtle">
                            {c.posts} {c.posts === 1 ? "post" : "posts"}
                          </span>
                        </>
                      ) : (
                        <span className="sr-only">No posts</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-subtle text-xs">
        <span className="size-2.5 rounded-[3px]" style={{ background: shade(NOTABLE) }} aria-hidden />
        Beats your median {metricLabel} by {formatMetric(NOTABLE, "multiplier")} or more. Faded: a single post.
      </p>
    </div>
  );
}
