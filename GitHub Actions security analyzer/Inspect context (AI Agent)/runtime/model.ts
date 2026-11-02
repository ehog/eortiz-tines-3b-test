import { createAnthropic } from "@ai-sdk/anthropic";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type { ModelConfig, ThinkingConfig } from "./config";
import {
  clampEffort,
  type EffortLevel,
  isEffortLevel,
  type ModelEffortRule,
} from "./effort";

// What the loop needs from a provider: a ready model, the provider options to
// stream with, and optional tool/message massaging.
export type ResolvedModel = {
  model: LanguageModel;
  providerOptions: SharedV3ProviderOptions;
  prepareTools: <T extends ToolSet>(tools: T) => T;
  prepareMessages: (messages: ModelMessage[]) => void;
};

// This template ships only the Anthropic provider as a starting point. To run on
// another provider, swap the builder below — the 3B agent can write it.

// Credentials never enter the sandbox: the egress proxy injects the real secret
// on the way out, so we construct with a placeholder.
const PLACEHOLDER_KEY = "set-by-connector";

// `max` (unconstrained thinking) is limited to the most capable Claude models.
const MODEL_EFFORTS: readonly ModelEffortRule[] = [
  { pattern: /fable|opus/i, levels: ["low", "medium", "high", "max"] },
  { pattern: /sonnet|haiku/i, levels: ["low", "medium", "high"] },
];

// Used when model.json sets no `thinking`: adaptive thinking with a summarized
// reasoning stream (recent Claude models otherwise omit reasoning from the
// stream, so `summarized` is what surfaces it for the transcript and chat UI).
const DEFAULT_THINKING: ThinkingConfig = {
  type: "adaptive",
  display: "summarized",
};
const CACHE_CONTROL = { type: "ephemeral" as const };

function applyEagerInputStreamingToTools<T extends ToolSet>(tools: T): T {
  const entries = Object.entries(tools) as Array<[keyof T, T[keyof T]]>;
  return Object.fromEntries(
    entries.map(([name, tool]) => [
      name,
      {
        ...tool,
        providerOptions: {
          ...tool.providerOptions,
          anthropic: {
            ...tool.providerOptions?.anthropic,
            eagerInputStreaming: true,
          },
        },
      },
    ])
  ) as unknown as T;
}

function providerOptions(
  model: string,
  effort: EffortLevel | null,
  thinking: ThinkingConfig
): SharedV3ProviderOptions {
  // Reasoning effort only applies while thinking is on; the provider rejects it
  // alongside disabled thinking.
  const level =
    thinking.type !== "disabled" && effort
      ? clampEffort(MODEL_EFFORTS, model, effort)
      : null;
  return {
    anthropic: {
      thinking,
      cacheControl: CACHE_CONTROL,
      ...(level ? { effort: level } : {}),
    },
  };
}

export async function resolveModel(
  config: ModelConfig
): Promise<ResolvedModel> {
  if (config.provider !== "anthropic") {
    throw new Error(
      `This template ships only the "anthropic" provider; got "${config.provider}". Add the provider you need in runtime/model.ts.`
    );
  }
  const anthropic = createAnthropic({
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    apiKey: PLACEHOLDER_KEY,
  });
  const effort =
    config.effort && isEffortLevel(config.effort) ? config.effort : null;
  const thinking = config.thinking ?? DEFAULT_THINKING;
  return {
    model: anthropic(config.model),
    providerOptions: providerOptions(config.model, effort, thinking),
    prepareTools: applyEagerInputStreamingToTools,
    prepareMessages: () => {},
  };
}
