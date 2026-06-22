---
name: html-output
description: Convert AI-generated Markdown documents into clean browser-viewable HTML pages. Use when CI needs to publish summaries, skill documents, model configuration records, or other Markdown outputs as HTML artifacts.
---

# HTML Output

## Purpose

Use this skill when an AI workflow must turn generated Markdown into a readable HTML document for archive, review, or web publishing.

## Instructions

1. Preserve the source Markdown structure in the HTML output.
2. Render headings, paragraphs, unordered lists, inline code, bold text, and Markdown tables.
3. Use a complete HTML document with `<!doctype html>`, `<html lang="zh-CN">`, `<head>`, and `<body>`.
4. Include UTF-8 charset and responsive viewport metadata.
5. Keep styles simple, readable, and suitable for technical documentation.
6. Escape user-provided content before inserting it into HTML.
7. Do not include API keys, passwords, tokens, cookies, private keys, or account credentials in the HTML.
8. If an external Markdown-to-HTML service is unavailable, use the built-in HTML template fallback.

## Expected Output

- One `.html` file for each generated Markdown document when required.
- A stable, browser-viewable HTML document that can be committed by CI.
