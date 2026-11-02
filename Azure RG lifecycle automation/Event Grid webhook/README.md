**Trigger:** `POST /azure-rg/events` (`external_id` auth, so Event Grid calls it with `?external_id=…`).

- Answers the Event Grid `SubscriptionValidationEvent` handshake with `validationResponse`, and the CloudEvents `OPTIONS` handshake with `WebHook-Allowed-Origin`.
- Keeps only `Microsoft.Resources.ResourceWriteSuccess` events whose subject is exactly `/subscriptions/{id}/resourceGroups/{name}` and whose subscription is listed in `config.json`. Everything else is logged and ignored.
- Responds `200 {"accepted": n, "events": [{eventId, subscriptionId, rgName}]}`. That response is also what [Allocate CIDR](<../Allocate CIDR/README.md>) receives.
