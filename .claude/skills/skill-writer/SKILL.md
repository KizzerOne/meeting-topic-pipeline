---
name: skill-writer
description: Write and review high-quality SKILL.md files with clear frontmatter, trigger descriptions, instructions, examples, and safe boundaries.
---

# Skill Writer

## Purpose

Use this skill when creating or reviewing `SKILL.md` files for project-level agent skills.

Inspired by ClawHub Skill Writer and Skill from Memory patterns.

## Instructions

1. Use YAML frontmatter with `name` and `description`.
2. Make `name` lowercase and hyphenated.
3. Make `description` trigger-oriented: explain what the skill does and when to use it.
4. Keep instructions procedural and reusable.
5. Avoid one-off logs, temporary notes, or generated summaries in Skill definitions.
6. Include expected outputs when useful.
7. Do not include secrets, credentials, tokens, cookies, private keys, or real account identifiers.
8. Prefer concise, durable guidance over long transcripts.

## Expected Output

A complete, safe, reusable `SKILL.md`.
