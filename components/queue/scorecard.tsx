import { ArrowDownRight, ArrowUpRight, ExternalLink } from "lucide-react";
import { type PostAuthor, PostPreview } from "@/components/threads/post-preview";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { beatsUsual, belowUsual, type Chip, type ScorecardEntry } from "@/lib/analysis/scorecard";
import { formatMetric, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const MINUTE_MS = 60_000;

/** "in 45m", "in 23h", "in 2d". */
function inTime(dueAt: string, now: Date): string {
  const minutes = Math.max(1, Math.round((Date.parse(dueAt) - now.getTime()) / MINUTE_MS));
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `in ${hours}h` : `in ${Math.round(hours / 24)}d`;
}

const views = (n: number) => `${formatMetric(n, "number")} ${n === 1 ? "view" : "views"}`;

/** What a chip shows, and the full sentence behind it. */
type Tone = "up" | "even" | "down" | "plain" | "waiting";

function describe(chip: Chip, now: Date): { value: string; detail: string; tone: Tone } {
  const at = chip.checkpoint.label;
  switch (chip.state) {
    case "pending": {
      const due = Date.parse(chip.dueAt) > now.getTime();
      return {
        value: due ? inTime(chip.dueAt, now) : "soon",
        detail: due ? `Measured at ${at}, ${inTime(chip.dueAt, now)}.` : `Being measured at ${at}.`,
        tone: "waiting",
      };
    }
    case "missed":
      return { value: "–", detail: `Not measured at ${at}.`, tone: "plain" };
    case "measured": {
      if (chip.multiplier === null || !chip.baseline) {
        return {
          value: formatMetric(chip.views, "compact"),
          detail: `${views(chip.views)} at ${at}. Your usual at ${at} needs a few more posts measured.`,
          tone: "plain",
        };
      }
      const usual =
        chip.baseline.basis === "age"
          ? `your usual ${formatMetric(Math.round(chip.baseline.views), "number")} at ${at}`
          : `the ${formatMetric(Math.round(chip.baseline.views), "number")} your posts usually end up with`;
      return {
        value: formatMetric(chip.multiplier, "multiplier"),
        detail: `${views(chip.views)} at ${at}: ${formatMetric(chip.multiplier, "multiplier")} ${usual}.`,
        tone: beatsUsual(chip.multiplier) ? "up" : belowUsual(chip.multiplier) ? "down" : "even",
      };
    }
  }
}

function ScoreChip({ chip, now }: { chip: Chip; now: Date }) {
  const { value, detail, tone } = describe(chip, now);
  return (
    <li
      title={detail}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        tone === "up" && "border-accent/40 bg-accent/10",
        (tone === "down" || tone === "even") && "border-border bg-surface-2",
        tone === "plain" && "border-border text-subtle",
        tone === "waiting" && "border-border-strong border-dashed text-subtle",
      )}
    >
      <span aria-hidden className="text-subtle">
        {chip.checkpoint.short}
      </span>
      <span aria-hidden className="font-medium font-mono tabular-nums">
        {value}
      </span>
      {tone === "up" && <ArrowUpRight aria-hidden className="size-3.5 text-accent" />}
      {tone === "down" && <ArrowDownRight aria-hidden className="size-3.5 text-subtle" />}
      <span className="sr-only">{detail}</span>
    </li>
  );
}

/** The latest scored checkpoint, spelled out under the chips. */
function latestDetail(chips: Chip[], now: Date): string | null {
  const measured = [...chips].reverse().find((c) => c.state === "measured");
  return measured ? describe(measured, now).detail : null;
}

function ScoreItem({ author, entry, now }: { author: PostAuthor; entry: ScorecardEntry; now: Date }) {
  const detail = latestDetail(entry.chips, now);
  return (
    <Card className="p-4">
      <PostPreview
        author={author}
        text={entry.text}
        clamp={2}
        meta={
          <span className="flex items-center gap-2 text-xs">
            {timeAgo(entry.postedAt, now)}
            {entry.source === "matched" && <Badge variant="outline">From a Studio idea</Badge>}
          </span>
        }
      />
      <div className="mt-3 border-border border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <ol className="flex flex-wrap gap-1.5" aria-label="Views against your usual">
            {entry.chips.map((chip) => (
              <ScoreChip key={chip.checkpoint.id} chip={chip} now={now} />
            ))}
          </ol>
          {entry.permalink && (
            <a
              href={entry.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-accent text-sm hover:underline"
            >
              View on Threads <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
        {detail && (
          <p aria-hidden className="mt-2 text-muted text-xs">
            {detail}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * The suggestion scorecard: posts from Threaded (or from a Studio idea posted
 * elsewhere), each with its views against the author's usual at 1 hour,
 * 1 day and 3 days.
 */
export function Scorecard({
  author,
  entries,
  line,
  now,
  sample = false,
}: {
  author: PostAuthor;
  entries: ScorecardEntry[];
  line: string;
  now: Date;
  sample?: boolean;
}) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="scorecard-heading" className="mt-10">
      <h2 id="scorecard-heading" className="flex items-center gap-2 font-semibold text-lg">
        Scorecard {sample && <Badge>Sample</Badge>}
      </h2>
      <p className="mt-1 mb-3 text-muted text-sm">{line}</p>
      <div className="grid gap-3">
        {entries.map((entry) => (
          <ScoreItem key={entry.postId} author={author} entry={entry} now={now} />
        ))}
      </div>
    </section>
  );
}
