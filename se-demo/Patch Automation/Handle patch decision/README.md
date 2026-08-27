HTTP route `/patch-decision` (`route_auth = "sso"`), opened when an admin clicks a button in the Slack alert.

Parses the query parameters, renders a confirmation page, and writes the decision JSON as a final stdout line after the HTTP response — `Content-Length` bounds the response, so the browser ignores it while linked steps read it.

Payload: `{ decision: "YES" | "NO", device_id, device_name, package_id, package_name, severity, decided_by, decided_at }`. `decided_by` comes from the spoof-proof `x-3b-authenticated-email` header. Both branches run; each exits quietly when the decision isn't theirs.

State: also writes the decision to the `patching` volume (`decisions` row with `source = "slack"`, and the finding's `status` set to `patching` or `postponed`) so it appears in the [patch console](<../Patch console/README.md>). Mounted `concurrency=exclusive`.

The console's own button posts to [`/api/decide`](<../Record decision/README.md>) instead; the two routes are separate because Slack buttons are clicked by SSO users while the console is space-authenticated. Both converge on the same downstream steps.
