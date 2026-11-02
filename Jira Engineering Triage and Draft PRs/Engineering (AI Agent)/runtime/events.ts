import type { UsageTotals } from "./transcript";

// The wire contract for an agent run's output: one NDJSON event per line on
// stdout. The first event is always `conversation`, carrying the id this thread
// is keyed by (echoed back, or minted when the caller sends none).
// `owner` lets a self-looped continuation run reopen the same transcript when
// the first run was routed and authenticated.
export type AgentEvent =
  | { type: "conversation"; conversationId: string; owner?: string }
  | { type: "user-message"; text: string }
  | { type: "heartbeat" }
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    }
  | { type: "tool-error"; toolCallId: string; toolName: string; error: string }
  | { type: "usage"; turn: number; usage: UsageTotals; totals: UsageTotals }
  // `text` is the final answer, so a caller can read the result off this one
  // line instead of reassembling deltas; empty if the run ended on a tool call
  // or error. `finishReason` is the model's stop reason for the run's last
  // request — "tool-calls" means the task is still in flight.
  | {
      type: "done";
      totals: UsageTotals;
      text: string;
      finishReason?: string;
      turn: number;
    }
  | { type: "error"; error: string; contextLimit?: true };

// A headless run's entire stdout: one structured object instead of the event
// stream, which downstream steps don't need — the full trail is in the
// transcript. `status` is the loop state: "running" — the run ended on tool
// calls and the self-loop should trigger another run; "done" — the answer is in
// `text`; "error" — the run failed, was cut off, or spent its maxSteps budget
// (details on `error`). `turn` counts model requests across the whole
// conversation — for a self-looped agent, the iteration number.
export type AgentRunResult = {
  type: "agent-run";
  status: "running" | "done" | "error";
  conversationId: string;
  owner?: string;
  turn: number;
  text: string;
  error?: string;
  totals: UsageTotals;
};
