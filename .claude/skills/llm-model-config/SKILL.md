---
name: llm-model-config
description: Generate a Chinese Markdown record of large language model usage, configuration, inputs, outputs, and model switch history. Use when uploaded files contain LLM usage logs, model configuration notes, API call records, or conversations about model selection and configuration.
---

# LLM Model Config

## Purpose

Use this skill to create or update `skills/llm_model_config.md` from uploaded large language model usage records and related conversations.

## Required Markdown Structure

The document must use this title:

```markdown
# 大模型调用与配置记录
```

The document must contain these sections in this exact order:

```markdown
## 1. 用途
## 2. 输入
## 3. 输出
## 4. 操作步骤
## 5. config 文件示例
## 6. 模型切换记录表格
## 7. 注意事项
```

## Instructions

1. Read the uploaded source file content carefully.
2. Extract only information that is confirmed by the source content.
3. Write unclear or missing information as `原文未明确`.
4. Use Chinese Markdown.
5. Include a fenced `yaml` or `env` code block in `## 5. config 文件示例`.
6. Include a Markdown table in `## 6. 模型切换记录表格`.
7. Do not wrap the entire answer in a Markdown code block.
8. Do not leak API keys, passwords, tokens, cookies, private keys, account credentials, or other secrets.
9. Replace any sensitive value from the source with `<REDACTED>`.

## Output File

Write the result to:

```text
skills/llm_model_config.md
```
