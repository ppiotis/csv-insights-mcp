---
name: csv-cleanup-and-charts
description: Clean or dedupe a CSV and produce charts with csv-insights. Use when the user wants a tidy copy of a file, to remove duplicates, normalise messy values, or visualise data as a chart image.
---

# Cleaning and charting

Both tools write **new files only** into `csv-insights-output/` inside the allowed folder. They never modify or overwrite the source, and refuse to overwrite an existing output.

## Cleaning: preview, confirm, then save

1. Run `clean_preview` **without** `save_as`. Options:
   - `trim_whitespace` (default on), `collapse_spaces`
   - `drop_empty_rows` (default on)
   - `dedupe` (exact rows, case-insensitive) or `dedupe_on: ["email"]` for key-based dedupe
   - `case: {"columns":["name"],"mode":"title"}`
   - `normalize_numbers: ["amount"]` turns `"$1,200.00"` into `1200`
2. Show the user `rows_before → rows_after`, the counts, and a few `changed_examples` / `duplicate_examples`.
3. Only after the user agrees, call again with the same options plus `save_as: "<name>"`. Report the `saved_to` path.

## Charts

`create_chart` aggregates then renders an SVG:
- Categories → `type: "bar"` (sorted by value, top 50 by default; use `top` to trim).
- Time series → `type: "line"` with a date/month column as `x` (sorted by label).
- Omit `y` to chart row counts.
Give it a descriptive `title` and a unique `output_name`. Tell the user where the file was saved and summarise the 2–3 key takeaways from the returned `data`. Do not claim you can see the image; describe the data.
