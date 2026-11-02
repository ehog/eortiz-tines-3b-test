const REQUEST_LINE = /^[A-Z]+ \S+ HTTP\/\d/;
const RESPONSE_LINE = /^HTTP\/\d(?:\.\d)? \d{3}\b/;

// Distinguishes a routed invocation (stdin is an RFC 7230 request) from a
// headless one (an upstream step's raw output).
export function isHttpRequest(raw: string): boolean {
  return REQUEST_LINE.test(raw);
}

// Stdin can carry HTTP framing two ways: a routed request whose headers hold
// cookies and auth tokens that must never reach the model, or an upstream
// `output = true` step whose stdout is a whole HTTP response envelope. Reduce
// either to the body before the input is resolved; a bare payload (or a
// self-loop's prior result) passes through unchanged.
export function requestBodyOrRaw(raw: string): string {
  if (!REQUEST_LINE.test(raw) && !RESPONSE_LINE.test(raw)) return raw;
  const sep = raw.match(/\r?\n\r?\n/);
  return sep ? raw.slice(sep.index! + sep[0].length) : "";
}

// The platform verifies the caller and injects `x-3b-authenticated-email` into
// the request, stripping any client-supplied value first, so it is a trustworthy
// principal we can scope per-user storage by — never the body, which the caller
// controls. Read it off the raw request before the headers are dropped; null for
// an unauthenticated route or a headless run (an upstream step's raw output).
export function authenticatedPrincipal(raw: string): string | null {
  return authenticatedHeader(raw, "x-3b-authenticated-email");
}

// The caller's verified group names: the IdP snapshot for SSO callers, current
// 3B groups for members. The platform injects them as a JSON array and omits the
// header when there are none, so an empty list means no verified groups.
export function authenticatedGroups(raw: string): string[] {
  const value = authenticatedHeader(raw, "x-3b-authenticated-groups");
  return value ? JSON.parse(value) : [];
}

function authenticatedHeader(raw: string, name: string): string | null {
  if (!REQUEST_LINE.test(raw)) return null;
  const sep = raw.match(/\r?\n\r?\n/);
  const head = sep ? raw.slice(0, sep.index!) : raw;
  for (const line of head.split(/\r?\n/)) {
    if (!line.toLowerCase().startsWith(`${name}:`)) continue;
    const value = line.slice(name.length + 1).trim();
    return value || null;
  }
  return null;
}
