import { fetchKevFeed } from "./kev";

const catalog = await fetchKevFeed();
if (catalog.count === 0) throw new Error("CISA feed returned zero vulnerabilities");
console.error(JSON.stringify({ event: "kev_feed_fetched", version: catalog.catalogVersion, count: catalog.count }));
console.log(JSON.stringify(catalog));
