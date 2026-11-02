import type { AgentRunResult } from "./events";

// A self-looped agent's stdin is its own previous run's structured
// AgentRunResult. Anything else — the trigger payload on the first run —
// returns null.
export function parsePriorRun(raw: string): AgentRunResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const result = parsed as AgentRunResult;
  if (result.type !== "agent-run") return null;
  return typeof result.conversationId === "string" ? result : null;
}
