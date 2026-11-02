The demo build tracker page for the Ally Bank customer demo, served at `/ally-demo-tracker` (space members only).

Renders a plum header with a countdown to the next Wednesday 9:00 am, a progress summary (x of 6 ready, plus per-status counts), and one card per use case: segment badge, customer driver, collapsible build prompt with copy-to-clipboard, editable demo link, feedback textarea, and status selector.

Use case content lives in [data.ts](data.ts); the brand CSS variables are in [globals.css](globals.css). Edits are debounced and persisted through [the Tracker state step](<../Tracker state/script.ts>) — this page loads state on mount and never receives it via stdin.
