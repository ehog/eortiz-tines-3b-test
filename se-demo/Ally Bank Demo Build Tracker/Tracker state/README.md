State API for the tracker page, served at `/ally-demo-tracker-state` (space members only).

- `GET` returns `{ "state": { "<id>": { "link", "feedback", "status" } } }` for all six use cases, defaulting to empty values with status `Not started`.
- `POST` with `{ "id", "link"?, "feedback"?, "status"? }` merges the patch and returns the full state.

State is stored as `state.json` in the `ally_demo_tracker` named volume, mounted exclusively so concurrent saves can't clobber each other. See [script.ts](script.ts).
