Builds the HTTP response for whichever route started the run.

**Trigger:** upstream [Notification Preview](<../Notification Preview/script.ts>).

Summarizes the governance outcome as JSON: risk score and verdict, each finding, the model-policy verdict, bypass detail, credential names and scopes, and the deployment record. Status code follows the disposition — `403` blocked, `200` deployed, `202` awaiting human review.

Logs `event=gateway.responded …`.
