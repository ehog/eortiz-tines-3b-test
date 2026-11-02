Web app at `/kev`. Loads `/kev/api/catalog` and `/kev/api/metrics` on open, then filters in the browser.

- Left navigation: Dashboard, Full Catalog, By Vendor, By Product, Ransomware-Linked, Remediation Status (becomes a drawer on small screens).
- Dashboard: KEV rollups, a "Newly published CVEs to watch" panel for the NVD watchlist, a top-vendors chart, monthly additions, and top products.
- Metric cards, chart bars, vendors, and products drill into the Full Catalog with matching filters, shown as removable chips.
- Clicking a CVE opens a detail panel with every field. Watchlist entries also show CVSS and the AI's reasoning.
- View, filters, and the selected CVE are kept in the URL hash, so views can be bookmarked or shared.
