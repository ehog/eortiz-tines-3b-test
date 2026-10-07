import { makeLogger } from "./log";

const STEP = "Calculate reorder points";
const startedAt = Date.now();

type ItemFields = Record<string, any>;
type Input = {
  runId: string;
  checkedAt: string;
  seeded: boolean;
  elapsedDays: number;
  received: Array<{ poNumber: string; supplier: string; lines: number; units: number }>;
  items: Array<{ id: string; fields: ItemFields }>;
};

const input = JSON.parse(await Bun.stdin.text()) as Input;
const log = makeLogger(STEP, input.runId);

log("info", "calculation_started", "Scoring every stocked item against its reorder point.", {
  items: input.items.length,
});

export type Status = "healthy" | "low" | "critical" | "out_of_stock";

export type Analysis = {
  recordId: string;
  sku: string;
  name: string;
  category: string;
  supplier: string;
  supplierEmail: string;
  unitCost: number;
  onHand: number;
  allocated: number;
  onOrder: number;
  available: number;
  avgDailyUsage: number;
  leadTimeDays: number;
  safetyStockDays: number;
  reviewPeriodDays: number;
  leadTimeDemand: number;
  safetyStock: number;
  reorderPoint: number;
  targetLevel: number;
  daysOfCover: number | null;
  status: Status;
  needsReorder: boolean;
  suggestedQty: number;
  estimatedCost: number;
  reason: string;
};

const round = (n: number, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

const analyses: Analysis[] = [];
let skipped = 0;

for (const record of input.items) {
  const f = record.fields;
  const sku = f["SKU"];

  if (f["Discontinued"]) {
    skipped++;
    log("warn", "item_skipped", "Item is discontinued; not scored for reorder.", { sku });
    continue;
  }

  const avgDailyUsage = Number(f["Avg Daily Usage"]) || 0;
  if (avgDailyUsage <= 0) {
    skipped++;
    log("warn", "item_skipped", "Item has no recorded usage; reorder point is undefined.", { sku });
    continue;
  }

  const onHand = Number(f["On Hand"]) || 0;
  const allocated = Number(f["Allocated"]) || 0;
  const onOrder = Number(f["On Order"]) || 0;
  const available = onHand + onOrder - allocated;

  const leadTimeDays = Number(f["Lead Time Days"]) || 0;
  const safetyStockDays = Number(f["Safety Stock Days"]) || 0;
  const reviewPeriodDays = Number(f["Review Period Days"]) || 0;

  const leadTimeDemand = avgDailyUsage * leadTimeDays;
  const safetyStock = avgDailyUsage * safetyStockDays;
  const reorderPoint = leadTimeDemand + safetyStock;
  const targetLevel = reorderPoint + avgDailyUsage * reviewPeriodDays;

  const status: Status =
    available <= 0 ? "out_of_stock"
      : available <= leadTimeDemand ? "critical"
        : available <= reorderPoint ? "low"
          : "healthy";

  const needsReorder = status !== "healthy";

  const packSize = Math.max(1, Number(f["Pack Size"]) || 1);
  const minOrderQty = Number(f["Min Order Qty"]) || 0;
  const shortfall = Math.max(0, targetLevel - available);
  const suggestedQty = needsReorder
    ? Math.ceil(Math.max(shortfall, minOrderQty) / packSize) * packSize
    : 0;

  const reason =
    status === "out_of_stock" ? "Out of stock — all available units are allocated"
      : status === "critical" ? "Will stock out before a replenishment can arrive"
        : status === "low" ? "Below reorder point"
          : "Above reorder point";

  analyses.push({
    recordId: record.id,
    sku,
    name: f["Item Name"],
    category: f["Category"],
    supplier: f["Supplier"],
    supplierEmail: f["Supplier Email"],
    unitCost: Number(f["Unit Cost"]) || 0,
    onHand,
    allocated,
    onOrder,
    available,
    avgDailyUsage,
    leadTimeDays,
    safetyStockDays,
    reviewPeriodDays,
    leadTimeDemand: round(leadTimeDemand, 1),
    safetyStock: round(safetyStock, 1),
    reorderPoint: round(reorderPoint, 1),
    targetLevel: round(targetLevel, 1),
    daysOfCover: round(available / avgDailyUsage, 1),
    status,
    needsReorder,
    suggestedQty,
    estimatedCost: round(suggestedQty * (Number(f["Unit Cost"]) || 0), 2),
    reason,
  });
}

const severity: Record<Status, number> = { out_of_stock: 0, critical: 1, low: 2, healthy: 3 };
const reorder = analyses
  .filter((a) => a.needsReorder)
  .sort((a, b) => severity[a.status] - severity[b.status] || (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));

const summary = {
  total: input.items.length,
  evaluated: analyses.length,
  skipped,
  healthy: analyses.filter((a) => a.status === "healthy").length,
  low: analyses.filter((a) => a.status === "low").length,
  critical: analyses.filter((a) => a.status === "critical").length,
  outOfStock: analyses.filter((a) => a.status === "out_of_stock").length,
  reorderCount: reorder.length,
  estimatedSpend: round(reorder.reduce((n, a) => n + a.estimatedCost, 0), 2),
};

log("info", "calculation_completed", "Reorder points scored.", {
  ...summary,
  duration_ms: Date.now() - startedAt,
});

console.log(
  JSON.stringify({
    runId: input.runId,
    checkedAt: input.checkedAt,
    received: input.received,
    summary,
    items: analyses,
    reorder,
  }),
);
