Composes the message the employee sees when Onyx blocks a newly discovered asset — "this was blocked, request approval in the portal".

Triggered by [Onyx asset created](<../Onyx asset created/README.md>); input is `{"blocked": [asset, …]}`. There is no real messaging integration: the message is logged to stderr, recorded as a `user.notified` audit row in `/storage/mock_state/mock.db`, and emitted as JSON. Swap this step for a Slack or email connector when the demo becomes real.

Logic in [script.ts](script.ts).
