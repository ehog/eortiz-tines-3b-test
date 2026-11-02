import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const BASE: string = (window as any).__ROUTE_PATH__ ?? "/ai-governance";

export type Filters = {
  team: string[];
  severity: string[];
  classification: string[];
  status: string[];
  model: string[];
  source: string[];
  q: string;
  build: string | null;
  days: number;
};

export const EMPTY: Filters = {
  team: [],
  severity: [],
  classification: [],
  status: [],
  model: [],
  source: [],
  q: "",
  build: null,
  days: 90,
};

const LISTS = ["team", "severity", "classification", "status", "model", "source"] as const;

function read(): Filters {
  const p = new URLSearchParams(window.location.search);
  const f: Filters = { ...EMPTY };
  for (const k of LISTS) {
    const v = p.get(k);
    f[k] = v ? v.split("~").filter(Boolean) : [];
  }
  f.q = p.get("q") ?? "";
  f.build = p.get("build");
  f.days = Number(p.get("days") ?? 90);
  return f;
}

function write(f: Filters, replace: boolean) {
  const p = new URLSearchParams();
  for (const k of LISTS) if (f[k].length) p.set(k, f[k].join("~"));
  if (f.q) p.set("q", f.q);
  if (f.build) p.set("build", f.build);
  if (f.days !== 90) p.set("days", String(f.days));
  const url = `${window.location.pathname}${p.toString() ? `?${p}` : ""}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

export function useFilters() {
  const [filters, setFilters] = useState<Filters>(read);

  useEffect(() => {
    const onPop = () => setFilters(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const apply = useCallback((next: Partial<Filters>, replace = false) => {
    setFilters((prev) => {
      const merged = { ...prev, ...next };
      write(merged, replace);
      return merged;
    });
  }, []);

  const toggle = useCallback(
    (key: (typeof LISTS)[number], value: string) => {
      setFilters((prev) => {
        const has = prev[key].includes(value);
        const merged = { ...prev, [key]: has ? prev[key].filter((v) => v !== value) : [...prev[key], value] };
        write(merged, false);
        return merged;
      });
    },
    [],
  );

  const clear = useCallback(() => {
    setFilters(() => {
      write(EMPTY, false);
      return { ...EMPTY };
    });
  }, []);

  const activeCount =
    LISTS.reduce((a, k) => a + filters[k].length, 0) + (filters.q ? 1 : 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear]);

  return { filters, apply, toggle, clear, activeCount };
}

export type Snapshot = any;

/** One refresh loop for the whole page; never overlapping requests. */
export function useSnapshot(intervalMs = 60_000) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/data`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`data API returned ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "request failed");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(`${BASE}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
      if (!res.ok) throw new Error(`action failed (${res.status})`);
      return res.json();
    },
    [load],
  );

  return { data, error, busy, reload: load, act };
}

export function matchesBuild(b: any, f: Filters) {
  if (f.team.length && !f.team.includes(b.team)) return false;
  if (f.classification.length && !f.classification.includes(b.classification)) return false;
  if (f.status.length) {
    const wantUnowned = f.status.includes("__unowned");
    const statuses = f.status.filter((s) => s !== "__unowned");
    if (wantUnowned && !b.unowned) return false;
    if (statuses.length && !statuses.includes(b.status)) return false;
  }
  if (f.model.length && !f.model.includes(b.model)) return false;
  if (f.source.length && !f.source.includes(b.source)) return false;
  if (f.q) {
    const hay = `${b.name} ${b.owner ?? "unowned"} ${b.team} ${b.model} ${b.type}`.toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

export function useFiltered(data: Snapshot | null, f: Filters) {
  return useMemo(() => {
    if (!data) return null;
    const builds = data.builds.filter((b: any) => matchesBuild(b, f));
    const ids = new Set(builds.map((b: any) => b.id));
    const findings = data.spillage.findings.filter(
      (x: any) => ids.has(x.build_id) && (!f.severity.length || f.severity.includes(x.severity)),
    );
    const findingIds = new Set(findings.map((x: any) => x.id));
    const suggestions = data.suggestions.filter((s: any) => findingIds.has(s.finding_id));
    const items = data.pipeline.items.filter((i: any) => {
      if (f.team.length && !f.team.includes(i.team)) return false;
      if (f.severity.length && !f.severity.includes(i.risk)) return false;
      if (i.id.startsWith("build:")) return ids.has(i.id.slice(6));
      return !f.classification.length && !f.status.length && !f.model.length && !f.source.length;
    });
    const teams = f.team.length ? f.team : null;
    const roiTeams = data.roi.by_team.filter((t: any) => !teams || teams.includes(t.team));
    const shadow = (data.shadow.entries ?? []).filter(
      (e: any) => !teams || e.top_teams.some((t: string) => teams.includes(t)),
    );
    const duplicates = data.roi.duplicates.filter((d: any) => d.builds.some((b: any) => ids.has(b.id)));
    return { builds, findings, suggestions, items, roiTeams, shadow, duplicates };
  }, [data, f]);
}
