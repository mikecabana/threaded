import "server-only";
import type { GatewayProviderOptions } from "@ai-sdk/gateway";
import { createGateway, type Experimental_DecisionModel, type JSONValue, type LanguageModel } from "ai";
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

  if (mocked()) {
    const { createMockModel } = await import("./mock-model");
    const model = createMockModel(5, entry.modelId, { fail: process.env.AI_MOCK === "error", task: input.task });
    return { model, entry, billing, providerOptions, gateway: null };
  }

  const gateway = gatewayFor(input.workspace, billing);
  return { model: gateway(entry.modelId), entry, billing, providerOptions, gateway };
}

const mocked = () => process.env.AI_MOCK === "1" || process.env.AI_MOCK === "error";

type WorkspaceKey = { id: string; byokKeyEnc: string | null };

/** The Gateway client the workspace's AI runs through: its own key, or ours. */
function gatewayFor(workspace: WorkspaceKey, billing: "credits" | "byok") {
  return billing === "byok"
    ? gatewayWithKey(decryptSecret(workspace.byokKeyEnc as string, byokContext(workspace.id)))
    : createGateway(env.AI_GATEWAY_API_KEY ? { apiKey: env.AI_GATEWAY_API_KEY } : {});
}

export interface ResolvedDecisionModel {
  model: Experimental_DecisionModel;
  billing: "credits" | "byok";
  /** Gateway options without fallbacks; callers add their own, since conditions name their questions. */
  gatewayOptions: Record<string, JSONValue>;
  /** The task's default language model, for Gateway fallbacks. */
  fallbackModelId: string;
}

/**
 * A decision model (e.g. Jev) for a background task, routed like any other
 * call: the workspace's own key or ours. Fallbacks use the task's default
 * language model from the catalog.
 */
export async function resolveDecisionModel(input: {
  modelId: string;
  task: AiTask;
  workspace: { id: string; billingMode: "credits" | "byok"; byokKeyEnc: string | null };
}): Promise<ResolvedDecisionModel> {
  const fallback = pickModel(await catalogFor(input.task), input.task);
  const billing = input.workspace.billingMode === "byok" && input.workspace.byokKeyEnc ? "byok" : "credits";
  const gatewayOptions = {
    user: input.workspace.id,
    tags: [`task:${input.task}`, `billing:${billing}`],
    disallowPromptTraining: true,
  } satisfies GatewayProviderOptions;
  if (mocked()) {
    const { createMockDecisionModel } = await import("./mock-model");
    const model = createMockDecisionModel(input.modelId, { fail: process.env.AI_MOCK === "error" });
    return { model, billing, gatewayOptions, fallbackModelId: fallback.modelId };
  }
  const model = gatewayFor(input.workspace, billing).decisionModel(input.modelId);
  return { model, billing, gatewayOptions, fallbackModelId: fallback.modelId };
}
