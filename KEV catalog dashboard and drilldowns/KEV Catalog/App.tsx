import { useEffect, useMemo, useState, type ReactNode } from 'react';

declare global {
  interface Window { __API_BASE__: string }
}

type Vuln = {
  cveId: string; vendor: string; product: string; name: string; dateAdded: string;
  description: string; requiredAction: string; dueDate: string; ransomware: 'Yes' | 'No';
  notes: string; cwes: string[]; source?: 'CISA KEV' | 'NVD'; cvss?: number; severity?: string; aiRationale?: string;
};
type CatalogResponse = {
  meta: { title: string; catalogVersion: string; dateReleased: string; syncedAt: string; source: string; today: string; total: number; kevCount?: number; watchlistCount?: number };
  vulnerabilities: Vuln[];
};
type Metrics = {
  meta: { today: string; dueSoonDays: number };
  totals: { vulnerabilities: number; addedLast30Days: number; ransomwareLinked: number; overdue: number; dueSoon: number; onTrack: number; vendors: number; products: number; watchlist?: number };
  topVendors: { vendor: string; count: number }[];
  topProducts: { vendor: string; product: string; count: number }[];
  addedByMonth: { month: string; count: number }[];
};
type Status = 'overdue' | 'due_soon' | 'on_track';
type View = 'dashboard' | 'catalog' | 'vendors' | 'products' | 'ransomware' | 'remediation';
type Filter = { q?: string; vendor?: string; product?: string; ransomware?: boolean; status?: Status; recent?: boolean; source?: 'kev' | 'watchlist' };
const isWatch = (v: Vuln) => v.source === 'NVD';
type Route = { view: View; filter: Filter; cve?: string };

const VIEWS: View[] = ['dashboard', 'catalog', 'vendors', 'products', 'ransomware', 'remediation'];

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function statusOf(due: string, today: string): Status {
  if (due < today) return 'overdue';
  if (due <= addDays(today, 14)) return 'due_soon';
  return 'on_track';
}
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
function fmtDate(iso: string) {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
const nf = new Intl.NumberFormat('en-US');

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const view = (VIEWS.includes(path as View) ? path : 'dashboard') as View;
  const p = new URLSearchParams(qs);
  const filter: Filter = {};
  if (p.get('q')) filter.q = p.get('q')!;
  if (p.get('vendor')) filter.vendor = p.get('vendor')!;
  if (p.get('product')) filter.product = p.get('product')!;
  if (p.get('ransomware') === '1') filter.ransomware = true;
  const s = p.get('status');
  if (s === 'overdue' || s === 'due_soon' || s === 'on_track') filter.status = s;
  if (p.get('recent') === '1') filter.recent = true;
  const src = p.get('source');
  if (src === 'kev' || src === 'watchlist') filter.source = src;
  return { view, filter, cve: p.get('cve') ?? undefined };
}
function buildHash(r: Route) {
  const p = new URLSearchParams();
  const f = r.filter;
  if (f.q) p.set('q', f.q);
  if (f.vendor) p.set('vendor', f.vendor);
  if (f.product) p.set('product', f.product);
  if (f.ransomware) p.set('ransomware', '1');
  if (f.status) p.set('status', f.status);
  if (f.recent) p.set('recent', '1');
  if (f.source) p.set('source', f.source);
  if (r.cve) p.set('cve', r.cve);
  const qs = p.toString();
  return `#/${r.view}${qs ? `?${qs}` : ''}`;
}

