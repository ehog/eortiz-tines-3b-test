import { APICallError, RetryError } from "ai";

export function isPromptTooLongError(error: unknown): boolean {
  // Non-retryable errors normally arrive bare, but the `ai` SDK wraps one in a
  // RetryError if an earlier attempt failed for a retryable reason.
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(cause)) {
    return (
      cause.statusCode === 413 ||
      cause.message.includes("prompt is too long") ||
      cause.message.includes("exceeds the context window")
    );
  }
  return false;
}
