import type { GatewayEntry } from "@/lib/admin/gateway-models";

// Test-only stand-in for the AI Gateway's model list (AI_MOCK=1), shaped like
// `gateway.getAvailableModels()`: prices per token, and a few entries the
// admin picker leaves out (no price, not a language model).

const usd = (perMillion: number) => (perMillion / 1_000_000).toFixed(12);
const language = (id: string, name: string, input: number, output: number, description?: string): GatewayEntry => ({
  id,
  name,
  description: description ?? null,
  pricing: { input: usd(input), output: usd(output) },
  modelType: "language",
});

export const MOCK_GATEWAY_MODELS: GatewayEntry[] = [
  language("anthropic/claude-haiku-5.5", "Claude Haiku 5.5", 1, 5, "Anthropic's fastest model."),
  language("anthropic/claude-sonnet-5.5", "Claude Sonnet 5.5", 3, 15, "Anthropic's balanced model."),
  language("anthropic/claude-opus-5.5", "Claude Opus 5.5", 5, 25, "Anthropic's most capable model."),
  language("openai/gpt-5.5", "GPT-5.5", 1.25, 10, "OpenAI's flagship model."),
  language("openai/gpt-5.5-mini", "GPT-5.5 mini", 0.25, 2, "A smaller, cheaper GPT-5.5."),
  language("google/gemini-3.5-flash", "Gemini 3.5 Flash", 0.3, 2.5),
  language("google/gemini-3.5-pro", "Gemini 3.5 Pro", 1.25, 10),
  language("xai/grok-5", "Grok 5", 3, 15),
  language("deepseek/deepseek-v4", "DeepSeek V4", 0.27, 1.1),
  { id: "meta/llama-5-70b", name: "Llama 5 70B", pricing: null, modelType: "language" },
  {
    id: "openai/text-embedding-4-small",
    name: "Text Embedding 4 Small",
    pricing: { input: usd(0.02), output: usd(0) },
    modelType: "embedding",
  },
  { id: "vercel/jev", name: "Jev", pricing: { input: usd(0.01), output: usd(0.01) }, modelType: "decision" },
];