function applyFilter(rows: Vuln[], f: Filter, today: string) {
  const since = addDays(today, -30);
  const q = f.q?.toLowerCase().trim();
  return rows.filter((v) => {
    if (f.vendor && v.vendor !== f.vendor) return false;
    if (f.product && v.product !== f.product) return false;
    if (f.ransomware && v.ransomware !== 'Yes') return false;
    if (f.status && statusOf(v.dueDate, today) !== f.status) return false;
    if (f.recent && v.dateAdded < since) return false;
    if (f.source === 'kev' && isWatch(v)) return false;
    if (f.source === 'watchlist' && !isWatch(v)) return false;
    if (q && !`${v.cveId} ${v.vendor} ${v.product} ${v.name} ${v.description}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

const STATUS_META: Record<Status, { label: string; badge: string; dot: string; text: string }> = {
  overdue: { label: 'Overdue', badge: 'bg-red-500/10 text-red-300 ring-red-500/30', dot: 'bg-red-500', text: 'text-red-400' },
  due_soon: { label: 'Due soon', badge: 'bg-amber-500/10 text-amber-300 ring-amber-500/30', dot: 'bg-amber-400', text: 'text-amber-400' },
  on_track: { label: 'On track', badge: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30', dot: 'bg-emerald-400', text: 'text-emerald-400' },
};

function Icon({ d, className = 'h-4 w-4' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  );
}
const ICONS: Record<View, string> = {
  dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  catalog: 'M4 6h16M4 12h16M4 18h16',
  vendors: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  products: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8',
  ransomware: 'M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7zM12 9v4M12 16h.01',
  remediation: 'M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};
const LABELS: Record<View, string> = {
  dashboard: 'Dashboard', catalog: 'Full Catalog', vendors: 'By Vendor', products: 'By Product',
  ransomware: 'Ransomware-Linked', remediation: 'Remediation Status',
};

function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label}
    </span>
  );
}
function RansomBadge({ value }: { value: 'Yes' | 'No' }) {
  return value === 'Yes'
    ? <span className="inline-flex rounded px-1.5 py-0.5 text-xs font-semibold bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30">Yes</span>
    : <span className="text-xs text-slate-500">No</span>;
}

function WatchBadge({ v }: { v: Vuln }) {
  if (!isWatch(v)) return null;
  return (
    <span title="Recently published in NVD, not yet in CISA KEV" className="ml-2 inline-flex rounded px-1.5 py-0.5 align-middle font-sans text-[10px] font-semibold uppercase tracking-wide bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-500/30">
      New · NVD
    </span>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-800 bg-slate-900/60 ${className}`}>{children}</div>;
}

function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function MetricCard({ label, value, hint, accent, onClick }: { label: string; value: number; hint: string; accent: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group text-left rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-slate-600 hover:bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</span>
        <span className={`h-2 w-2 rounded-full ${accent}`} />
      </div>
      <div className="mt-3 font-mono text-3xl font-semibold text-slate-100">{nf.format(value)}</div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>{hint}</span>
        <span className="text-cyan-400 opacity-0 transition group-hover:opacity-100">View →</span>
      </div>
    </button>
  );
}

function BarList({ items, onPick, color = 'bg-cyan-500' }: { items: { label: string; sub?: string; count: number }[]; onPick: (i: number) => void; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={`${it.label}-${it.sub ?? ''}`}>
          <button onClick={() => onPick(i)} className="group w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-800/70">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-slate-200 group-hover:text-white">
                {it.label}{it.sub && <span className="ml-1.5 text-xs text-slate-500">{it.sub}</span>}
              </span>
              <span className="font-mono text-xs text-slate-400">{nf.format(it.count)}</span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800">
              <div className={`h-1.5 rounded-full ${color} transition-all group-hover:brightness-125`} style={{ width: `${(it.count / max) * 100}%` }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MonthChart({ data }: { data: { month: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-40 items-end gap-1.5">
      {data.map((d) => (
        <div key={d.month} className="group flex flex-1 flex-col items-center gap-1">
          <span className="font-mono text-[10px] text-slate-500 opacity-0 group-hover:opacity-100">{d.count}</span>
          <div className="w-full rounded-t bg-cyan-500/70 group-hover:bg-cyan-400" style={{ height: `${Math.max(2, (d.count / max) * 120)}px` }} />
          <span className="text-[10px] text-slate-500">{new Date(`${d.month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</span>
        </div>
      ))}
    </div>
  );
}

type SortKey = 'cveId' | 'vendor' | 'product' | 'name' | 'dateAdded' | 'dueDate' | 'ransomware';

function VulnTable({ rows, today, onSelect, initialSort = 'dateAdded', search = true, query, onQuery }: {
  rows: Vuln[]; today: string; onSelect: (cve: string) => void; initialSort?: SortKey; search?: boolean;
  query?: string; onQuery?: (q: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: initialSort, dir: initialSort === 'dueDate' ? 1 : -1 });
  const [page, setPage] = useState(0);
  const [localQ, setLocalQ] = useState('');
  const q = query ?? localQ;
  const setQ = onQuery ?? setLocalQ;
  const pageSize = 25;

  const filtered = useMemo(() => {
    const term = q.toLowerCase().trim();
    const base = term && !onQuery
      ? rows.filter((v) => `${v.cveId} ${v.vendor} ${v.product} ${v.name} ${v.description}`.toLowerCase().includes(term))
      : rows;
    return [...base].sort((a, b) => {
      const c = String(a[sort.key]).localeCompare(String(b[sort.key]), undefined, { numeric: true, sensitivity: 'base' });
      return c * sort.dir || b.dateAdded.localeCompare(a.dateAdded);
    });
  }, [rows, q, sort, onQuery]);

  useEffect(() => setPage(0), [rows, q, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const th = (key: SortKey, label: string, cls = '') => (
    <th className={`px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-400 ${cls}`}>
      <button className="inline-flex items-center gap-1 hover:text-slate-200" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'dateAdded' || key === 'ransomware' ? -1 : 1 }))}>
        {label}
        <span className={sort.key === key ? 'text-cyan-400' : 'text-slate-700'}>{sort.key === key && sort.dir === 1 ? '▲' : '▼'}</span>
      </button>
    </th>
  );

  return (
    <Card className="overflow-hidden">
      {search && (
        <div className="flex flex-col gap-2 border-b border-slate-800 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Icon d="M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search CVE, vendor, product, description…"
              className="w-full rounded-md border border-slate-700 bg-slate-950 py-2 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none" />
          </div>
          <span className="text-xs text-slate-400"><span className="font-mono text-slate-200">{nf.format(filtered.length)}</span> entries</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-800">
          <thead className="bg-slate-900">
            <tr>
              {th('cveId', 'CVE ID')}
              {th('vendor', 'Vendor')}
              {th('product', 'Product', 'hidden md:table-cell')}
              {th('name', 'Vulnerability', 'hidden lg:table-cell')}
              {th('dateAdded', 'Added')}
              {th('dueDate', 'Due')}
              <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-400 hidden sm:table-cell">Status</th>
              {th('ransomware', 'Ransomware')}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {visible.map((v) => (
              <tr key={v.cveId} onClick={() => onSelect(v.cveId)} className="cursor-pointer hover:bg-slate-800/50">
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-sm text-cyan-300">{v.cveId}<WatchBadge v={v} /></td>
                <td className="max-w-[10rem] truncate px-3 py-2.5 text-sm text-slate-200">{v.vendor}</td>
                <td className="hidden max-w-[12rem] truncate px-3 py-2.5 text-sm text-slate-300 md:table-cell">{v.product}</td>
                <td className="hidden max-w-md truncate px-3 py-2.5 text-sm text-slate-400 lg:table-cell">{v.name}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-400">{v.dateAdded}</td>
                <td className={`whitespace-nowrap px-3 py-2.5 font-mono text-xs ${STATUS_META[statusOf(v.dueDate, today)].text}`}>{v.dueDate}</td>
                <td className="hidden px-3 py-2.5 sm:table-cell"><StatusBadge status={statusOf(v.dueDate, today)} /></td>
                <td className="px-3 py-2.5"><RansomBadge value={v.ransomware} /></td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-sm text-slate-500">No vulnerabilities match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-800 px-3 py-2 text-xs text-slate-400">
          <span>Page {page + 1} of {pages}</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-700 px-2.5 py-1 hover:bg-slate-800 disabled:opacity-40">Prev</button>
            <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-700 px-2.5 py-1 hover:bg-slate-800 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DetailPanel({ v, today, onClose, onFilter }: { v: Vuln; today: string; onClose: () => void; onFilter: (f: Filter) => void }) {
  const status = statusOf(v.dueDate, today);
  const delta = daysBetween(today, v.dueDate);
  const links = v.notes.split(';').map((s) => s.trim()).map((s) => {
    const m = s.match(/^(.*?):?\s*(https?:\/\/\S+)$/);
    return m ? { label: m[1]?.trim() || new URL(m[2]).hostname, url: m[2] } : null;
  }).filter((x): x is { label: string; url: string } => !!x);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const Field = ({ label, children }: { label: string; children: ReactNode }) => (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-200">{children}</dd>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 p-5">
          <div className="min-w-0">
            <div className="font-mono text-lg font-semibold text-cyan-300">{v.cveId}</div>
            <h2 className="mt-1 text-sm text-slate-300">{v.name}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge status={status} />
              {isWatch(v) && <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-500/30">NVD watchlist · not yet in KEV</span>}
              {v.cvss !== undefined && <span className="rounded-full px-2 py-0.5 font-mono text-xs bg-slate-800 text-slate-200">CVSS {v.cvss.toFixed(1)} {v.severity}</span>}
              {v.ransomware === 'Yes' && <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-500/30">Known ransomware use</span>}
              {v.cwes.map((c) => <span key={c} className="rounded-full px-2 py-0.5 font-mono text-xs bg-slate-800 text-slate-300">{c}</span>)}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100">
            <Icon d="M6 6l12 12M18 6L6 18" className="h-5 w-5" />
          </button>
        </div>
        <dl className="flex-1 space-y-5 overflow-y-auto p-5">
          {isWatch(v) && (
            <div className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-3 text-xs leading-relaxed text-violet-200">
              Published to NVD on {fmtDate(v.dateAdded)} and not yet in CISA KEV, so it isn't confirmed as exploited. AI triage pulled the vendor, product, name, and required action from the NVD record. The due date is a suggested 21-day target.
              {v.aiRationale && <div className="mt-2 text-slate-300"><span className="font-semibold text-violet-300">Why it matters: </span>{v.aiRationale}</div>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Vendor / Project">
              <button className="text-left text-cyan-300 hover:underline" onClick={() => onFilter({ vendor: v.vendor })}>{v.vendor}</button>
            </Field>
            <Field label="Product">
              <button className="text-left text-cyan-300 hover:underline" onClick={() => onFilter({ vendor: v.vendor, product: v.product })}>{v.product}</button>
            </Field>
            <Field label="Date added"><span className="font-mono">{fmtDate(v.dateAdded)}</span></Field>
            <Field label="Remediation due">
              <span className={`font-mono ${STATUS_META[status].text}`}>{fmtDate(v.dueDate)}</span>
              <div className="text-xs text-slate-500">{delta < 0 ? `${nf.format(-delta)} days overdue` : delta === 0 ? 'Due today' : `${delta} days remaining`}</div>
            </Field>
            <Field label="Known ransomware use"><RansomBadge value={v.ransomware} /></Field>
          </div>
          <Field label="Short description"><p className="leading-relaxed text-slate-300">{v.description}</p></Field>
          <Field label="Required action">
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 leading-relaxed text-slate-200">{v.requiredAction}</p>
          </Field>
          <Field label="References">
            <ul className="space-y-1.5">
              <li><a className="break-all text-cyan-300 hover:underline" href={`https://nvd.nist.gov/vuln/detail/${v.cveId}`} target="_blank" rel="noreferrer">NVD — {v.cveId}</a></li>
              {links.filter((l) => !l.url.includes('nvd.nist.gov')).map((l) => (
                <li key={l.url}><a className="break-all text-cyan-300 hover:underline" href={l.url} target="_blank" rel="noreferrer">{l.label === new URL(l.url).hostname ? l.url : `${l.label}`}</a></li>
              ))}
            </ul>
          </Field>
        </dl>
      </aside>
    </div>
  );
}

function FilterChips({ filter, onChange }: { filter: Filter; onChange: (f: Filter) => void }) {
  const chips: { key: keyof Filter; label: string }[] = [];
  if (filter.vendor) chips.push({ key: 'vendor', label: `Vendor: ${filter.vendor}` });
  if (filter.product) chips.push({ key: 'product', label: `Product: ${filter.product}` });
  if (filter.ransomware) chips.push({ key: 'ransomware', label: 'Known ransomware use' });
  if (filter.status) chips.push({ key: 'status', label: `Status: ${STATUS_META[filter.status].label}` });
  if (filter.recent) chips.push({ key: 'recent', label: 'Added in last 30 days' });
  if (filter.source) chips.push({ key: 'source', label: filter.source === 'watchlist' ? 'NVD watchlist only' : 'CISA KEV only' });
  if (!chips.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-slate-500">Filters</span>
      {chips.map((c) => (
        <button key={c.key} onClick={() => { const f = { ...filter }; delete f[c.key]; onChange(f); }}
          className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20">
          {c.label}<Icon d="M6 6l12 12M18 6L6 18" className="h-3 w-3" />
        </button>
      ))}
      <button onClick={() => onChange(filter.q ? { q: filter.q } : {})} className="text-xs text-slate-400 hover:text-slate-200">Clear all</button>
    </div>
  );
}

function GroupView({ kind, rows, today, onPick }: { kind: 'vendor' | 'product'; rows: Vuln[]; today: string; onPick: (f: Filter) => void }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'count' | 'name' | 'overdue' | 'ransomware'>('count');
  const groups = useMemo(() => {
    const map = new Map<string, { vendor: string; product?: string; count: number; ransomware: number; overdue: number; dueSoon: number; latest: string }>();
    for (const v of rows) {
      const key = kind === 'vendor' ? v.vendor : `${v.vendor}\u0000${v.product}`;
      const g = map.get(key) ?? { vendor: v.vendor, product: kind === 'product' ? v.product : undefined, count: 0, ransomware: 0, overdue: 0, dueSoon: 0, latest: '' };
      g.count++;
      if (v.ransomware === 'Yes') g.ransomware++;
      const s = statusOf(v.dueDate, today);
      if (s === 'overdue') g.overdue++;
      if (s === 'due_soon') g.dueSoon++;
      if (v.dateAdded > g.latest) g.latest = v.dateAdded;
      map.set(key, g);
    }
    const term = q.toLowerCase().trim();
    return [...map.values()]
      .filter((g) => !term || `${g.vendor} ${g.product ?? ''}`.toLowerCase().includes(term))
      .sort((a, b) =>
        sort === 'name' ? (a.product ?? a.vendor).localeCompare(b.product ?? b.vendor)
          : sort === 'overdue' ? b.dueSoon - a.dueSoon || b.overdue - a.overdue
          : sort === 'ransomware' ? b.ransomware - a.ransomware || b.count - a.count
          : b.count - a.count);
  }, [rows, kind, q, sort, today]);
  const [limit, setLimit] = useState(60);
  useEffect(() => setLimit(60), [q, sort]);
  const max = Math.max(1, ...groups.map((g) => g.count));

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${kind === 'vendor' ? 'vendors' : 'products'}…`}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none sm:max-w-xs" />
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1 text-xs">
          {([['count', 'Most CVEs'], ['ransomware', 'Ransomware'], ['overdue', 'Due soon'], ['name', 'A–Z']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)} className={`rounded-md px-2.5 py-1 ${sort === k ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups.slice(0, limit).map((g) => (
          <button key={`${g.vendor}-${g.product ?? ''}`} onClick={() => onPick(kind === 'vendor' ? { vendor: g.vendor } : { vendor: g.vendor, product: g.product })}
            className="group rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left transition hover:border-cyan-500/50 hover:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-100">{kind === 'vendor' ? g.vendor : g.product}</div>
                {kind === 'product' && <div className="truncate text-xs text-slate-500">{g.vendor}</div>}
              </div>
              <span className="font-mono text-2xl font-semibold text-slate-100">{g.count}</span>
            </div>
            <div className="mt-3 h-1 w-full rounded-full bg-slate-800">
              <div className="h-1 rounded-full bg-cyan-500" style={{ width: `${(g.count / max) * 100}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
              {g.ransomware > 0 && <span className="text-rose-300">{g.ransomware} ransomware</span>}
              {g.dueSoon > 0 && <span className="text-amber-300">{g.dueSoon} due soon</span>}
              <span>Latest {g.latest}</span>
            </div>
          </button>
        ))}
      </div>
      {groups.length > limit && (
        <div className="mt-4 text-center">
          <button onClick={() => setLimit((l) => l + 60)} className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
            Show more ({nf.format(groups.length - limit)} remaining)
          </button>
        </div>
      )}
      {groups.length === 0 && <p className="py-12 text-center text-sm text-slate-500">No matches.</p>}
    </>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [remTab, setRemTab] = useState<Status>('due_soon');

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const get = async <T,>(path: string): Promise<T> => {
      const res = await fetch(`${window.__API_BASE__}${path}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
      return res.json();
    };
    Promise.all([get<CatalogResponse>('/catalog'), get<Metrics>('/metrics?top=10')])
      .then(([c, m]) => { setCatalog(c); setMetrics(m); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const go = (r: Partial<Route>) => {
    const next = { view: route.view, filter: route.filter, ...r };
    window.location.hash = buildHash(next);
    setNavOpen(false);
    if (r.view && r.view !== route.view) window.scrollTo({ top: 0 });
  };
  const toCatalog = (filter: Filter) => go({ view: 'catalog', filter, cve: undefined });

  const today = catalog?.meta.today ?? new Date().toISOString().slice(0, 10);
  const all = catalog?.vulnerabilities ?? [];
  const selected = route.cve ? all.find((v) => v.cveId === route.cve) : undefined;
  const catalogRows = useMemo(() => applyFilter(all, route.filter, today), [all, route.filter, today]);
  const ransomRows = useMemo(() => all.filter((v) => v.ransomware === 'Yes'), [all]);
  const byStatus = useMemo(() => {
    const out: Record<Status, Vuln[]> = { overdue: [], due_soon: [], on_track: [] };
    for (const v of all) out[statusOf(v.dueDate, today)].push(v);
    return out;
  }, [all, today]);
  const ransomVendors = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of ransomRows) m.set(v.vendor, (m.get(v.vendor) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [ransomRows]);

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/30">
          <Icon d={ICONS.ransomware} className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-100">KEV Catalog</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Known Exploited Vulns</div>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {VIEWS.map((v) => {
          const active = route.view === v;
          const count = v === 'catalog' ? all.length : v === 'ransomware' ? ransomRows.length : v === 'remediation' ? byStatus.due_soon.length : undefined;
          return (
            <li key={v}>
              <button onClick={() => go({ view: v, filter: {}, cve: undefined })}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'}`}>
                <Icon d={ICONS[v]} className={`h-4 w-4 ${active ? 'text-cyan-400' : ''}`} />
                <span className="flex-1 text-left">{LABELS[v]}</span>
                {count !== undefined && catalog && (
                  <span className={`rounded px-1.5 font-mono text-[11px] ${v === 'remediation' ? 'bg-amber-500/15 text-amber-300' : v === 'ransomware' ? 'bg-rose-500/15 text-rose-300' : 'bg-slate-800 text-slate-400'}`}>{nf.format(count)}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {catalog && (
        <div className="m-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-[11px] leading-relaxed text-slate-500">
          <div className="flex items-center gap-1.5 text-slate-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />CISA feed v{catalog.meta.catalogVersion}</div>
          <div>Released {fmtDate(catalog.meta.dateReleased)}</div>
          <div>Synced {new Date(catalog.meta.syncedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          {!!catalog.meta.watchlistCount && <div className="mt-1 text-violet-300/80">+{catalog.meta.watchlistCount} NVD watchlist CVEs</div>}
        </div>
      )}
    </nav>
  );

  let content: ReactNode;
  if (error) {
    content = (
      <Card className="p-8 text-center">
        <div className="text-red-400">Failed to load catalog data</div>
        <div className="mt-2 font-mono text-xs text-slate-500">{error}</div>
      </Card>
    );
  } else if (!catalog || !metrics) {
    content = (
      <div className="space-y-4">
        <div className="h-7 w-48 animate-pulse rounded bg-slate-800" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[...Array(5)].map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-900" />)}</div>
        <div className="h-72 animate-pulse rounded-xl bg-slate-900" />
      </div>
    );
  } else if (route.view === 'dashboard') {
    const t = metrics.totals;
    const recent = all.filter((v) => !isWatch(v)).slice(0, 8);
    const watch = all.filter(isWatch).sort((a, b) => (b.cvss ?? 0) - (a.cvss ?? 0) || b.dateAdded.localeCompare(a.dateAdded));
    content = (
      <>
        <PageHeader title="Dashboard" subtitle={`Rollup of ${nf.format(t.vulnerabilities)} actively exploited vulnerabilities across ${nf.format(t.vendors)} vendors and ${nf.format(t.products)} products${watch.length ? `, plus ${watch.length} newly published CVEs on the watchlist` : ''}.`} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Total tracked" value={t.vulnerabilities} hint="CISA KEV entries" accent="bg-cyan-400" onClick={() => toCatalog({ source: 'kev' })} />
          <MetricCard label="Added · 30 days" value={t.addedLast30Days} hint={`Since ${fmtDate(addDays(today, -30))}`} accent="bg-sky-400" onClick={() => toCatalog({ recent: true, source: 'kev' })} />
          <MetricCard label="Ransomware-linked" value={t.ransomwareLinked} hint={`${((t.ransomwareLinked / t.vulnerabilities) * 100).toFixed(1)}% of catalog`} accent="bg-rose-500" onClick={() => toCatalog({ ransomware: true })} />
          <MetricCard label="Overdue" value={t.overdue} hint="Past remediation date" accent="bg-red-500" onClick={() => toCatalog({ status: 'overdue' })} />
          <MetricCard label="Due soon" value={t.dueSoon} hint={`Within ${metrics.meta.dueSoonDays} days`} accent="bg-amber-400" onClick={() => toCatalog({ status: 'due_soon', source: 'kev' })} />
          <MetricCard label="New · NVD watch" value={watch.length} hint="Last few days, not in KEV" accent="bg-violet-400" onClick={() => toCatalog({ source: 'watchlist' })} />
        </div>
        {watch.length > 0 && (
          <Card className="mt-4 overflow-hidden border-violet-500/20">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Newly published CVEs to watch</h2>
                <p className="text-xs text-slate-500">High-impact NVD CVEs from the last few days, picked by AI triage. Not yet confirmed as exploited.</p>
              </div>
              <button onClick={() => toCatalog({ source: 'watchlist' })} className="shrink-0 text-xs text-violet-300 hover:underline">All {watch.length} →</button>
            </div>
            <ul className="grid divide-y divide-slate-800/70 md:grid-cols-2 md:divide-y-0">
              {watch.slice(0, 8).map((v) => (
                <li key={v.cveId} className="md:border-b md:border-slate-800/70 md:odd:border-r">
                  <button onClick={() => go({ cve: v.cveId })} className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-800/50">
                    <span className={`mt-0.5 w-10 shrink-0 rounded py-0.5 text-center font-mono text-xs font-semibold ${(v.cvss ?? 0) >= 9 ? 'bg-red-500/15 text-red-300' : 'bg-orange-500/15 text-orange-300'}`}>{v.cvss?.toFixed(1)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-sm text-cyan-300">{v.cveId}</span>
                      <span className="block truncate text-sm text-slate-300">{v.vendor} · {v.product}</span>
                      {v.aiRationale && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{v.aiRationale}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div className="mt-4 grid gap-4 lg:grid-cols-5">
          <Card className="p-5 lg:col-span-3">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Top vendors by vulnerability count</h2>
              <button onClick={() => go({ view: 'vendors', filter: {} })} className="text-xs text-cyan-400 hover:underline">All vendors →</button>
            </div>
            <BarList items={metrics.topVendors.map((v) => ({ label: v.vendor, count: v.count }))} onPick={(i) => toCatalog({ vendor: metrics.topVendors[i].vendor })} />
          </Card>
          <div className="flex flex-col gap-4 lg:col-span-2">
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-200">Remediation posture</h2>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
                {(['overdue', 'due_soon', 'on_track'] as Status[]).map((s) => {
                  const n = s === 'overdue' ? t.overdue : s === 'due_soon' ? t.dueSoon : t.onTrack;
                  return <div key={s} className={STATUS_META[s].dot} style={{ width: `${(n / t.vulnerabilities) * 100}%`, minWidth: n ? 4 : 0 }} />;
                })}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {(['overdue', 'due_soon', 'on_track'] as Status[]).map((s) => {
                  const n = s === 'overdue' ? t.overdue : s === 'due_soon' ? t.dueSoon : t.onTrack;
                  return (
                    <button key={s} onClick={() => toCatalog({ status: s })} className="rounded-lg border border-slate-800 p-2.5 text-left hover:border-slate-600">
                      <div className={`font-mono text-lg font-semibold ${STATUS_META[s].text}`}>{nf.format(n)}</div>
                      <div className="text-[11px] text-slate-400">{STATUS_META[s].label}</div>
                    </button>
                  );
                })}
              </div>
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-200">Additions per month</h2>
              <MonthChart data={metrics.addedByMonth} />
            </Card>
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-5">
          <Card className="overflow-hidden lg:col-span-3">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-200">Latest additions</h2>
              <button onClick={() => toCatalog({ recent: true })} className="text-xs text-cyan-400 hover:underline">Last 30 days →</button>
            </div>
            <ul className="divide-y divide-slate-800/70">
              {recent.map((v) => (
                <li key={v.cveId}>
                  <button onClick={() => go({ cve: v.cveId })} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-800/50">
                    <span className="w-36 shrink-0 font-mono text-sm text-cyan-300">{v.cveId}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{v.vendor} · {v.product}</span>
                    <span className="hidden sm:block"><StatusBadge status={statusOf(v.dueDate, today)} /></span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Top products</h2>
              <button onClick={() => go({ view: 'products', filter: {} })} className="text-xs text-cyan-400 hover:underline">All products →</button>
            </div>
            <BarList color="bg-indigo-500" items={metrics.topProducts.slice(0, 6).map((p) => ({ label: p.product, sub: p.vendor, count: p.count }))}
              onPick={(i) => toCatalog({ vendor: metrics.topProducts[i].vendor, product: metrics.topProducts[i].product })} />
          </Card>
        </div>
      </>
    );
  } else if (route.view === 'catalog') {
    content = (
      <>
        <PageHeader title="Full Catalog" subtitle="Search, sort, and drill into every known exploited vulnerability. Click a row for full details." />
        <FilterChips filter={route.filter} onChange={(f) => go({ filter: f })} />
        <VulnTable rows={catalogRows} today={today} onSelect={(cve) => go({ cve })}
          query={route.filter.q ?? ''} onQuery={(q) => {
            const f = { ...route.filter, q: q || undefined };
            window.history.replaceState(null, '', buildHash({ ...route, filter: f }));
            setRoute({ ...route, filter: f });
          }} />
      </>
    );
  } else if (route.view === 'vendors' || route.view === 'products') {
    content = (
      <>
        <PageHeader title={LABELS[route.view]} subtitle={`${nf.format(route.view === 'vendors' ? metrics.totals.vendors : metrics.totals.products)} ${route.view} with at least one known exploited vulnerability. Select one to filter the catalog.`} />
        <GroupView kind={route.view === 'vendors' ? 'vendor' : 'product'} rows={all} today={today} onPick={toCatalog} />
      </>
    );
  } else if (route.view === 'ransomware') {
    content = (
      <>
        <PageHeader title="Ransomware-Linked" subtitle={`${nf.format(ransomRows.length)} vulnerabilities (${((ransomRows.length / all.length) * 100).toFixed(1)}%) are known to be used in ransomware campaigns.`} />
        <Card className="mb-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Most-affected vendors</h2>
          <div className="flex flex-wrap gap-2">
            {ransomVendors.map(([vendor, n]) => (
              <button key={vendor} onClick={() => toCatalog({ vendor, ransomware: true })}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-1.5 text-sm text-slate-200 hover:border-rose-500/50">
                {vendor}<span className="font-mono text-xs text-rose-300">{n}</span>
              </button>
            ))}
          </div>
        </Card>
        <VulnTable rows={ransomRows} today={today} onSelect={(cve) => go({ cve })} />
      </>
    );
  } else {
    content = (
      <>
        <PageHeader title="Remediation Status" subtitle={`Entries bucketed by remediation due date relative to ${fmtDate(today)}. Due soon means within the next 14 days.`} />
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {(['overdue', 'due_soon', 'on_track'] as Status[]).map((s) => (
            <button key={s} onClick={() => setRemTab(s)}
              className={`rounded-xl border p-4 text-left transition ${remTab === s ? 'border-slate-500 bg-slate-800/80' : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'}`}>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400"><span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} />{STATUS_META[s].label}</div>
              <div className={`mt-2 font-mono text-3xl font-semibold ${STATUS_META[s].text}`}>{nf.format(byStatus[s].length)}</div>
              <div className="mt-1 text-xs text-slate-500">{s === 'overdue' ? 'Due date has passed' : s === 'due_soon' ? `Due by ${fmtDate(addDays(today, 14))}` : `Due after ${fmtDate(addDays(today, 14))}`}</div>
            </button>
          ))}
        </div>
        <VulnTable key={remTab} rows={byStatus[remTab]} today={today} onSelect={(cve) => go({ cve })} initialSort={remTab === 'overdue' ? 'dateAdded' : 'dueDate'} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 antialiased">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-800 bg-slate-950 lg:block">{nav}</aside>
      {navOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/70" onClick={() => setNavOpen(false)} />
          <aside className="relative h-full w-64 border-r border-slate-800 bg-slate-950">{nav}</aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setNavOpen(true)} aria-label="Open navigation" className="rounded-md p-1.5 text-slate-300 hover:bg-slate-800">
            <Icon d="M4 6h16M4 12h16M4 18h16" className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">{LABELS[route.view]}</span>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{content}</main>
      </div>
      {selected && <DetailPanel v={selected} today={today} onClose={() => go({ cve: undefined })} onFilter={(f) => toCatalog(f)} />}
    </div>
  );
}
