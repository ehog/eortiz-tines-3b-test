`POST /ioc/api/hunt` (space auth). Validates the submitted indicators, classifies each as `ipv4`, `ipv6`, `domain`, `url`, `sha1` or `sha256`, and rejects the request with 400 if any line is unrecognized, the reason is empty, or more than 25 indicators are submitted.

On success it inserts the hunt (with its demo mode and a random approval token) and its indicators into `/storage/iochunt/hunts.db`, responds with `{ huntId, reportPath, indicators }`, and that same response body is the input to the four search steps.

Request and response shapes are documented in [api.json](api.json). Shared helpers are in [lib.ts](lib.ts).
