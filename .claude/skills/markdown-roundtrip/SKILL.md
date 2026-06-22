---
name: markdown-roundtrip
description: Preserve a Markdown-to-HTML-to-Markdown editing loop. Use when HTML pages should allow users to edit content and export updated Markdown for CI reprocessing.
---

# Markdown Roundtrip

## Purpose

Use this skill to keep Markdown and HTML outputs synchronized through a manual or automated editing loop.

## Instructions

1. Treat Markdown as the canonical source.
2. Treat HTML as a rendered, editable companion view.
3. Provide an edit area for Markdown source.
4. Provide preview rendering for edited Markdown.
5. Provide a Markdown export or download action.
6. Tell users that downloaded Markdown can be committed back to the repository to trigger CI.
7. Do not claim that static HTML can write directly to GitHub unless a GitHub API integration is explicitly configured.

## Expected Output

- Editable HTML artifact.
- Downloadable updated Markdown.
- CI can rerun when the Markdown is committed.
