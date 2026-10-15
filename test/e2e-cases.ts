import { expect } from "vitest";
import { makeSandbox, removeSandbox } from "./helpers.js";

let dir = "";
export const e2eEnv: Record<string, string> = {};
export async function setupE2E() {
  dir = makeSandbox();
  return { CSV_INSIGHTS_DIR: dir };
}
export async function teardownE2E() {
  removeSandbox(dir);
}

export const expectedTools = ["list_csv_files", "profile_csv", "query_csv", "summarize_csv", "group_by", "pivot_table", "clean_preview", "create_chart"];

const uniq = () => `out-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export interface Case {
  tool: string;
  args: (ctx: Record<string, unknown>) => Record<string, unknown>;
  isError?: boolean;
  check?: (text: string, ctx: Record<string, unknown>) => void;
}

export const cases: Case[] = [
  { tool: "list_csv_files", args: () => ({}), check: (t) => expect(t).toContain("data/sales.csv") },
  { tool: "profile_csv", args: () => ({ file: "data/sales.csv" }), check: (t) => expect(JSON.parse(t).rows).toBe(11) },
  { tool: "query_csv", args: () => ({ file: "data/sales.csv", where: [{ column: "region", op: "=", value: "North" }], select: ["order_id"] }), check: (t) => expect(JSON.parse(t).matched_rows).toBe(3) },
  { tool: "summarize_csv", args: () => ({ file: "data/sales.csv", columns: ["revenue"] }), check: (t) => expect(t).toContain("highlights") },
  { tool: "group_by", args: () => ({ file: "data/sales.csv", by: ["region"], metrics: [{ column: "revenue", agg: "sum" }] }), check: (t) => expect(JSON.parse(t).rows[0].region).toBe("South") },
  { tool: "pivot_table", args: () => ({ file: "data/sales.csv", rows: "region", columns: "product", value: "units", agg: "sum" }), check: (t) => expect(JSON.parse(t).columns).toContain("Wedding Kit") },
  { tool: "clean_preview", args: () => ({ file: "data/sales.csv", dedupe: true }), check: (t) => expect(JSON.parse(t).duplicates_removed).toBe(1) },
  { tool: "create_chart", args: () => ({ file: "data/sales.csv", type: "bar", x: "region", y: "revenue", output_name: uniq() }), check: (t) => expect(JSON.parse(t).saved_to).toMatch(/\.svg$/) },
  { tool: "profile_csv", args: () => ({ file: "../../etc/passwd" }), isError: true, check: (t) => expect(t).toContain("outside") },
];
