---
name: skill-creator
description: Create new project-level Claude/Agent Skills from uploaded requirements. Use when files in skill-inputs describe a new capability, workflow, output format, or AI behavior that should become .claude/skills/<skill-name>/SKILL.md.
---

# Skill Creator

## Purpose

Use this skill to turn uploaded requirements into a new project Skill.

## Output Rules

1. Generate exactly one complete `SKILL.md` document for each requested new skill.
2. Use this required structure:

```markdown
---
name: skill-name
description: Clear trigger-oriented description explaining what the skill does and when to use it.
---

# Skill Title

## Purpose

## Instructions

## Expected Output
```

3. The `name` must use lowercase letters, digits, and hyphens only.
4. The `description` must explain both what the skill does and when it should be used.
5. Keep the body concise and procedural.
6. Do not include API keys, passwords, tokens, cookies, private keys, or credentials.
7. Replace sensitive values with `<REDACTED>`.
8. Do not overwrite existing Skills unless explicitly requested.

## Output Location

Generated Skills should be written to:

```text
.claude/skills/<skill-name>/SKILL.md
```
