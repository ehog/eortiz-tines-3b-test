Queues the patch in Automox when the decision is `YES`; exits with no output otherwise.

`POST https://console.automox.com/api/servers/{device_id}/queues?o={ORG_ID}` with `{ command_type_name: "InstallUpdate", args: [package_name] }` (Automox connector).

This was disabled in the original Tines story — here it performs a real install.
