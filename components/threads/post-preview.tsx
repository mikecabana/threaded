import { BadgeCheck, Eye, Heart, MessageCircle, Repeat2 } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/app/avatar";
import { formatMetric } from "@/lib/format";
import type { PostInsights } from "@/lib/threads/types";
import { cn } from "@/lib/utils";

export interface PostAuthor {
  name: string;
  username: string;
  isVerified: boolean;
  avatarHue: number;
}

/** A post laid out the way Threads shows it, so suggestions read in context. */
export function PostPreview({
  author,
  text,
  meta,
  insights,
  className,
  clamp,
  trailing,
  children,
}: {
  author: PostAuthor;
  text: string;
  /** Right of the username, e.g. "3h" or a badge. */
  meta?: ReactNode;
  insights?: PostInsights;
  className?: string;
  /** Limit to N lines (2–4). */
  clamp?: 2 | 3 | 4;
  /** Inline content after the text, e.g. a streaming caret. */
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className={cn("flex gap-3", className)}>
      <Avatar name={author.name} hue={author.avatarHue} />
      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-1.5 text-sm">
          <span className="truncate font-semibold text-fg">{author.username}</span>
          {author.isVerified && <BadgeCheck className="size-4 shrink-0 text-sky-400" aria-label="Verified" />}
          {meta && <span className="ml-auto flex shrink-0 items-center gap-2 text-subtle">{meta}</span>}
        </header>
        <p
          className={cn(
            "mt-1 whitespace-pre-line text-[15px] text-fg/90 leading-relaxed",
            clamp === 2 && "line-clamp-2",
            clamp === 3 && "line-clamp-3",
            clamp === 4 && "line-clamp-4",
          )}
        >
          {/* Blank lines waste clamped space, so collapse them in short previews. */}
          {clamp ? text.replace(/\n{2,}/g, "\n") : text}
          {trailing}
        </p>
        {insights && (
          <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-subtle text-xs">
            <Stat icon={<Eye />} label="Views" value={insights.views} />
            <Stat icon={<Heart />} label="Likes" value={insights.likes} />
            <Stat icon={<MessageCircle />} label="Replies" value={insights.replies} />
            <Stat icon={<Repeat2 />} label="Reposts" value={insights.reposts + insights.quotes} />
          </dl>
        )}
        {children}
      </div>
    </article>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1 [&_svg]:size-3.5">
      <dt className="contents">
        {icon}
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="tabular">{formatMetric(value, "compact")}</dd>
    </div>
  );
}
