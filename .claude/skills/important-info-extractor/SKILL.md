---
name: important-info-extractor
description: Extract key tasks, dates, people, decisions, issues, risks, code/config records, and follow-up actions from uploaded documents before generating summaries.
---

# Important Info Extractor

## Purpose

Use this skill to make summaries more useful by extracting structured facts before writing narrative text.

## Instructions

1. Extract tasks, owners, deadlines, priorities, and status.
2. Extract people, teams, systems, files, repositories, models, APIs, and tools mentioned in the source.
3. Extract confirmed conclusions and decisions.
4. Extract risks, blockers, unresolved questions, and follow-up suggestions.
5. Extract code records, configuration names, environment variable names, CI steps, and command examples.
6. Use `原文未明确` for missing or uncertain values.
7. Do not copy secrets. Replace sensitive values with `<REDACTED>`.

## Expected Output

Include a Markdown section named:

```markdown
## 重要信息提取
```

Use compact tables when the source contains enough structure.
