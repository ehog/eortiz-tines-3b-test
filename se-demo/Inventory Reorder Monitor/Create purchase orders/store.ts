/**
 * Stand-in for the Airtable base. Every record here mirrors the shape Airtable's
 * REST API returns ({ id, createdTime, fields }) so swapping this module for real
 * `api.airtable.com` calls is a change to this file only — see the workflow README.
 */
import { mkdir } from "node:fs/promises";

export const DB_DIR = "/storage/inventory_db";
export const DB_PATH = `${DB_DIR}/db.json`;

export type ItemFields = {
  SKU: string;
  "Item Name": string;
  Category: string;
  Supplier: string;
  "Supplier Email": string;
  "Unit Cost": number;
  "On Hand": number;
  Allocated: number;
  "On Order": number;
  "Avg Daily Usage": number;
  "Lead Time Days": number;
  "Safety Stock Days": number;
  "Review Period Days": number;
  "Min Order Qty": number;
  "Pack Size": number;
  Discontinued: boolean;
};

export type Record_<T> = { id: string; createdTime: string; fields: T };
export type Item = Record_<ItemFields>;

export type PurchaseOrderFields = {
  "PO Number": string;
  Supplier: string;
  "Supplier Email": string;
  Status: "Open" | "Received";
  "Ordered On": string;
  "Expected On": string;
  "Line Count": number;
  "Total Cost": number;
  "Raised By": string;
  "Run Id": string;
};
export type PurchaseOrder = Record_<PurchaseOrderFields>;

export type PoLineFields = {
  "PO Number": string;
  SKU: string;
  "Item Name": string;
  Quantity: number;
  "Unit Cost": number;
  "Line Cost": number;
  Status: "Open" | "Received";
  Reason: string;
};
export type PoLine = Record_<PoLineFields>;

export type Db = {
  seededAt: string;
  lastCheckedAt: string;
  nextPoSeq: number;
  items: Item[];
  purchaseOrders: PurchaseOrder[];
  poLines: PoLine[];
};

const DAY_MS = 86_400_000;

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

export function daysAhead(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/** Stable per-SKU-per-day jitter, so re-running the same day never re-consumes stock differently. */
export function jitter(seed: string, spread = 0.3): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 1 - spread + ((h >>> 0) % 1000) / 1000 * spread * 2;
}

export async function readDb(): Promise<Db | null> {
  const file = Bun.file(DB_PATH);
  if (!(await file.exists())) return null;
  return (await file.json()) as Db;
}

export async function writeDb(db: Db): Promise<void> {
  await mkdir(DB_DIR, { recursive: true });
  await Bun.write(DB_PATH, JSON.stringify(db, null, 2));
}

type SupplierDefaults = {
  email: string;
  leadTimeDays: number;
  safetyStockDays: number;
  reviewPeriodDays: number;
};

const SUPPLIERS: Record<string, SupplierDefaults> = {
  "Northwind Components": { email: "orders@northwind-components.example", leadTimeDays: 14, safetyStockDays: 7, reviewPeriodDays: 7 },
  "Pacific Fasteners": { email: "purchasing@pacific-fasteners.example", leadTimeDays: 21, safetyStockDays: 10, reviewPeriodDays: 7 },
  "Vertex Polymers": { email: "sales@vertex-polymers.example", leadTimeDays: 10, safetyStockDays: 5, reviewPeriodDays: 7 },
  "Ridgeline Packaging": { email: "orders@ridgeline-packaging.example", leadTimeDays: 7, safetyStockDays: 4, reviewPeriodDays: 7 },
  "Cobalt Electronics": { email: "supply@cobalt-electronics.example", leadTimeDays: 28, safetyStockDays: 14, reviewPeriodDays: 7 },
};

type SeedRow = [
  sku: string,
  name: string,
  category: string,
  supplier: keyof typeof SUPPLIERS,
  unitCost: number,
  onHand: number,
  allocated: number,
  onOrder: number,
  usage: number,
  packSize: number,
  minOrderQty: number,
  discontinued?: boolean,
];

