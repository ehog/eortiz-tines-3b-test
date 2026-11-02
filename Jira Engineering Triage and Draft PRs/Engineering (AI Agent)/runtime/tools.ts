import { readdirSync } from "node:fs";
import type { Tool, ToolSet } from "ai";

// Each file under tools/ is one tool, keyed by filename (tools/getTime.ts →
// "getTime") and default-exporting its tool({...}) definition.
export async function loadTools(): Promise<ToolSet> {
  const tools: ToolSet = {};
  let entries: string[];
  try {
    entries = readdirSync("tools");
  } catch {
    return tools;
  }
  for (const file of entries) {
    if (!file.endsWith(".ts")) continue;
    const name = file.slice(0, -3);
    const module = (await import(`../tools/${file}`)) as { default?: Tool };
    if (module.default) tools[name] = module.default;
  }
  return tools;
}
