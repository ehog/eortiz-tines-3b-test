import { z } from "zod";

// Used when model.json sets no limits. maxSteps caps model requests across
// every run of a conversation, not one step run.
const DEFAULT_MAX_STEPS = 100;
const DEFAULT_TOKEN_BUDGET = 5_000_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000;

// Mirrors the Anthropic provider's `thinking` option. Omit it to take the
// default (adaptive thinking with a summarized reasoning stream); set
// `{ "type": "disabled" }` to turn thinking off for a cheap routing agent.
const ThinkingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("adaptive"),
    display: z.enum(["omitted", "summarized"]).optional(),
  }),
  z.object({
    type: z.literal("enabled"),
    budgetTokens: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal("disabled") }),
]);

export type ThinkingConfig = z.infer<typeof ThinkingSchema>;

const AgentConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  effort: z.string().optional(),
  baseUrl: z.string().optional(),
  thinking: ThinkingSchema.optional(),
  limits: z
    .object({
      maxSteps: z.number().int().positive().optional(),
      tokenBudget: z.number().int().positive().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
    })
    .optional(),
});

export type ModelConfig = {
  provider: string;
  model: string;
  effort?: string;
  baseUrl?: string;
  thinking?: ThinkingConfig;
};

export type Limits = {
  maxSteps: number;
  tokenBudget: number;
  maxOutputTokens: number;
};

export type AgentConfig = { model: ModelConfig; limits: Limits };

export function parseAgentConfig(text: string): AgentConfig {
  const raw = AgentConfigSchema.parse(JSON.parse(text));
  const limits = raw.limits ?? {};
  return {
    model: {
      provider: raw.provider,
      model: raw.model,
      effort: raw.effort,
      baseUrl: raw.baseUrl,
      thinking: raw.thinking,
    },
    limits: {
      maxSteps: limits.maxSteps ?? DEFAULT_MAX_STEPS,
      tokenBudget: limits.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
      maxOutputTokens: limits.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    },
  };
}

export async function readAgentConfig(): Promise<AgentConfig> {
  return parseAgentConfig(await Bun.file("model.json").text());
}
