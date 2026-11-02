A single-page build tracker for the six Tines demo use cases being prepared for an Ally Bank customer demo. It's a prep aid — no live connectors, mock content only.

[Tracker page](<Tracker page/App.tsx>) serves the UI at `/ally-demo-tracker`, and [Tracker state](<Tracker state/script.ts>) serves a small JSON API at `/ally-demo-tracker-state`. Both routes are restricted to members of the space. There's no schedule or webhook — a person opens the page.

The page renders immediately, then fetches state from the API and writes edits back as you type (demo link, feedback, status). State persists in the `ally_demo_tracker` named volume, so it survives runs and pushes to Live; draft branches keep their own copy.

To change use case titles, drivers, or build prompts, edit [Tracker page/data.ts](<Tracker page/data.ts>) — and keep the `id` list in [Tracker state/script.ts](<Tracker state/script.ts>) in sync. Brand colors are CSS variables in [Tracker page/globals.css](<Tracker page/globals.css>).
