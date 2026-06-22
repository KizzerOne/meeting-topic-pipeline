---
name: meeting-overall-summary
description: Generate a rolling project-level summary from many meeting records and generated summaries.
---

# 会议总览持续汇总

用于把多份会议记录或会议摘要合并成一个持续更新的项目总览 Markdown。

## 输出要求

- 输出中文 Markdown。
- 面向项目交接、复盘和管理，不按单次会议流水账重复。
- 必须覆盖：
  - 项目当前状态
  - 已确认结论
  - 关键功能模块
  - 重要待办
  - 风险与未解决问题
  - 最近变化
- 不明确的信息写“原文未明确”。
- 不输出 API Key、账号密码、Token、Cookie 等敏感信息。

## 合并规则

- 新会议内容优先更新旧结论。
- 如果新旧记录冲突，保留冲突说明，不直接覆盖为确定结论。
- 同类事项合并表达，避免重复列出相同待办。
