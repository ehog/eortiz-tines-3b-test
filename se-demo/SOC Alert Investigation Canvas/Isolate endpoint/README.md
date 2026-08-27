`POST /api/isolate` with `{investigationId, device, token, approved: true, comment}`.

Four gates before anything is sent: the request must be a POST with a valid investigation id, `approved` must be exactly `true`, the token must match the digest `Investigation API` issued for this investigation and device, and the device must be an entity of this investigation. Each rejection is logged with its reason and returns 400/403/409.

On success it calls Defender's isolate action (mocked), appends the action to `<id>/actions.json` with the approving analyst from `x-3b-authenticated-email`, and returns the action record. Flip `USE_MOCK` in `client.ts` to `false` and attach the Defender connector to make it real.
