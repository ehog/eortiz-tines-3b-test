import type { ModelMessage, TextStreamPart, ToolSet } from "ai";
import { isPromptTooLongError } from "./contextLimit";
import type { ResponseStream } from "./response";
import {
  addUsage,
  appendRecords,
  emptyUsage,
  normaliseUsage,
  type TranscriptRecord,
} from "./transcript";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Kept structural so tests can drive it with a hand-rolled stream.
type AgentStream = {
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>;
  response: Promise<{ messages: ModelMessage[] }>;
};

// A token-budget or wall-clock abort is a normal termination, so this must
// always reach the persist + `done` even when the stream throws or `response`
// rejects on the abort path.
export async function streamResponse({
  stream,
  controller,
  out,
  transcriptFile,
  userMessage,
  startedAt,
  startTurn,
  tokenBudget,
}: {
  stream: AgentStream;
  controller: AbortController;
  out: ResponseStream;
  transcriptFile: string;
  userMessage: ModelMessage | null;
  startedAt: number;
  startTurn: number;
  tokenBudget: number;
}): Promise<void> {
  const totals = emptyUsage();
  const usageRecords: TranscriptRecord[] = [];
  // committedText snapshots finalText only when a turn finishes, so an abort
  // mid-stream reports the last completed turn's answer, not unfinished text.
  let finalText = "";
  let committedText = "";
  // Turn numbers are conversation-global: a continuation run picks up counting
  // where the transcript left off.
  let turn = startTurn;
  let finishReason: string | undefined;
  let contextLimitError = false;
  const emitError = (error: unknown) => {
    if (isPromptTooLongError(error)) {
      contextLimitError = true;
      out.event({
        type: "error",
        error: errorMessage(error),
        contextLimit: true,
      });
    } else {
      out.event({ type: "error", error: errorMessage(error) });
    }
  };

  try {
    for await (const event of stream.fullStream) {
      switch (event.type) {
        case "text-delta":
          finalText += event.text;
          out.event({ type: "text-delta", text: event.text });
          break;
        case "reasoning-delta":
          out.event({ type: "reasoning-delta", text: event.text });
          break;
        case "tool-call":
          finalText = "";
          out.event({
            type: "tool-call",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
          });
          break;
        case "tool-result":
          out.event({
            type: "tool-result",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            output: event.output,
          });
          break;
        case "tool-error":
          out.event({
            type: "tool-error",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            error: errorMessage(event.error),
          });
          break;
        case "finish-step": {
          turn += 1;
          committedText = finalText;
          finishReason = event.finishReason;
          const usage = normaliseUsage(event.usage);
          addUsage(totals, usage);
          usageRecords.push({ kind: "usage", at: Date.now(), turn, usage });
          out.event({ type: "usage", turn, usage, totals: { ...totals } });
          console.error(
            `turn=${turn} finish=${event.finishReason} in=${usage.inputTokens} out=${usage.outputTokens} cacheRead=${usage.cacheReadTokens} cacheWrite=${usage.cacheWriteTokens} reasoning=${usage.reasoningTokens} total=${totals.totalTokens} elapsedMs=${Date.now() - startedAt}`
          );
          if (totals.totalTokens >= tokenBudget) {
            console.error("token budget exceeded, stopping");
            controller.abort();
          }
          break;
        }
        case "error":
          emitError(event.error);
          break;
      }
    }
  } catch (error) {
    emitError(error);
  }

  // On the abort path `response` can reject, so swallow it and persist what we
  // have rather than drop the write and the `done` event entirely.
  const response = await stream.response.catch(() => null);
  await appendRecords(transcriptFile, [
    ...(userMessage && !contextLimitError
      ? [{ kind: "message", at: startedAt, message: userMessage } as const]
      : []),
    ...(response?.messages ?? []).map(
      (m): TranscriptRecord => ({
        kind: "message",
        at: Date.now(),
        message: m,
      })
    ),
    ...usageRecords,
  ]);

  out.event({ type: "done", totals, text: committedText, finishReason, turn });
}
