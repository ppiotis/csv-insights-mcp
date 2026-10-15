import { promises as fs, realpathSync, statSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { UserError } from "./result.js";

export type Row = Record<string, string>;
export interface Table {
  file: string;
  columns: string[];
  rows: Row[];
}

export const limits = {
  maxBytes: () => Number(process.env.CSV_INSIGHTS_MAX_BYTES ?? 50 * 1024 * 1024),
  maxRows: () => Number(process.env.CSV_INSIGHTS_MAX_ROWS ?? 500_000),
};

export function rootDir(): string {
  const root = process.env.CSV_INSIGHTS_DIR ?? process.cwd();
  try {
    return realpathSync(path.resolve(root));
  } catch {
    throw new UserError(`CSV_INSIGHTS_DIR does not exist: ${root}`);
  }
}

export function outputDir(): string {
  return path.join(rootDir(), "csv-insights-output");
}

/** Resolve a user-supplied path inside the allowlisted root. Rejects traversal and symlink escapes. */
export function resolveInRoot(p: string, opts: { mustExist?: boolean } = { mustExist: true }): string {
  if (typeof p !== "string" || p.length === 0) throw new UserError("A file path is required");
  if (p.includes("\0")) throw new UserError("Invalid path");
  const root = rootDir();
  const abs = path.resolve(root, p);
  const inside = (x: string) => x === root || x.startsWith(root + path.sep);
  if (!inside(abs)) throw new UserError(`Path is outside the allowed directory (${root})`);
  if (opts.mustExist !== false) {
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      throw new UserError(`File not found: ${p}`);
    }
    if (!inside(real)) throw new UserError("Path resolves (via symlink) outside the allowed directory");
    return real;
  }
  return abs;
}

const cache = new Map<string, { mtime: number; size: number; table: Table }>();

export async function loadTable(file: string): Promise<Table> {
  const abs = resolveInRoot(file);
  if (!/\.(csv|tsv|txt)$/i.test(abs)) throw new UserError("Only .csv, .tsv or .txt files can be loaded");
  const st = statSync(abs);
  if (!st.isFile()) throw new UserError("Not a file");
  if (st.size > limits.maxBytes()) throw new UserError(`File is ${st.size} bytes; limit is ${limits.maxBytes()} (set CSV_INSIGHTS_MAX_BYTES)`);
  const hit = cache.get(abs);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.table;
  const text = await fs.readFile(abs, "utf8");
  const table = parseCsv(text, path.relative(rootDir(), abs), /\.tsv$/i.test(abs) ? "\t" : undefined);
  cache.set(abs, { mtime: st.mtimeMs, size: st.size, table });
  return table;
}

export function parseCsv(text: string, file = "inline", delimiter?: string): Table {
  const parsed = Papa.parse<Row>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    delimiter,
    transformHeader: (h, i) => h.trim() || `column_${i + 1}`,
  });
  const columns = parsed.meta.fields ?? [];
  if (columns.length === 0) throw new UserError("CSV has no header row");
  if (parsed.data.length > limits.maxRows()) throw new UserError(`CSV has ${parsed.data.length} rows; limit is ${limits.maxRows()} (set CSV_INSIGHTS_MAX_ROWS)`);
  const rows = parsed.data.map((r) => {
    const o: Row = {};
    for (const c of columns) o[c] = r[c] == null ? "" : String(r[c]);
    return o;
  });
  return { file, columns, rows };
}

export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim();
  if (s === "") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^[$€£¥]|^R\s?(?=\d)/, "").replace(/,/g, "").replace(/%$/, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export type ColType = "number" | "date" | "boolean" | "string" | "empty";

export function inferType(values: string[]): ColType {
  const ne = values.filter((v) => v.trim() !== "");
  if (ne.length === 0) return "empty";
  const share = (f: (v: string) => boolean) => ne.filter(f).length / ne.length;
  if (share((v) => toNum(v) !== null) >= 0.95) return "number";
  if (share((v) => /^(true|false|yes|no|y|n|0|1)$/i.test(v.trim())) === 1) return "boolean";
  if (share((v) => /^\d{4}-\d{2}-\d{2}([ T].*)?$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v.trim()) && !Number.isNaN(Date.parse(v))) >= 0.95) return "date";
  return "string";
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : null);

export function numericStats(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return { count: 0 };
  const sum = s.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = n > 1 ? s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return {
    count: n,
    sum: round(sum),
    mean: round(mean),
    median: round(quantile(s, 0.5)),
    std: round(Math.sqrt(variance)),
    min: s[0],
    p25: round(quantile(s, 0.25)),
    p75: round(quantile(s, 0.75)),
    max: s[n - 1],
  };
}

