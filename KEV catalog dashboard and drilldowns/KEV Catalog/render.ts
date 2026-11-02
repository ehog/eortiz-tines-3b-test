const js = (await Bun.file('./bundle.js').text()).replaceAll('</script', '<\\/script');
const css = await Bun.file('./output.css').text();
const basePath = process.env._3B_BRANCH_ID
  ? `/__3b/branch/${process.env._3B_BRANCH_ID}${process.env.ROUTE_PATH ?? ''}`
  : process.env.ROUTE_PATH ?? '';
const apiBase = new URL(`${process.env._3B_WORKFLOW_BASE_URL ?? ''}/kev/api`, 'http://localhost').pathname;

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0f172a"/><path d="M16 5l9 3.5v6.5c0 5.6-3.8 10.4-9 12-5.2-1.6-9-6.4-9-12V8.5z" fill="#06b6d4"/><path d="M16 11v7" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="22" r="1.8" fill="#0f172a"/></svg>`;
const safe = (v: unknown) => JSON.stringify(v).replaceAll('</script', '<\\/script').replaceAll('<', '\\u003c');

console.log(`<!DOCTYPE html>
<html lang="en" class="bg-slate-950">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KEV Catalog · Known Exploited Vulnerabilities</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(favicon)}">
  <style>${css}</style>
</head>
<body class="bg-slate-950">
  <div id="root"></div>
  <script>window.__ROUTE_PATH__=${safe(basePath)};window.__API_BASE__=${safe(apiBase)};</script>
  <script type="module">${js}</script>
</body>
</html>`);
