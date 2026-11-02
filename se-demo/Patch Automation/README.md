Automated Automox vulnerability detection and patch management, rebuilt from the Tines story `SEDemo_Patching_Automox`.

#### Business purpose

Find software packages with known CVEs across Automox-managed devices, alert the IT admin team in Slack with one-click controls, then either queue the patch in Automox or open a Tines case tracking the deferred risk.

#### Flow

1. **[Find vulnerable packages](<./Find vulnerable packages/README.md>)** — cron (weekdays 13:00 UTC). Lists org packages, keeps those whose severity is not `no_known_cves`, lists devices, lists each device's packages, correlates, and emits the first 5 matches.
2. **[Notify IT admin team](<./Notify IT admin team/README.md>)** — posts one Block Kit alert per match to `#se_demos` with **Patch Now** / **Postpone** buttons linking to the decision route.
3. **[Handle patch decision](<./Handle patch decision/README.md>)** — HTTP route `/patch-decision`. Renders a confirmation page and emits the decision to both branches.
4. **[Install patch](<./Install patch/README.md>)** — on `YES`, queues `InstallUpdate` in Automox.
5. **[Postpone and create case](<./Postpone and create case/README.md>)** — on `NO`, Claude writes a verbose case description, a Tines case is created, and a Slack summary with a case link is posted.

#### Patch console app

A space-private web app over the same data, for reviewing and acting on findings outside Slack.

- **[Patch console](<./Patch console/README.md>)** — `GET /console`. React app with a **Findings** view (severity groups, search, status and severity filters, per-row Patch now / Postpone behind a confirmation dialog) and a **History** view (decision timeline, findings by severity, patched vs postponed per day). A header **Tour** button runs an 8-stop guided demo overlay narrating the use case and the value of building it in 3B.
- **[Patch data](<./Patch data/README.md>)** — `GET /api/patching`. Read-only JSON: findings, recent decisions, rollups, last scan.
- **[Record decision](<./Record decision/README.md>)** — `POST /api/decide`. Records a console decision, then links to *Install patch* and *Postpone and create case* just like the Slack route.

All three use `route_auth = "space"`, so only members of the space `eortiz@tines.io` can reach them. The Slack route stays on `sso` because its buttons are clicked by external admins.

#### State

The volume `patching` holds `state.db` (SQLite): `findings` (one row per device/package, `status` `open` | `patching` | `postponed`), `decisions` (append-only, `source` `slack` | `app`), and `runs` (one row per scan). The scan inserts and resolves findings; both decision routes append decisions and update statuses. Writers mount the volume `concurrency=exclusive`; *Patch data* mounts it `:ro`. In Live the volume belongs to the space; a draft branch gets isolated files, so the console is empty on a fresh draft until the scan runs.

#### External services

Automox (org `104352`), Slack (`Slack - For SEs`, channel `se_demos`), Tines Cases (`se-cases-demo.tines.com`, team `132137`), Anthropic.

#### Side effects

Slack messages, real Automox patch installs, real Tines cases. Automox org ID, Slack channel, Tines team ID and the alert cap are constants at the top of each step's script.

---

### Migration report

**Migrated 1:1**

| Tines action | 3B step |
| --- | --- |
| List Software Packages for an Organization / Get Details for All Devices / List Software Packages for a Device, `Packages with known cves`, `explode devices`, `explode software`, `Software that requires patching`, `Implode matching software events`, `Explode top 5 only` | Find vulnerable packages (one step, one run) |
| Send a slack message to the IT admin team + Add Buttons to Slack Message | Notify IT admin team (single `chat.postMessage` with buttons; no second `chat.update` needed) |
| `PROMPT()` webhooks + `Patch` / `No Patch` triggers | Handle patch decision route, linked to both branches |
| Install a Specific Patch on a Device in Automox | Install patch |
| AI Agent Action (create case + notify) | Postpone and create case |

**Changed shape**

- **No fan-out.** Tines exploded devices and packages into per-event branches; 3B keeps a single run and loops. The Implode/Explode "top 5" pair is now a `slice(0, 5)` in the discovery step.
- **Interactive buttons.** Tines `PROMPT()` mints a per-event webhook URL. Here the buttons carry device, package and decision as query parameters on the `/patch-decision` route, so the decision is self-describing rather than event-scoped.
- **AI agent → single model call.** The original agent chose its own tools; this step calls Claude once for the case narrative, then creates the case and posts to Slack deterministically.
- **Install patch is enabled.** It was `disabled` in the Tines story. It now really calls Automox when **Patch Now** is clicked — remove its link if you demo against production.

**Needs a human**

- **Route auth is `sso`.** Anyone clicking a Slack button authenticates against the tenant's SSO provider; on this draft, access is floored to members of the space `eortiz@tines.io`. Say the word if you'd rather it be `external_id` (unguessable link) or `public`.
- **`Capture Record` was dropped.** The target tenant has no `Story Run Tracking` record type (the original used record type `27727` on a different tenant). Create it and I'll add the step back.
- **Tines team changed.** The story used team `81507`; the available connector points at `se-cases-demo.tines.com`, so team `132137` ("3B cases") is used.
- **Slack connector.** `Slack - For SEs` is attached; switch it if you want `Slack SE Demos` (the 3B Bot).
- **Storyboard demo notes** (pre-demo setup, tell/show/tell script, cleanup) were not migrated — they describe the Tines UI, not this workflow.

**Double-check**

- Automox package fields are read as `package_id ?? id` and `name ?? display_name`; verify against your tenant if matches look empty.
- Only the **first 5** matches alert in Slack per run (20 matches existed in the last test run); the rest are still stored and visible in the patch console.
- No cross-run dedup — the same unpatched package alerts in Slack again on every scheduled run, even if it was already postponed in the console.

**Remaining Tines dependencies**

Tines Cases API (`POST /api/v2/cases`) in *Postpone and create case*. Nothing else calls back to Tines.
