import type { AiTask } from "@/lib/ai/catalog";

// How /admin names and explains each AI task (lib/ai/catalog.ts). Shared by
// the catalog page and its client forms, so it stays free of server code.

/** Display order: what people use, then background work, then what isn't built yet. */
export const TASK_ORDER = ["generate", "research", "classify", "dna", "critique"] as const satisfies readonly AiTask[];

export const TASK_INFO: Record<AiTask, { name: string; billing: "charged" | "on us" | "unused"; summary: string }> = {
  generate: {
    name: "Studio ideas",
    billing: "charged",
    summary: "Writes the ideas in Studio. People can pick any model in this list; the default is preselected.",
  },
  research: {
    name: "Web research",
    billing: "charged",
    summary:
      "Before Studio writes about a specific or recent topic, searches the web and sums up what it finds. Charged with the batch, only when it searches. Needs a model that can call tools.",
  },
  classify: {
    name: "Post labels",
    billing: "on us",
    summary: "Labels each post's format, topic, hook and tone during sync.",
  },
  dna: {
    name: "Profile DNA",
    billing: "on us",
    summary: "Rebuilds each account's DNA during sync, at most weekly, once it has 10 posts.",
  },
  critique: {
    name: "Draft reranking",
    billing: "unused",
    summary: "Planned: a second pass that reranks Studio's drafts, charged like ideas. Nothing uses it yet.",
  },
};

export const taskNames = (tasks: readonly string[]) =>
  tasks.map((task) => TASK_INFO[task as AiTask]?.name ?? task).join(", ");
