import type { AgentEvent, AgentRunResult } from "./events";

export type ResponseStream = {
  event: (event: AgentEvent) => void;
};

// stdout is the run's output. An interactive run has a caller watching, so it
// streams one NDJSON event per line as it happens. A headless run's stdout is
// input for downstream steps (and the self-loop), so it stays silent until the
// terminal `done` and then writes a single structured AgentRunResult — the full
// trail lives in the transcript, not the pipe.
export function startResponse(interactive: boolean): ResponseStream {
  if (interactive) {
    const heartbeat = setInterval(() => {
      process.stdout.write('{"type":"heartbeat"}\n');
    }, 15_000);
    heartbeat.unref();
    return {
      event: (event) => {
        if (event.type === "done") clearInterval(heartbeat);
        process.stdout.write(`${JSON.stringify(event)}\n`);
      },
    };
  }
  let conversation: { conversationId: string; owner?: string } | undefined;
  let error: string | undefined;
  return {
    event: (event) => {
      if (event.type === "conversation") conversation = event;
      if (event.type === "error") error = event.error;
      if (event.type === "done") {
        const status = statusOf(event.finishReason);
        const result: AgentRunResult = {
          type: "agent-run",
          status,
          conversationId: conversation?.conversationId ?? "",
          owner: conversation?.owner,
          turn: event.turn,
          text: event.text,
          error:
            error ??
            (status === "error"
              ? `run ended with finish reason ${event.finishReason ?? "none"}`
              : undefined),
          totals: event.totals,
        };
        process.stdout.write(`${JSON.stringify(result)}\n`);
      }
    },
  };
}

// The provider's finish reason collapses to an explicit status exactly once,
// here: ending on tool calls means the task needs another run, yielding text is
// the answer, and anything else — killed, truncated, failed, budget spent — is
// an error.
function statusOf(
  finishReason: string | undefined
): AgentRunResult["status"] {
  if (finishReason === "tool-calls") return "running";
  if (finishReason === "stop") return "done";
  return "error";
}
