const js = (await Bun.file('./bundle.js').text()).replaceAll('</script', '<\\/script');
const css = await Bun.file('./output.css').text();
const branch = process.env._3B_BRANCH_ID ?? '';
const basePath = branch ? `/__3b/branch/${branch}${process.env.ROUTE_PATH ?? ''}` : (process.env.ROUTE_PATH ?? '');
// Every other route in this workflow is a sibling of this page's route, so this
// page's own base path is also the prefix for its API calls.
const apiRoot = basePath.replace(/\/$/, '');
const title = 'Qualys Remediation Console';

console.log(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.ico?t=${encodeURIComponent(title)}">
  <style>${css}</style>
</head>
<body>
  <div id="root"></div>
  <script>
    window.__ROUTE_PATH__=${JSON.stringify(basePath).replaceAll('</script', '<\\/script')};
    window.__API_ROOT__=${JSON.stringify(apiRoot).replaceAll('</script', '<\\/script')};
    window.__BRANCH__=${JSON.stringify(branch ? 'draft' : 'live')};
  </script>
  <script type="module">${js}</script>
</body>
</html>`);
