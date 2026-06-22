---
name: document-format
description: Normalize AI-generated technical documents into stable Markdown with clear headings, tables, config examples, and sensitive-data hygiene. Use when generating summaries, configuration records, CI artifacts, or documentation from uploaded files.
---

# Document Format

## Purpose

Use this skill to keep AI-generated documentation stable, readable, and suitable for CI-generated artifacts.

## Markdown Rules

1. Use clear Chinese Markdown unless the target document explicitly requires another language.
2. Keep heading levels consistent.
3. Prefer short paragraphs and compact lists.
4. Use Markdown tables for comparisons, records, inventories, and model switch history.
5. Use fenced code blocks for configuration examples.
6. Use `原文未明确` when the source does not confirm a value.
7. Do not invent model names, providers, dates, keys, endpoints, or account information.
8. Do not include API keys, passwords, tokens, cookies, private keys, or account credentials.
9. Replace any sensitive value with `<REDACTED>`.

## CI Output Rules

1. Generated Markdown must be deterministic enough for review in git diffs.
2. Required sections must not be omitted.
3. File paths mentioned in output should match repository paths.
4. Generated documents should be safe to commit to GitHub.
