const js = (await Bun.file('./bundle.js').text()).replaceAll('</script', '<\\/script');
const css = await Bun.file('./output.css').text();
const base = new URL(process.env._3B_WORKFLOW_BASE_URL ?? 'http://localhost').pathname.replace(/\/$/, '');
const submitUrl = `${base}/ddi/request/submit`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#4f46e5"/><circle cx="8" cy="8" r="2" fill="#fff"/><circle cx="3.5" cy="3.5" r="1.5" fill="#a5b4fc"/><circle cx="12.5" cy="3.5" r="1.5" fill="#a5b4fc"/><circle cx="3.5" cy="12.5" r="1.5" fill="#a5b4fc"/><circle cx="12.5" cy="12.5" r="1.5" fill="#a5b4fc"/></svg>`;

console.log(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DDI Request · Orbia</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(icon)}">
  <style>${css}</style>
</head>
<body>
  <div id="root"></div>
  <script>window.__SUBMIT_URL__=${JSON.stringify(submitUrl)};</script>
  <script type="module">${js}</script>
</body>
</html>`);
