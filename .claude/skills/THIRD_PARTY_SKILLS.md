# Third-Party Skill References

This project uses a controlled, local-vendored approach for third-party Skill ideas.

No third-party scripts are downloaded or executed in CI. Public GitHub and ClawHub resources are used as design references, then rewritten as local `.claude/skills/*/SKILL.md` instructions that can be reviewed in git.

## References

| Source | Local Skill | Purpose |
|---|---|---|
| `anthropics/skills` | all `.claude/skills/*/SKILL.md` | Project-level Skill layout and metadata style |
| ClawHub Converter / Markdown.new patterns | `file-conversion-router` | File conversion and extraction routing |
| ClawHub Markdown to HTML / Markdown Toolkit patterns | `html-output`, `interactive-html-artifact`, `markdown-roundtrip` | Markdown to HTML artifact and roundtrip editing |
| Public HTML artifact patterns | `interactive-html-artifact` | Browser-viewable AI output |
| Public walkthrough patterns | `interactive-walkthrough`, `workflow-diagram` | Mermaid diagrams and workflow explanations |
| ClawHub Skill Writer / Skill from Memory patterns | `skill-writer`, `skill-creator` | Generate safe reusable Skills from requirements |

## Safety Rules

1. Do not execute third-party Skill scripts directly in GitHub Actions.
2. Do not grant third-party Skills access to API keys, GitHub tokens, cookies, private keys, or account credentials.
3. Review every local `SKILL.md` before relying on it in CI.
4. Keep Markdown as the source of truth and HTML as a generated companion artifact.
