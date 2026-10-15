import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import * as csv from "../src/csv.js";
import { makeSandbox, removeSandbox } from "./helpers.js";

let dir: string;
let client: Client;
type Text = { type: string; text: string };

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Text[])[0].text;
  return { isError: Boolean(res.isError), text, json: () => JSON.parse(text) };
}

beforeAll(async () => {
  dir = makeSandbox();
  process.env.CSV_INSIGHTS_DIR = dir;
  const server = createServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "unit", version: "1" });
  await client.connect(b);
});
afterAll(() => removeSandbox(dir));

describe("parsing helpers", () => {
  it("parses currency, thousands separators, negatives in parentheses and percents", () => {
    expect(csv.toNum("$1,200.50")).toBe(1200.5);
    expect(csv.toNum("(45)")).toBe(-45);
    expect(csv.toNum("12%")).toBe(12);
    expect(csv.toNum("R 99")).toBe(99);
    expect(csv.toNum("abc")).toBeNull();
    expect(csv.toNum("")).toBeNull();
  });
  it("infers column types", () => {
    expect(csv.inferType(["1", "2.5", "$3"])).toBe("number");
    expect(csv.inferType(["2026-01-01", "2026-02-03"])).toBe("date");
    expect(csv.inferType(["yes", "no"])).toBe("boolean");
    expect(csv.inferType(["a", "b"])).toBe("string");
    expect(csv.inferType(["", " "])).toBe("empty");
  });
  it("handles BOM and blank headers", () => {
    const t = csv.parseCsv("\uFEFFa,,c\n1,2,3\n");
    expect(t.columns).toEqual(["a", "column_2", "c"]);
  });
});

describe("path security", () => {
  it("rejects traversal and absolute paths", async () => {
    for (const p of ["../x.csv", "/etc/passwd", "data/../../x.csv"]) {
      const r = await call("profile_csv", { file: p });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/outside/);
    }
  });
  it("rejects symlinks that escape the root", async () => {
    const outside = path.join(dir, "..", `outside-${Date.now()}.csv`);
    writeFileSync(outside, "a\n1\n");
    symlinkSync(outside, path.join(dir, "link.csv"));
    const r = await call("profile_csv", { file: "link.csv" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/symlink/);
  });
  it("rejects non-CSV extensions and missing files", async () => {
    writeFileSync(path.join(dir, "secret.env"), "KEY=1");
    expect((await call("profile_csv", { file: "secret.env" })).text).toMatch(/Only \.csv/);
    expect((await call("profile_csv", { file: "nope.csv" })).text).toMatch(/not found/);
  });
  it("enforces the size limit", async () => {
    process.env.CSV_INSIGHTS_MAX_BYTES = "10";
    const r = await call("profile_csv", { file: "data/sales.csv" });
    delete process.env.CSV_INSIGHTS_MAX_BYTES;
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/limit/);
  });
});

