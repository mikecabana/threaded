import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { failureDetail, objectOutput, unwrapJson } from "./structured";

const schema = z.object({ topics: z.array(z.object({ name: z.string() })) });
const json = '{"topics":[{"name":"pricing"}]}';

function replying(text: string, finish: "stop" | "length" = "stop") {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: finish, raw: undefined },
      usage: {
        inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1000, text: 1000, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

const ask = (text: string, finish?: "stop" | "length") =>
  generateText({ model: replying(text, finish), prompt: "Name the topics.", output: objectOutput({ schema }) });

describe("structured output", () => {
  it("unwraps JSON from a code block or a sentence", () => {
    expect(unwrapJson(`\`\`\`json\n${json}\n\`\`\``)).toBe(json);
    expect(unwrapJson(`Here are the topics:\n${json}\nHope that helps.`)).toBe(json);
    expect(unwrapJson(json)).toBeNull();
    expect(unwrapJson("No topics today.")).toBeNull();
  });

  it("reads a wrapped reply instead of failing on it", async () => {
    expect((await ask(`\`\`\`json\n${json}\n\`\`\``)).output).toEqual({ topics: [{ name: "pricing" }] });
    expect((await ask(`Here are the topics: ${json}`)).output).toEqual({ topics: [{ name: "pricing" }] });
  });

  it("explains an unreadable reply without repeating it", async () => {
    const error = await ask('{"topics":[{"name":"secret launch plans"', "length").catch((e: unknown) => e);
    const detail = failureDetail(error);
    expect(detail).toContain("finish: length, 1000 output tokens");
    expect(detail).toContain("JSON cut off");
    expect(detail).not.toContain("secret");
    expect(failureDetail(new Error("Gateway timeout"))).toBe("Gateway timeout");
  });
});
