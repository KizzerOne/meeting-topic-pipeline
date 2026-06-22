---
name: interactive-html-artifact
description: Produce self-contained HTML artifacts for complex AI outputs such as reports, summaries, diagrams, walkthroughs, and editable review pages.
---

# Interactive HTML Artifact

## Purpose

Use this skill when Markdown alone is not enough and the output should be readable, shareable, and interactive in a browser.

Inspired by the HTML artifact pattern described in the HTML vs Markdown discussion and by public HTML artifact skills.

## Instructions

1. Keep Markdown as the source of truth.
2. Generate HTML as a companion artifact for reading, editing, and sharing.
3. Include readable typography, tables, code blocks, and Mermaid rendering.
4. Provide controls for editing Markdown, previewing changes, and exporting Markdown.
5. Avoid hidden prompts or invisible instructions in HTML.
6. Escape untrusted Markdown before inserting it into generated HTML.
7. Avoid remote scripts except explicit, reviewed dependencies such as Mermaid.

## Expected Output

- A browser-viewable `.html` file.
- The same content preserved in Markdown-compatible form.
