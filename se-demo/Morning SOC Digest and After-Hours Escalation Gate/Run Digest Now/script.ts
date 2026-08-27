const raw = await Bun.stdin.text();
const requestedBy = /^x-3b-authenticated-email:\s*(.+)$/im.exec(raw)?.[1]?.trim() ?? "unknown";

console.error(`Manual digest run requested by ${requestedBy}.`);
console.log(JSON.stringify({ trigger: "manual", requestedBy, requestedAt: new Date().toISOString() }));