export function topValues(values: string[], k = 5) {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([value, count]) => ({ value, count }));
}

export function assertColumns(t: Table, cols: string[]) {
  const missing = cols.filter((c) => !t.columns.includes(c));
  if (missing.length) throw new UserError(`Unknown column(s): ${missing.join(", ")}. Available: ${t.columns.join(", ")}`);
}

export function profile(t: Table) {
  return {
    file: t.file,
    rows: t.rows.length,
    columns: t.columns.map((c) => {
      const vals = t.rows.map((r) => r[c]);
      const type = inferType(vals);
      const nonEmpty = vals.filter((v) => v.trim() !== "");
      const base = {
        name: c,
        type,
        nulls: vals.length - nonEmpty.length,
        distinct: new Set(nonEmpty).size,
        sample: [...new Set(nonEmpty)].slice(0, 3),
      };
      if (type === "number") {
        const st = numericStats(nonEmpty.map(toNum).filter((x): x is number => x !== null));
        return { ...base, min: st.min, max: st.max, mean: st.mean };
      }
      if (type === "date") {
        const sorted = [...nonEmpty].sort((a, b) => Date.parse(a) - Date.parse(b));
        return { ...base, min: sorted[0], max: sorted[sorted.length - 1] };
      }
      return base;
    }),
  };
}

export type Op = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "starts_with" | "in" | "is_empty" | "not_empty";
export interface Condition {
  column: string;
  op: Op;
  value?: string | number | boolean | Array<string | number>;
}

function compare(a: string, b: unknown): number {
  const na = toNum(a);
  const nb = toNum(b);
  if (na !== null && nb !== null) return na - nb;
  return a.localeCompare(String(b ?? ""), undefined, { sensitivity: "base" });
}

export function matches(row: Row, c: Condition): boolean {
  const v = row[c.column] ?? "";
  switch (c.op) {
    case "=": return compare(v, c.value) === 0;
    case "!=": return compare(v, c.value) !== 0;
    case ">": return v !== "" && compare(v, c.value) > 0;
    case ">=": return v !== "" && compare(v, c.value) >= 0;
    case "<": return v !== "" && compare(v, c.value) < 0;
    case "<=": return v !== "" && compare(v, c.value) <= 0;
    case "contains": return v.toLowerCase().includes(String(c.value ?? "").toLowerCase());
    case "starts_with": return v.toLowerCase().startsWith(String(c.value ?? "").toLowerCase());
    case "in": return (Array.isArray(c.value) ? c.value : [c.value]).some((x) => compare(v, x) === 0);
    case "is_empty": return v.trim() === "";
    case "not_empty": return v.trim() !== "";
  }
}

export function filterRows(t: Table, where: Condition[] = []): Row[] {
  assertColumns(t, where.map((w) => w.column));
  for (const w of where) {
    if (!["is_empty", "not_empty"].includes(w.op) && w.value === undefined) throw new UserError(`Condition on "${w.column}" with op "${w.op}" needs a value`);
  }
  return t.rows.filter((r) => where.every((w) => matches(r, w)));
}

export interface QueryArgs {
  select?: string[];
  where?: Condition[];
  order_by?: Array<{ column: string; direction?: "asc" | "desc" }>;
  limit?: number;
  offset?: number;
  distinct?: boolean;
}