describe("tools", () => {
  it("list_csv_files", async () => {
    const r = (await call("list_csv_files", {})).json();
    expect(r.files.map((f: { path: string }) => f.path)).toContain(path.join("data", "sales.csv"));
  });
  it("profile_csv", async () => {
    const r = (await call("profile_csv", { file: "data/sales.csv" })).json();
    expect(r.rows).toBe(11);
    const rev = r.columns.find((c: { name: string }) => c.name === "revenue");
    expect(rev.type).toBe("number");
    expect(rev.max).toBe(1200);
    expect(r.columns.find((c: { name: string }) => c.name === "date").type).toBe("date");
    expect(r.columns.find((c: { name: string }) => c.name === "units").nulls).toBe(1);
  });
  it("query_csv filters, sorts, limits", async () => {
    const r = (await call("query_csv", { file: "data/sales.csv", where: [{ column: "revenue", op: ">", value: 40 }], order_by: [{ column: "revenue", direction: "desc" }], select: ["order_id", "revenue"], limit: 2 })).json();
    expect(r.matched_rows).toBe(5);
    expect(r.rows.map((x: { order_id: string }) => x.order_id)).toEqual(["1005", "1007"]);
  });
  it("query_csv supports in, contains, distinct and unknown-column errors", async () => {
    expect((await call("query_csv", { file: "data/sales.csv", where: [{ column: "region", op: "in", value: ["East", "West"] }] })).json().matched_rows).toBe(5);
    expect((await call("query_csv", { file: "data/sales.csv", where: [{ column: "product", op: "contains", value: "planner" }] })).json().matched_rows).toBe(4);
    expect((await call("query_csv", { file: "data/sales.csv", select: ["region"], distinct: true })).json().matched_rows).toBe(4);
    const bad = await call("query_csv", { file: "data/sales.csv", select: ["nope"] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("Available:");
    expect((await call("query_csv", { file: "data/sales.csv", where: [{ column: "region", op: "=" }] })).text).toMatch(/needs a value/);
  });
  it("rejects invalid input via zod", async () => {
    const r = await call("query_csv", { file: "data/sales.csv", limit: 5000 });
    expect(r.isError).toBe(true);
  });
  it("summarize_csv", async () => {
    const r = (await call("summarize_csv", { file: "data/sales.csv" })).json();
    const rev = r.summary.find((s: { column: string }) => s.column === "revenue");
    expect(rev.sum).toBeCloseTo(2591.89, 2);
    expect(r.highlights.some((h: string) => h.startsWith("units: 1 empty"))).toBe(true);
  });
  it("group_by", async () => {
    const r = (await call("group_by", { file: "data/sales.csv", by: ["product"], metrics: [{ agg: "count" }, { column: "units", agg: "sum", as: "units" }], sort: { by: "units", direction: "desc" } })).json();
    expect(r.rows[0]).toMatchObject({ product: "Budget Sheet", units: 11, count: 5 });
    expect((await call("group_by", { file: "data/sales.csv", by: ["region"], metrics: [{ agg: "sum" }] })).text).toMatch(/needs a column/);
  });
  it("pivot_table", async () => {
    const r = (await call("pivot_table", { file: "data/sales.csv", rows: "region", columns: "product", value: "units", agg: "sum" })).json();
    const north = r.rows.find((x: { region: string }) => x.region === "North");
    expect(north["Planner PDF"]).toBe(8);
    expect(north["Wedding Kit"]).toBeNull();
    const counts = (await call("pivot_table", { file: "data/sales.csv", rows: "region", columns: "product" })).json();
    expect(counts.agg).toBe("count");
  });
  it("clean_preview previews and saves without overwriting the source", async () => {
    const before = readFileSync(path.join(dir, "data/sales.csv"), "utf8");
    const p = (await call("clean_preview", { file: "data/sales.csv", dedupe: true, normalize_numbers: ["revenue"] })).json();
    expect(p.duplicates_removed).toBe(1);
    expect(p.cells_trimmed).toBe(1);
    expect(p.numbers_normalized).toBeGreaterThan(0);
    expect(p.saved_to).toBeNull();
    const s = (await call("clean_preview", { file: "data/sales.csv", dedupe_on: ["order_id"], save_as: "sales-clean" })).json();
    expect(s.saved_to).toBe(path.join("csv-insights-output", "sales-clean.csv"));
    expect(readFileSync(path.join(dir, s.saved_to), "utf8").split("\n").length).toBe(11);
    expect(readFileSync(path.join(dir, "data/sales.csv"), "utf8")).toBe(before);
    const again = await call("clean_preview", { file: "data/sales.csv", save_as: "sales-clean" });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already exists/);
    const traversal = (await call("clean_preview", { file: "data/sales.csv", save_as: "../../evil" })).json();
    expect(traversal.saved_to).toBe(path.join("csv-insights-output", "evil.csv"));
  });
  it("create_chart writes a valid SVG", async () => {
    const r = (await call("create_chart", { file: "data/sales.csv", type: "line", x: "date", y: "revenue", title: "Revenue <by> day", output_name: "rev" })).json();
    const svg = readFileSync(path.join(dir, r.saved_to), "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Revenue &lt;by&gt; day");
    expect(r.data[0].label).toBe("2026-07-01");
    const bar = (await call("create_chart", { file: "data/sales.csv", type: "bar", x: "region", output_name: "count", top: 2 })).json();
    expect(bar.points).toBe(2);
  });
  it("annotations mark read-only tools", async () => {
    const { tools } = await client.listTools();
    const ro = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(ro).toEqual(expect.arrayContaining(["profile_csv", "query_csv", "summarize_csv", "group_by", "pivot_table", "list_csv_files"]));
    expect(tools.find((t) => t.name === "create_chart")?.annotations?.readOnlyHint).toBe(false);
  });
});
