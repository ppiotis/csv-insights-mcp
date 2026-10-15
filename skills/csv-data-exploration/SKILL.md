---
name: csv-data-exploration
description: Explore an unfamiliar CSV with the csv-insights tools. Use when the user asks what is in a spreadsheet, wants a quick overview, or asks a question about a CSV file.
---

# Exploring a CSV safely

The csv-insights server can only read files inside its allowed folder (`CSV_INSIGHTS_DIR`). Paths are always relative to that folder.

## Workflow

1. **Find the file.** Call `list_csv_files`. If the user named a file loosely ("my sales export"), pick the closest match and say which one you used. Never guess absolute paths; they are rejected.
2. **Profile before you query.** Call `profile_csv` once. Read the column names exactly as returned (they are case-sensitive) and note:
   - inferred `type` (number / date / boolean / string),
   - `nulls` (empty cells) and `distinct` counts,
   - min/max for numbers and dates.
3. **Answer with the narrowest tool.**
   - A specific rows question ("orders over $500 in August") → `query_csv` with `where` + `order_by` + `select`.
   - "Totals/averages by X" → `group_by`.
   - "X by Y matrix" → `pivot_table`.
   - "Give me an overview" → `summarize_csv` and relay its `highlights`.
4. **Report clearly.** Lead with the answer, then the numbers, then any caveats (empty cells, duplicates, mixed formats).

## Query tips

- Comparisons are numeric-aware: `"$1,200.00"` compares as 1200.
- Text matches with `=` are case-insensitive; use `contains` / `starts_with` for partial matches and `in` for lists.
- Dates in ISO format (`2026-08-01`) sort and compare correctly as text: `{"column":"date","op":">=","value":"2026-08-01"}`.
- `limit` defaults to 100 and caps at 1000. Check `matched_rows` to know if results were truncated, and say so.

## Don'ts

- Don't paste hundreds of rows back to the user. Aggregate instead.
- Don't invent column names; if a tool says "Unknown column", use the `Available:` list it returns.
