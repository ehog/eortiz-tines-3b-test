Mocked enforcement, triggered by [Block decision](<../Block decision/script.ts>). Reads the decision from the upstream response headers and exits immediately unless it is `approved`, and does nothing if the request was already executed.

For each approved target it fabricates a Zscaler URL-category update or a Defender custom-indicator creation with a reference id and detail line, then stores `executed_at` and the per-target results in `block_requests` for the report page.

To make this real, attach Zscaler and Microsoft Defender connectors and replace the generated results with calls to the Zscaler URL-category API and the Defender indicators API.
