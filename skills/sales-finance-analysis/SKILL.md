---
name: sales-finance-analysis
description: Turn sales, revenue, expense or bank-export CSVs into business answers (revenue by product, month-over-month, top customers, expense categories) using csv-insights group_by, pivot_table and summarize_csv.
---

# Sales and finance analysis recipes

Always `profile_csv` first to learn the real column names and which columns are numeric.

## Revenue by product / region / channel
`group_by` with `by: ["product"]`, `metrics: [{"column":"revenue","agg":"sum","as":"revenue"},{"agg":"count","as":"orders"},{"column":"revenue","agg":"mean","as":"avg_order"}]`.

## Month-over-month
If dates are ISO (`YYYY-MM-DD`) there is no month column yet. Two options:
- Filter by range with `query_csv` / `where` (`>= 2026-08-01` and `< 2026-09-01`) and run `group_by` per month, or
- If a `month` column exists, `pivot_table` with `rows: "product"`, `columns: "month"`, `value: "revenue"`.
Report the change as both an absolute and a percentage, and name the biggest mover.

## Top customers / items
`group_by` by customer, sum revenue, `sort: {"by":"revenue","direction":"desc"}`, `limit: 10`.

## Expenses by category (bank exports)
Bank exports often store debits as negatives or in parentheses; both parse as negative numbers. Use `where: [{"column":"amount","op":"<","value":0}]` for spend, then `group_by` category with `sum`.

## Data quality first
Before reporting totals, check for duplicates with `clean_preview` (`dedupe_on: ["order_id"]`). If duplicates exist, tell the user and report totals both with and without them, or ask which they want.

## Presenting
- Round money to 2 decimals and include the currency symbol seen in the data.
- Offer a chart (`create_chart`) for anything with more than 4 categories or any time series.
- State the date range and row count your numbers cover.
