const request = await Bun.stdin.text();
const [method = "GET", target = "/"] = (request.split("\r\n")[0] ?? "").split(" ");
const params = Object.fromEntries(new URL(target, "http://localhost").searchParams);
console.log(JSON.stringify({ kind: "catalog", method, params }));
