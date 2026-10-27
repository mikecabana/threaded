import { type FlexibleSchema, NoObjectGeneratedError, Output } from "ai";

// Background calls ask for a JSON object (topics, Profile DNA). Some models
// still wrap it in a code block or a sentence ("Here are the topics:"), which
// fails to parse; these helpers unwrap it before giving up, and say why a
// reply couldn't be read without logging what it said.

/** The JSON object inside a reply that wraps it in a code block or prose, or null when there's nothing to unwrap. */
export function unwrapJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const body = (fenced ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const json = body.slice(start, end + 1);
  return json === text.trim() ? null : json;
}

/** `Output.object`, retrying the parse on the unwrapped JSON when the reply wrapped it. */
export function objectOutput<OBJECT>(options: { schema: FlexibleSchema<OBJECT> }) {
  const base = Output.object<OBJECT>(options);
  const output: typeof base = {
    ...base,
    async parseCompleteOutput(reply, context) {
      try {
        return await base.parseCompleteOutput(reply, context);
      } catch (error) {
        const unwrapped = unwrapJson(reply.text);
        if (unwrapped === null) throw error;
        return base.parseCompleteOutput({ text: unwrapped }, context);
      }
    },
  };
  return output;
}

/**
 * An error's message, plus for an unreadable reply how the reply ended and
 * what shape it had (never its words, which can quote the author's posts).
 */
export function failureDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!NoObjectGeneratedError.isInstance(error)) return message;
  const text = (error.text ?? "").trim();
  const shape = text.startsWith("```")
    ? "in a code block"
    : text.startsWith("{")
      ? text.endsWith("}")
        ? "a JSON object"
        : "JSON cut off"
      : text
        ? "starts with prose"
        : "empty";
  const tokens = error.usage?.outputTokens;
  return `${message} (finish: ${error.finishReason ?? "unknown"}, ${tokens ?? "?"} output tokens, ${text.length} characters, ${shape})`;
}
