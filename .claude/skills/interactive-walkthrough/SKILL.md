---
name: interactive-walkthrough
description: Generate explainable walkthrough documents with Mermaid diagrams and plain-language node descriptions for workflows, code paths, CI pipelines, and architecture flows.
---

# Interactive Walkthrough

## Purpose

Use this skill to turn complex workflows into a diagram-led explanation.

Inspired by public walkthrough skills that combine Mermaid diagrams with browser-readable explanations.

## Instructions

1. Start with a high-level process summary.
2. Include a Mermaid flowchart for the main path.
3. Add short explanations for important nodes.
4. Include failure paths or feedback loops when confirmed by the source.
5. Keep diagrams readable; split into sections if the flow is too large.
6. Use file paths or commands only when they appear in the source.
7. Redact secrets and credentials.

## Expected Output

- A `## 流程图` section.
- A Mermaid graph.
- A concise explanation of the major nodes and loop points.
