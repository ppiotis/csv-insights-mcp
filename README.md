<p align="center"><img src="logo.svg" width="96" alt="CSV Insights logo"></p>

# CSV Insights MCP

[![CI](https://github.com/ppiotis/csv-insights-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ppiotis/csv-insights-mcp/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

**Private, local spreadsheet analysis for Grok Bot and Cursor.** Ask questions about your sales exports, bank statements or any CSV and get real numbers: profiles, filtered queries, group-bys, pivots, cleaned copies and charts. Your data never leaves your machine: no network calls, no accounts, no API keys, no telemetry.

## Why

Pasting a spreadsheet into chat is lossy, slow, and leaks data to wherever the transcript goes. CSV Insights lets the agent compute over the file *locally* and only return the aggregates it needs. Ideal for solopreneur sales and finance questions: "revenue by product last quarter", "who are my top 10 customers", "dedupe this export".

## Tools

| Tool | What it does | Writes? |
|---|---|---|
| `list_csv_files` | List `.csv`/`.tsv` files in the allowed folder | no |
| `profile_csv` | Row count; per column: inferred type, empties, distinct, samples, min/max/mean | no |
| `query_csv` | SQL-like SELECT: `select`, `where` (`= != > >= < <= contains starts_with in is_empty not_empty`), `order_by`, `distinct`, `limit` (≤1000), `offset` | no |
| `summarize_csv` | Sum/mean/median/std/quartiles for numbers, top values for text, plain-language highlights | no |
| `group_by` | GROUP BY 1–5 columns with `count sum mean min max median count_distinct` | no |
| `pivot_table` | Rows × columns cross-tab of an aggregated value (≤50 columns) | no |
| `clean_preview` | Preview trim / collapse spaces / drop empty rows / dedupe / case / number normalisation; optional `save_as` writes a cleaned copy | new file only |
| `create_chart` | Aggregate + render a bar or line chart to SVG | new file only |

Numbers are parsed robustly: `$1,200.00` → 1200, `(45)` → −45, `12%` → 12, `R 99` → 99.

## Install

### Local (recommended: data stays on your computer)

Requires Node.js 20+.

**Grok Bot / Cursor plugin:** add this plugin from the marketplace, or add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "csv-insights": {
      "command": "npx",
      "args": ["-y", "https://github.com/ppiotis/csv-insights-mcp/archive/refs/tags/v1.0.0.tar.gz"],
      "env": { "CSV_INSIGHTS_DIR": "/absolute/path/to/your/csv/folder" }
    }
  }
}
```

If `CSV_INSIGHTS_DIR` is not set, the server uses its working directory (your workspace in Cursor).

**From source:**

```bash
git clone https://github.com/ppiotis/csv-insights-mcp && cd csv-insights-mcp
npm ci && npm run build
CSV_INSIGHTS_DIR=./examples node dist/stdio.js
```

### Remote (Streamable HTTP)

The same server speaks Streamable HTTP at `/mcp` (stateless, JSON responses). Because it reads files from its own disk, host it **next to the data** (your machine, a NAS, or a private team server) rather than on a public multi-tenant host.

```bash
CSV_INSIGHTS_DIR=/data MCP_AUTH_TOKEN=change-me PORT=3000 node dist/serve-http.js
# or
docker build -t csv-insights-mcp . && docker run -p 3000:3000 -v "$PWD/examples:/data" -e CSV_INSIGHTS_DIR=/data -e MCP_AUTH_TOKEN=change-me csv-insights-mcp
```

Client config: `{"url": "https://your-host/mcp", "headers": {"Authorization": "Bearer change-me"}}`. `GET /health` returns `{"ok":true}`.

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `CSV_INSIGHTS_DIR` | working directory | The only folder files are read from |
| `CSV_INSIGHTS_MAX_BYTES` | 52428800 (50 MB) | Max file size |
| `CSV_INSIGHTS_MAX_ROWS` | 500000 | Max rows |
| `MCP_AUTH_TOKEN` | unset | HTTP only: require `Authorization: Bearer <token>` |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | HTTP bind address |

## Security & privacy

- **No network.** The server makes zero outbound requests and has no telemetry. Dependencies: the MCP SDK, `zod`, `papaparse`.
- **Allowlisted folder.** Every path is resolved inside `CSV_INSIGHTS_DIR`; `..`, absolute paths and symlinks that escape are rejected (unit-tested). Only `.csv`, `.tsv` and `.txt` files are read.
- **Least privilege writes.** Source files are never modified. Cleaned copies and charts go only to `csv-insights-output/` inside the folder, file names are sanitised, and existing files are never overwritten.
- **Resource limits.** File-size and row caps, result caps (≤1000 rows, ≤50 pivot columns), 1 MB HTTP body cap.
- **No secrets.** Nothing to configure for normal use. The optional HTTP bearer token is compared in constant time. HTTP binds to `127.0.0.1` by default.
- **Accurate annotations.** Read tools are `readOnlyHint: true`; the two file-producing tools are `readOnlyHint: false, destructiveHint: false`.

## Reviewer test plan

Setup: add the plugin with `CSV_INSIGHTS_DIR` pointing at this repo's `examples/` folder (contains `sales.csv`, 11 orders with one duplicate row, one padded value and one blank cell).

1. **Explore.** Ask: *"What's in sales.csv?"* → Expect the bot to call `list_csv_files` + `profile_csv` and report 11 rows, 6 columns, `revenue` as a number column (max 1200) and `date` as a date column (2026-07-01 to 2026-09-12).
2. **Business question.** Ask: *"Which region made the most revenue?"* → Expect `group_by` and the answer **South, $1,212.00**, followed by East ($1,159.99), West and North.
3. **Pivot.** Ask: *"Units by region and product as a table."* → Expect `pivot_table`; North × Planner PDF = 8.
4. **Clean.** Ask: *"Are there duplicates? Give me a cleaned copy."* → Expect a preview first (1 duplicate, 1 trimmed cell), then after you confirm, `csv-insights-output/<name>.csv` with 10 data rows. `examples/sales.csv` is unchanged.
5. **Chart + security.** Ask: *"Chart revenue over time (by date) as a line chart"* → an SVG appears in `csv-insights-output/`. Then ask: *"Profile ../../etc/passwd"* → Expect a clear refusal: "Path is outside the allowed directory".

## Development

```bash
npm ci
npm test          # build + unit tests + e2e (stdio and HTTP)
npm audit --omit=dev
```

The e2e suite spawns the real server over **stdio** and over **Streamable HTTP** (with bearer auth) and calls every tool through an MCP client.

## License

MIT © Paris Piotis
