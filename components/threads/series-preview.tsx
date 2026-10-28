import type { ReactNode } from "react";
import { type PostAuthor, PostPreview } from "./post-preview";

/**
 * A series laid out the way Threads shows one: each part under the one
 * before, joined by the thread line between avatars. A single post is just
 * the post.
 */
export function SeriesPreview({
  author,
  parts,
  meta,
  clamp,
}: {
  author: PostAuthor;
  parts: { key: string; text: string }[];
  /** Right of the first part's username. */
  meta?: ReactNode;
  clamp?: 2 | 3 | 4;
}) {
  if (parts.length === 1) return <PostPreview author={author} text={parts[0].text || " "} meta={meta} clamp={clamp} />;
  return (
    <ol className="space-y-3">
      {parts.map((part, index) => (
        <li key={part.key} className="relative">
          {index < parts.length - 1 && (
            <span aria-hidden className="absolute top-11 -bottom-2 left-[17px] w-0.5 rounded-full bg-border-strong" />
          )}
          <PostPreview
            author={author}
            text={part.text || " "}
            clamp={clamp}
            meta={
              <>
                {index === 0 && meta}
                <span className="text-xs tabular">
                  <span aria-hidden>
                    {index + 1}/{parts.length}
                  </span>
                  <span className="sr-only">
                    Part {index + 1} of {parts.length}
                  </span>
                </span>
              </>
            }
          />
        </li>
      ))}
    </ol>
  );
}

/** Keys for a queued post's parts: the post's id and the part's place. */
export const seriesParts = (id: string, texts: string[]) =>
  texts.map((text, index) => ({ key: `${id}:${index}`, text }));
