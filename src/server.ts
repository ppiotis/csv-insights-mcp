import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { safe, UserError } from "./result.js";
import * as csv from "./csv.js";
import { renderSvg } from "./chart.js";

export const VERSION = "1.0.0";

const file = z.string().min(1).max(500).describe("CSV path relative to the allowed directory (CSV_INSIGHTS_DIR), e.g. 'sales/2026-q3.csv'");
const condition = z.object({
  column: z.string().min(1),
  op: z.enum(["=", "!=", ">", ">=", "<", "<=", "contains", "starts_with", "in", "is_empty", "not_empty"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])).max(500)]).optional(),
});
const where = z.array(condition).max(20).optional().describe("Row filters, all must match (AND)");
const agg = z.enum(["count", "sum", "mean", "min", "max", "median", "count_distinct"]);
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE_NEW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "csv-insights", version: VERSION },
    { instructions: "Local, private CSV analysis. Files are read only from CSV_INSIGHTS_DIR. Start with list_csv_files, then profile_csv before querying. Derived files (cleaned CSVs, charts) are written only to csv-insights-output/ and never overwrite." },
  );

  server.registerTool("list_csv_files", {
    title: "List CSV files",
    description: "List .csv/.tsv files inside the allowed directory (recursive, max depth 4).",
    inputSchema: { subdirectory: z.string().max(500).optional().describe("Optional subfolder relative to the allowed directory") },
    annotations: RO,
  }, safe(async ({ subdirectory }) => csv.listFiles(subdirectory ?? ".")));

  server.registerTool("profile_csv", {
    title: "Profile CSV schema",
    description: "Return row count and, per column: inferred type (number/date/boolean/string), empty count, distinct count, samples and min/max/mean.",
    inputSchema: { file },
    annotations: RO,
  }, safe(async ({ file }) => csv.profile(await csv.loadTable(file))));

  server.registerTool("query_csv", {
    title: "Query CSV (SQL-like)",
    description: "SQL-like SELECT over a CSV: choose columns, WHERE conditions, ORDER BY, DISTINCT, LIMIT/OFFSET. Numeric-aware comparisons. Returns at most 1000 rows.",
    inputSchema: {
      file,
      select: z.array(z.string().min(1)).max(100).optional().describe("Columns to return (default all)"),
      where,
      order_by: z.array(z.object({ column: z.string().min(1), direction: z.enum(["asc", "desc"]).optional() })).max(5).optional(),
      distinct: z.boolean().optional(),
      limit: z.number().int().min(1).max(1000).optional().describe("Default 100"),
      offset: z.number().int().min(0).optional(),
    },
    annotations: RO,
  }, safe(async ({ file, ...q }) => csv.query(await csv.loadTable(file), q)));

  server.registerTool("summarize_csv", {
    title: "Summarize CSV",
    description: "Descriptive statistics: sum/mean/median/std/quartiles for numeric columns, top values for text columns, plus plain-language highlights.",
    inputSchema: { file, columns: z.array(z.string().min(1)).max(100).optional() },
    annotations: RO,
  }, safe(async ({ file, columns }) => csv.summarize(await csv.loadTable(file), columns)));

  server.registerTool("group_by", {
    title: "Group by and aggregate",
    description: "GROUP BY one or more columns with aggregations (count, sum, mean, min, max, median, count_distinct). Sorted by the first metric descending unless 'sort' is given.",
    inputSchema: {
      file,
      by: z.array(z.string().min(1)).min(1).max(5),
      metrics: z.array(z.object({ column: z.string().min(1).optional(), agg, as: z.string().min(1).max(64).optional() })).min(1).max(10),
      where,
      sort: z.object({ by: z.string().min(1), direction: z.enum(["asc", "desc"]).optional() }).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    },
    annotations: RO,
  }, safe(async ({ file, by, metrics, where, sort, limit }) => csv.groupBy(await csv.loadTable(file), by, metrics, where, sort, limit)));

  server.registerTool("pivot_table", {
    title: "Pivot table",
    description: "Cross-tabulate: one column as rows, another as columns, aggregating a value column. Max 50 output columns.",
    inputSchema: {
      file,
      rows: z.string().min(1).describe("Column whose values become rows"),
      columns: z.string().min(1).describe("Column whose values become columns"),
      value: z.string().min(1).optional().describe("Column to aggregate (omit for counts)"),
      agg: agg.default("sum"),
      where,
    },
    annotations: RO,
  }, safe(async ({ file, rows, columns, value, agg, where }) => csv.pivot(await csv.loadTable(file), rows, columns, value, value ? agg : "count", where)));

  server.registerTool("clean_preview", {
    title: "Clean / dedupe preview",
    description: "Preview cleaning (trim whitespace, collapse spaces, drop empty rows, dedupe, case normalisation, number normalisation) without touching the source. Set save_as to write the cleaned copy to csv-insights-output/ (never overwrites).",
    inputSchema: {
      file,
      trim_whitespace: z.boolean().optional().describe("Default true"),
      collapse_spaces: z.boolean().optional(),
      drop_empty_rows: z.boolean().optional().describe("Default true"),
      dedupe: z.boolean().optional().describe("Remove exact duplicate rows (case-insensitive)"),
      dedupe_on: z.array(z.string().min(1)).max(20).optional().describe("Treat rows as duplicates when these columns match"),
      case: z.object({ columns: z.array(z.string().min(1)).min(1), mode: z.enum(["lower", "upper", "title"]) }).optional(),
      normalize_numbers: z.array(z.string().min(1)).max(50).optional().describe("Columns where '$1,200.00' becomes '1200'"),
      save_as: z.string().min(1).max(100).optional().describe("Output file name (written as csv-insights-output/<name>.csv)"),
    },
    annotations: WRITE_NEW,
  }, safe(async ({ file, save_as, ...opts }) => {
    const { table, report } = csv.clean(await csv.loadTable(file), opts);
    const saved_to = save_as ? await csv.writeOutput(save_as, csv.toCsv(table), "csv") : null;
    return { ...report, saved_to, note: saved_to ? "Source file was not modified." : "Preview only. Pass save_as to write a cleaned copy." };
  }));

  server.registerTool("create_chart", {
    title: "Create chart (SVG)",
    description: "Aggregate a CSV and render a bar or line chart as an SVG file in csv-insights-output/. Returns the file path and the plotted data.",
    inputSchema: {
      file,
      type: z.enum(["bar", "line"]),
      x: z.string().min(1).describe("Category / x-axis column"),
      y: z.string().min(1).optional().describe("Numeric column (omit to count rows)"),
      agg: agg.default("sum"),
      where,
      sort: z.enum(["value_desc", "value_asc", "label"]).optional().describe("Default: label for line, value_desc for bar"),
      top: z.number().int().min(1).max(200).optional().describe("Keep only the first N points after sorting (default 50)"),
      title: z.string().max(120).optional(),
      output_name: z.string().min(1).max(100).describe("File name for the chart (written as csv-insights-output/<name>.svg)"),
    },
    annotations: WRITE_NEW,
  }, safe(async (a) => {
    const t = await csv.loadTable(a.file);
    const metric = a.y ? { column: a.y, agg: a.agg, as: "value" } : { agg: "count" as const, as: "value" };
    const g = csv.groupBy(t, [a.x], [metric], a.where, undefined, 100000);
    let pts = g.rows.map((r) => ({ label: String(r[a.x]), value: Number(r.value ?? 0) }));
    if (pts.length === 0) throw new UserError("No rows to chart after filtering");
    const sort = a.sort ?? (a.type === "line" ? "label" : "value_desc");
    pts.sort((p, q) => (sort === "label" ? p.label.localeCompare(q.label, undefined, { numeric: true }) : sort === "value_asc" ? p.value - q.value : q.value - p.value));
    pts = pts.slice(0, a.top ?? 50);
    const title = a.title ?? `${a.y ? `${a.agg} of ${a.y}` : "count"} by ${a.x}`;
    const svg = renderSvg(a.type, pts, { title, xLabel: a.x, yLabel: a.y ? `${a.agg}(${a.y})` : "count" });
    const saved_to = await csv.writeOutput(a.output_name, svg, "svg");
    return { saved_to, format: "svg", points: pts.length, data: pts };
  }));

  return server;
}
