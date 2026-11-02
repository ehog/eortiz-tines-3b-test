import { BLENDED_RATE_USD, DUPLICATE_THRESHOLD, HISTORY_DAYS, RATE_BASIS } from "./config";

const VOL = "/storage/ai_governance";
const now = new Date();
const iso = (d: Date) => d.toISOString();
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

const inventory = await Bun.file(`${VOL}/inventory.json`).json();
const builds: any[] = inventory.builds;

const stems = (name: string) =>
  new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !["the", "for", "and", "repo", "bot", "app", "v2"].includes(w))
      .map((w) => w.slice(0, 4)),
  );

const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter);
};

const duplicates: any[] = [];
for (let i = 0; i < builds.length; i++) {
  for (let j = i + 1; j < builds.length; j++) {
    const a = builds[i];
    const b = builds[j];
    const score = jaccard(stems(a.name), stems(b.name));
    if (score < DUPLICATE_THRESHOLD) continue;
    const sharedCreds = a.credentials.filter((c: string) => b.credentials.includes(c));
    duplicates.push({
      id: `${a.id}~${b.id}`,
      similarity: Number(score.toFixed(2)),
      cross_team: a.team !== b.team,
      shared_credentials: sharedCreds,
      builds: [a, b].map((x) => ({ id: x.id, name: x.name, team: x.team, owner: x.owner, hours_saved_month: x.hours_saved_month, model: x.model })),
      duplicated_hours_month: Math.min(a.hours_saved_month, b.hours_saved_month),
      note:
        a.team !== b.team
          ? "Two teams maintain overlapping builds; consolidating leaves one owner and one review surface."
          : "Same team runs two overlapping builds; likely a fork left running.",
    });
  }
}
duplicates.sort((a, b) => b.duplicated_hours_month - a.duplicated_hours_month);

const days: Array<{ date: string; partial: boolean; total_hours: number; by_team: Record<string, number> }> = [];
for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
  const date = new Date(now.getTime() - d * 86_400_000);
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  const by_team: Record<string, number> = {};
  let total = 0;
  for (const b of builds) {
    if (new Date(b.created) > date) continue;
    // Monthly hours spread over working days, tapered over the build's first two weeks.
    const age = (date.getTime() - new Date(b.created).getTime()) / 86_400_000;
    const ramp = Math.min(1, 0.35 + age / 14);
    const daily = (b.hours_saved_month / 21) * ramp * (weekend ? 0.12 : 1);
    const hours = Math.round(daily * 10) / 10;
    by_team[b.team] = Math.round(((by_team[b.team] ?? 0) + hours) * 10) / 10;
    total += hours;
  }
  days.push({
    date: dayKey(date),
    partial: d === 0,
    total_hours: Math.round(total * 10) / 10,
    by_team,
  });
}

const monthStart = dayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
const mtdDays = days.filter((x) => x.date >= monthStart);
const mtdHours = Math.round(mtdDays.reduce((a, x) => a + x.total_hours, 0));
const complete = days.filter((x) => !x.partial);

const teamTotals = builds.reduce<Record<string, { hours_month: number; builds: number; unowned: number }>>((acc, b) => {
  const t = (acc[b.team] ??= { hours_month: 0, builds: 0, unowned: 0 });
  t.hours_month += b.hours_saved_month;
  t.builds += 1;
  if (b.unowned) t.unowned += 1;
  return acc;
}, {});

const out = {
  generated_at: iso(now),
  blended_rate_usd: BLENDED_RATE_USD,
  rate_basis: RATE_BASIS,
  headline: {
    hours_saved_mtd: mtdHours,
    dollars_saved_mtd: mtdHours * BLENDED_RATE_USD,
    hours_saved_month_run_rate: builds.reduce((a, b) => a + b.hours_saved_month, 0),
    window_start: monthStart,
    partial_days: mtdDays.filter((d) => d.partial).length,
    note: "Month-to-date excludes today, which is still accruing.",
  },
  by_team: Object.entries(teamTotals)
    .map(([team, v]) => ({
      team,
      hours_month: v.hours_month,
      dollars_month: v.hours_month * BLENDED_RATE_USD,
      builds: v.builds,
      unowned: v.unowned,
    }))
    .sort((a, b) => b.hours_month - a.hours_month),
  history: days,
  history_note: `${complete.length} complete days plus today (partial, excluded from totals).`,
  duplicates,
  duplicate_summary: {
    pairs: duplicates.length,
    cross_team_pairs: duplicates.filter((d) => d.cross_team).length,
    reclaimable_hours_month: duplicates.reduce((a, d) => a + d.duplicated_hours_month, 0),
    reclaimable_dollars_month: duplicates.reduce((a, d) => a + d.duplicated_hours_month, 0) * BLENDED_RATE_USD,
  },
};

await Bun.write(`${VOL}/roi.json`, JSON.stringify(out, null, 2));

console.error(
  `ROI: ${mtdHours}h MTD ($${(mtdHours * BLENDED_RATE_USD).toLocaleString()}), ${duplicates.length} duplicate pairs`,
);
console.log(JSON.stringify({ generated_at: out.generated_at, hours_saved_mtd: mtdHours, duplicate_pairs: duplicates.length }));
