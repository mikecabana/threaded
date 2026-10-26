import "server-only";
import type { GatewayProviderOptions } from "@ai-sdk/gateway";
import { createGateway, type JSONValue, type LanguageModel } from "ai";
import { decryptSecret } from "@/lib/crypto/secrets";
import { env } from "@/lib/env";
import { type AiTask, type CatalogEntry, catalogFor, pickModel, sameTierFallbacks } from "./catalog";

/** Encryption context for a workspace's own Gateway key: ciphertext only decrypts for that workspace. */
export const byokContext = (workspaceId: string) => `byok:${workspaceId}`;

/** A Gateway client for a given key (AI_GATEWAY_BASE_URL only points it at a mock in tests). */
export function gatewayWithKey(apiKey: string) {
  return createGateway({ apiKey, ...(env.AI_GATEWAY_BASE_URL && { baseURL: env.AI_GATEWAY_BASE_URL }) });
}

/** True when the app can reach a model: a Gateway key, Vercel OIDC, or the test mock. */
export function isAiConfigured(): boolean {
  return Boolean(env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.AI_MOCK);
}

export interface ResolvedModel {
  model: LanguageModel;
  entry: CatalogEntry;
  /** "byok" calls are billed to the user's own Gateway account; we charge nothing. */
  billing: "credits" | "byok";
  providerOptions: { gateway: Record<string, JSONValue> };
  /** Gateway client used for cost lookups (null for the test mock). */
  gateway: ReturnType<typeof createGateway> | null;
}

/**
 * The model for a task: the user's pick if it's allowed, else the task's
 * default; routed through the platform Gateway (credits) or the workspace's
 * own key (BYOK).
 */
export async function resolveModel(input: {
  task: AiTask;
  workspace: { id: string; billingMode: "credits" | "byok"; byokKeyEnc: string | null };
  requestedModelId?: string | null;
}): Promise<ResolvedModel> {
  const entries = await catalogFor(input.task);
  const entry = pickModel(entries, input.task, input.requestedModelId);
  const billing = input.workspace.billingMode === "byok" && input.workspace.byokKeyEnc ? "byok" : "credits";

  const gatewayOptions = {
    models: sameTierFallbacks(entries, entry),
    user: input.workspace.id,
    tags: [`task:${input.task}`, `billing:${billing}`],
    // Our privacy policy promises content isn't used for training.
    disallowPromptTraining: true,
  } satisfies GatewayProviderOptions;
  const providerOptions = { gateway: gatewayOptions };

  if (process.env.AI_MOCK === "1" || process.env.AI_MOCK === "error") {
    const { createMockModel } = await import("./mock-model");
    const model = createMockModel(5, entry.modelId, { fail: process.env.AI_MOCK === "error", task: input.task });
    return { model, entry, billing, providerOptions, gateway: null };
  }

  const gateway =
    billing === "byok"
      ? gatewayWithKey(decryptSecret(input.workspace.byokKeyEnc as string, byokContext(input.workspace.id)))
      : createGateway(env.AI_GATEWAY_API_KEY ? { apiKey: env.AI_GATEWAY_API_KEY } : {});
  return { model: gateway(entry.modelId), entry, billing, providerOptions, gateway };
}
