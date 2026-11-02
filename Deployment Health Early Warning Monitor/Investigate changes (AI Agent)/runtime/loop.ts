import { type ModelMessage, stepCountIs, streamText, type ToolSet } from "ai";
import { readAgentConfig } from "./config";
import { resolveModel } from "./model";
import type { ResponseStream } from "./response";
import { streamResponse } from "./streamResponse";
import { emptyUsage, readHistory } from "./transcript";
import { loadTools } from "./tools";

// The platform kills the step at work.timeoutMs (capped at 5 minutes); we stop a
// little under it so the transcript is persisted before we're killed.
const WALL_CLOCK_MS = 270 * 1000;
const SYSTEM_FALLBACK = "You are a helpful assistant.";

export async function runAgent({
  message,
  context,
  transcriptFile,
  out,
  interactive,
}: {
  message: string | null;
  context: unknown;
  transcriptFile: string;
  out: ResponseStream;
  interactive: boolean;
}): Promise<void> {
  const systemFile = Bun.file("system.md");
  const system = (await systemFile.exists())
    ? (await systemFile.text()).trim() || SYSTEM_FALLBACK
    : SYSTEM_FALLBACK;
  const { model: modelConfig, limits } = await readAgentConfig();
  const history = await readHistory(transcriptFile);
  // maxSteps is the budget across every run of the conversation; a run that
  // finds it spent must not call the model, only report the terminal error.
  const remainingSteps = limits.maxSteps - history.steps;
  if (remainingSteps <= 0) {
    out.event({
      type: "error",
      error: `maxSteps budget exhausted: ${history.steps} model requests used of ${limits.maxSteps}`,
    });
    out.event({
      type: "done",
      totals: emptyUsage(),
      text: "",
      turn: history.steps,
    });
    return;
  }
  const { model, providerOptions, prepareTools, prepareMessages } =
    await resolveModel(modelConfig);
  const tools: ToolSet = prepareTools(await loadTools());

  // A null message is a self-loop continuation: the transcript already ends
  // with the pending tool results, so the model picks up mid-task with no new
  // user turn — exactly as if the loop had never left the step.
  if (message !== null) out.event({ type: "user-message", text: message });

  const userMessage: ModelMessage | null =
    message === null ? null : { role: "user", content: message };
  const messages: ModelMessage[] = userMessage
    ? [...history.messages, userMessage]
    : [...history.messages];
  // Provider-specific shaping (e.g. Bedrock prompt-cache points) mutates the
  // array in place before sending.
  prepareMessages(messages);

  const controller = new AbortController();
  const wallClock = setTimeout(() => controller.abort(), WALL_CLOCK_MS);
  wallClock.unref();
  const startedAt = Date.now();

  const result = streamText({
    model,
    system,
    messages,
    tools,
    providerOptions,
    maxOutputTokens: limits.maxOutputTokens,
    // An interactive run answers the caller's turn in one go; an async run makes
    // exactly one model request and relies on the self-loop to continue.
    stopWhen: stepCountIs(interactive ? remainingSteps : 1),
    abortSignal: controller.signal,
    experimental_context: context,
    onError: () => {},
  });

  try {
    await streamResponse({
      stream: result,
      controller,
      out,
      transcriptFile,
      userMessage,
      startedAt,
      startTurn: history.steps,
      tokenBudget: limits.tokenBudget,
    });
  } finally {
    clearTimeout(wallClock);
  }
}
