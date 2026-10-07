Resolves the credentials the deploy step will need — **by name and scope only**.

**Trigger:** upstream [Bypass Detection](<../Bypass Detection/script.ts>).

Each team maps to a scoped deploy credential plus the append-only audit sink token. The step emits the reference set (name, purpose, scope, `injected_at: runtime`, `visible_to_code: false`) and logs `event=credentials.resolved …` with `secret_values_logged=0`. No secret value is ever read, logged, or returned — in a real deployment the 3B connector proxy injects it at request time.

Referenced credentials are shown in the console's submission drawer.