export function query(t: Table, q: QueryArgs) {
  const select = q.select?.length ? q.select : t.columns;
  assertColumns(t, select);
  assertColumns(t, (q.order_by ?? []).map((o) => o.column));
  let rows = filterRows(t, q.where);
  if (q.order_by?.length) {
    rows = [...rows].sort((a, b) => {
      for (const o of q.order_by!) {
        const d = compare(a[o.column], b[o.column]);
        if (d !== 0) return o.direction === "desc" ? -d : d;
      }
      return 0;
    });
  }
  let projected = rows.map((r) => Object.fromEntries(select.map((c) => [c, r[c]])));
  if (q.distinct) {
    const seen = new Set<string>();
    projected = projected.filter((r) => {
      const k = JSON.stringify(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const total = projected.length;
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 100;
  return { file: t.file, matched_rows: total, returned: Math.min(limit, Math.max(0, total - offset)), offset, columns: select, rows: projected.slice(offset, offset + limit) };
}

export type Agg = "count" | "sum" | "mean" | "min" | "max" | "median" | "count_distinct";

export function aggregate(values: string[], agg: Agg): number | null {
  if (agg === "count") return values.filter((v) => v.trim() !== "").length;
  if (agg === "count_distinct") return new Set(values.filter((v) => v.trim() !== "")).size;
  const nums = values.map(toNum).filter((x): x is number => x !== null);
  if (nums.length === 0) return null;
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  switch (agg) {
    case "sum": return r(nums.reduce((a, b) => a + b, 0));
    case "mean": return r(nums.reduce((a, b) => a + b, 0) / nums.length);
    case "min": return Math.min(...nums);
    case "max": return Math.max(...nums);
    case "median": return r(quantile([...nums].sort((a, b) => a - b), 0.5));
  }
}

export interface Metric {
  column?: string;
  agg: Agg;
  as?: string;
}

export function groupBy(t: Table, by: string[], metrics: Metric[], where?: Condition[], sort?: { by: string; direction?: "asc" | "desc" }, limit = 200) {
  assertColumns(t, by);
  for (const m of metrics) {
    if (m.agg !== "count" && !m.column) throw new UserError(`Metric "${m.agg}" needs a column`);
    if (m.column) assertColumns(t, [m.column]);
  }
  const rows = filterRows(t, where);
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = JSON.stringify(by.map((b) => r[b]));
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const name = (m: Metric) => m.as ?? (m.column ? `${m.agg}_${m.column}` : m.agg);
  let out = [...groups.entries()].map(([k, g]) => {
    const keys = JSON.parse(k) as string[];
    const o: Record<string, string | number | null> = {};
    by.forEach((b, i) => (o[b] = keys[i]));
    for (const m of metrics) o[name(m)] = m.column ? aggregate(g.map((r) => r[m.column!]), m.agg) : g.length;
    return o;
  });
  const sortKey = sort?.by ?? (metrics[0] ? name(metrics[0]) : by[0]);
  const dir = sort?.direction ?? "desc";
  out.sort((a, b) => {
    const d = compare(String(a[sortKey] ?? ""), b[sortKey]);
    return dir === "desc" ? -d : d;
  });
  const total = out.length;
  out = out.slice(0, limit);
  return { file: t.file, groups: total, returned: out.length, rows: out };
}

export function pivot(t: Table, rowsCol: string, colsCol: string, valueCol: string | undefined, agg: Agg, where?: Condition[], maxColumns = 50) {
  assertColumns(t, [rowsCol, colsCol, ...(valueCol ? [valueCol] : [])]);
  if (agg !== "count" && !valueCol) throw new UserError(`Aggregation "${agg}" needs a value column`);
  const rows = filterRows(t, where);
  const colKeys = [...new Set(rows.map((r) => r[colsCol]))].sort();
  if (colKeys.length > maxColumns) throw new UserError(`Pivot would create ${colKeys.length} columns (max ${maxColumns}). Filter first or pick a lower-cardinality column.`);
  const cells = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    const rk = r[rowsCol];
    if (!cells.has(rk)) cells.set(rk, new Map());
    const m = cells.get(rk)!;
    const ck = r[colsCol];
    if (!m.has(ck)) m.set(ck, []);
    m.get(ck)!.push(valueCol ? r[valueCol] : "1");
  }
  const out = [...cells.keys()].sort().map((rk) => {
    const o: Record<string, string | number | null> = { [rowsCol]: rk };
    for (const ck of colKeys) {
      const vals = cells.get(rk)!.get(ck);
      o[ck] = vals ? aggregate(vals, agg) : null;
    }
    return o;
  });
  return { file: t.file, rows_dimension: rowsCol, columns_dimension: colsCol, value: valueCol ?? null, agg, columns: [rowsCol, ...colKeys], rows: out };
}

export function summarize(t: Table, columns?: string[]) {
  const cols = columns?.length ? columns : t.columns;
  assertColumns(t, cols);
  const summary = cols.map((c) => {
    const vals = t.rows.map((r) => r[c]);
    const type = inferType(vals);
    const nonEmpty = vals.filter((v) => v.trim() !== "");
    if (type === "number") return { column: c, type, ...numericStats(nonEmpty.map(toNum).filter((x): x is number => x !== null)), nulls: vals.length - nonEmpty.length };
    return { column: c, type, nulls: vals.length - nonEmpty.length, distinct: new Set(nonEmpty).size, top: topValues(nonEmpty) };
  });
  const highlights: string[] = [];
  for (const s of summary) {
    if (s.nulls > 0) highlights.push(`${s.column}: ${s.nulls} empty value(s) (${Math.round((s.nulls / Math.max(1, t.rows.length)) * 100)}%)`);
    if ("sum" in s && s.sum != null) highlights.push(`${s.column}: total ${s.sum}, mean ${s.mean}, range ${s.min} to ${s.max}`);
    if ("top" in s && s.top && s.top[0] && s.distinct > 1) highlights.push(`${s.column}: most common "${s.top[0].value}" (${s.top[0].count} rows)`);
  }
  return { file: t.file, rows: t.rows.length, columns: t.columns.length, highlights, summary };
}

export interface CleanOptions {
  trim_whitespace?: boolean;
  collapse_spaces?: boolean;
  drop_empty_rows?: boolean;
  dedupe?: boolean;
  dedupe_on?: string[];
  case?: { columns: string[]; mode: "lower" | "upper" | "title" };
  normalize_numbers?: string[];
}

export function clean(t: Table, o: CleanOptions) {
  if (o.dedupe_on) assertColumns(t, o.dedupe_on);
  if (o.case) assertColumns(t, o.case.columns);
  if (o.normalize_numbers) assertColumns(t, o.normalize_numbers);
  const stats = { cells_trimmed: 0, cells_case_changed: 0, numbers_normalized: 0, empty_rows_dropped: 0, duplicates_removed: 0 };
  const changedExamples: Array<{ row: number; column: string; before: string; after: string }> = [];
  const note = (row: number, column: string, before: string, after: string) => {
    if (changedExamples.length < 10) changedExamples.push({ row, column, before, after });
  };
  let rows = t.rows.map((r, i) => {
    const o2: Row = { ...r };
    for (const c of t.columns) {
      let v = o2[c];
      const orig = v;
      if (o.trim_whitespace !== false) {
        const tv = o.collapse_spaces ? v.trim().replace(/\s+/g, " ") : v.trim();
        if (tv !== v) stats.cells_trimmed++;
        v = tv;
      }
      if (o.case?.columns.includes(c)) {
        const cv = o.case.mode === "lower" ? v.toLowerCase() : o.case.mode === "upper" ? v.toUpperCase() : v.toLowerCase().replace(/\b\p{L}/gu, (m) => m.toUpperCase());
        if (cv !== v) stats.cells_case_changed++;
        v = cv;
      }
      if (o.normalize_numbers?.includes(c)) {
        const n = toNum(v);
        if (n !== null && String(n) !== v) {
          stats.numbers_normalized++;
          v = String(n);
        }
      }
      if (v !== orig) note(i + 2, c, orig, v);
      o2[c] = v;
    }
    return o2;
  });
  if (o.drop_empty_rows !== false) {
    const before = rows.length;
    rows = rows.filter((r) => t.columns.some((c) => r[c].trim() !== ""));
    stats.empty_rows_dropped = before - rows.length;
  }
  const duplicateExamples: Row[] = [];
  if (o.dedupe || o.dedupe_on?.length) {
    const keyCols = o.dedupe_on?.length ? o.dedupe_on : t.columns;
    const seen = new Set<string>();
    const before = rows.length;
    rows = rows.filter((r) => {
      const k = JSON.stringify(keyCols.map((c) => r[c].toLowerCase()));
      if (seen.has(k)) {
        if (duplicateExamples.length < 5) duplicateExamples.push(r);
        return false;
      }
      seen.add(k);
      return true;
    });
    stats.duplicates_removed = before - rows.length;
  }
  return { table: { file: t.file, columns: t.columns, rows }, report: { file: t.file, rows_before: t.rows.length, rows_after: rows.length, ...stats, changed_examples: changedExamples, duplicate_examples: duplicateExamples, preview: rows.slice(0, 5) } };
}

export function toCsv(t: Table): string {
  return Papa.unparse({ fields: t.columns, data: t.rows.map((r) => t.columns.map((c) => r[c])) });
}

/** Write a derived file into the output dir. Never overwrites. */
export async function writeOutput(name: string, content: string, ext: string): Promise<string> {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.[^.]*$/, "");
  if (!base) throw new UserError("Invalid output name");
  const dir = outputDir();
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${base}.${ext}`);
  try {
    await fs.writeFile(target, content, { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new UserError(`Output already exists: ${path.relative(rootDir(), target)}. Choose another name.`);
    throw e;
  }
  return path.relative(rootDir(), target);
}

export async function listFiles(sub = ".", maxFiles = 500) {
  const root = rootDir();
  const start = resolveInRoot(sub);
  const out: Array<{ path: string; bytes: number; modified: string }> = [];
  async function walk(dir: string, depth: number) {
    if (depth > 4 || out.length >= maxFiles) return;
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(p, depth + 1);
      else if (ent.isFile() && /\.(csv|tsv)$/i.test(ent.name)) {
        const st = statSync(p);
        out.push({ path: path.relative(root, p), bytes: st.size, modified: st.mtime.toISOString() });
      }
    }
  }
  await walk(start, 0);
  return { root, files: out };
}
