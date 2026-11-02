import {log} from './common';
log('Deployment watch','page_started');
const js=(await Bun.file('./bundle.js').text()).replaceAll('</script','<\\/script');const css=await Bun.file('./output.css').text();
const base=process.env._3B_WORKFLOW_BASE_URL!;
const routes={data:new URL(`${base}/deployment-watch/data`).pathname,replay:new URL(`${base}/deployment-watch/replay`).pathname};
const favicon='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0e2d42"/><path d="M5 18h6l4-9 4 15 3-6h5" stroke="#65e0bc" stroke-width="3" fill="none"/></svg>');
process.stdout.write(`HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Deployment watch · Early-warning assessments</title><link rel="icon" type="image/svg+xml" href="${favicon}"><style>${css}</style></head><body><div id="root"></div><script>window.__WATCH_ROUTES__=${JSON.stringify(routes).replaceAll('</script','<\\/script')};</script><script type="module">${js}</script></body></html>`);
log('Deployment watch','page_completed');