const SEED_ROWS: SeedRow[] = [
  ["NW-1001", "Hex Bolt M8x40 Zinc", "Fasteners", "Northwind Components", 0.42, 6200, 600, 0, 210, 500, 1000],
  ["NW-1002", "Flange Nut M8", "Fasteners", "Northwind Components", 0.18, 3400, 250, 0, 190, 500, 1000],
  ["NW-1140", "Bearing Housing 40mm", "Machined Parts", "Northwind Components", 18.75, 260, 40, 0, 12, 20, 40],
  ["NW-1205", "Drive Belt 1200mm", "Power Transmission", "Northwind Components", 34.9, 38, 12, 0, 4.5, 10, 20],
  ["PF-2010", "Stainless Washer M8", "Fasteners", "Pacific Fasteners", 0.09, 6800, 900, 2000, 240, 1000, 2000],
  ["PF-2044", "Socket Cap Screw M6x25", "Fasteners", "Pacific Fasteners", 0.31, 2600, 300, 0, 95, 500, 1000],
  ["PF-2099", "Threaded Rod M10 1m", "Fasteners", "Pacific Fasteners", 6.4, 90, 20, 0, 6, 10, 20],
  ["VP-3001", "Nitrile O-Ring 25mm", "Seals", "Vertex Polymers", 0.22, 3400, 400, 0, 160, 500, 1000],
  ["VP-3018", "PTFE Gasket Sheet A4", "Seals", "Vertex Polymers", 4.15, 180, 30, 0, 14, 25, 50],
  ["VP-3077", "Polyurethane Roller 80mm", "Wear Parts", "Vertex Polymers", 22.5, 26, 8, 0, 3.2, 5, 10],
  ["VP-3090", "Legacy Seal Kit R2", "Seals", "Vertex Polymers", 9.8, 40, 0, 0, 0.5, 10, 20, true],
  ["RP-4002", "Corrugated Carton 400x300x200", "Packaging", "Ridgeline Packaging", 0.86, 1200, 200, 0, 320, 200, 400],
  ["RP-4015", "Pallet Wrap 500mm", "Packaging", "Ridgeline Packaging", 8.2, 46, 6, 0, 5.5, 6, 12],
  ["RP-4031", "Void Fill Paper Roll", "Packaging", "Ridgeline Packaging", 14.0, 28, 4, 0, 2.8, 4, 8],
  ["CE-5001", "24V PSU 120W DIN", "Electrical", "Cobalt Electronics", 42.0, 320, 20, 0, 3.5, 10, 20],
  ["CE-5022", "Proximity Sensor M12 PNP", "Electrical", "Cobalt Electronics", 29.6, 90, 15, 0, 2.1, 5, 10],
  ["CE-5040", "Terminal Block 12-way", "Electrical", "Cobalt Electronics", 3.85, 310, 40, 0, 9.5, 50, 100],
  ["CE-5111", "Control Relay 24VDC", "Electrical", "Cobalt Electronics", 11.25, 150, 25, 0, 4.0, 25, 50],
  ["CE-5199", "HMI Panel 7in", "Electrical", "Cobalt Electronics", 315.0, 6, 2, 0, 0.25, 1, 2],
];

export function seed(): Db {
  const createdTime = daysAgo(420);
  const items: Item[] = SEED_ROWS.map((row, i) => {
    const [sku, name, category, supplier, unitCost, onHand, allocated, onOrder, usage, packSize, minOrderQty, discontinued] = row;
    const s = SUPPLIERS[supplier];
    return {
      id: `recINV${String(i + 1).padStart(5, "0")}`,
      createdTime,
      fields: {
        SKU: sku,
        "Item Name": name,
        Category: category,
        Supplier: supplier,
        "Supplier Email": s.email,
        "Unit Cost": unitCost,
        "On Hand": onHand,
        Allocated: allocated,
        "On Order": onOrder,
        "Avg Daily Usage": usage,
        "Lead Time Days": s.leadTimeDays,
        "Safety Stock Days": s.safetyStockDays,
        "Review Period Days": s.reviewPeriodDays,
        "Min Order Qty": minOrderQty,
        "Pack Size": packSize,
        Discontinued: discontinued ?? false,
      },
    };
  });

  // One PO already in flight, so the on-order netting and the receiving path both
  // exercise on a fresh base rather than only after the workflow has run twice.
  const inFlight: PurchaseOrder = {
    id: "recPO000001",
    createdTime: daysAgo(16),
    fields: {
      "PO Number": "PO-20260804-PF",
      Supplier: "Pacific Fasteners",
      "Supplier Email": SUPPLIERS["Pacific Fasteners"].email,
      Status: "Open",
      "Ordered On": daysAgo(16),
      "Expected On": daysAhead(5),
      "Line Count": 1,
      "Total Cost": 180,
      "Raised By": "Inventory Reorder Monitor",
      "Run Id": "seed",
    },
  };
  const inFlightLine: PoLine = {
    id: "recPOL000001",
    createdTime: daysAgo(16),
    fields: {
      "PO Number": inFlight.fields["PO Number"],
      SKU: "PF-2010",
      "Item Name": "Stainless Washer M8",
      Quantity: 2000,
      "Unit Cost": 0.09,
      "Line Cost": 180,
      Status: "Open",
      Reason: "Below reorder point",
    },
  };

  return {
    seededAt: new Date().toISOString(),
    lastCheckedAt: daysAgo(1),
    nextPoSeq: 2,
    items,
    purchaseOrders: [inFlight],
    poLines: [inFlightLine],
  };
}
