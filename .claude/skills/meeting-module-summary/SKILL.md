---
name: meeting-module-summary
description: Maintain one Markdown document per feature module from ongoing meeting summaries.
---

# 功能模块会议文档

用于为每个功能模块生成一个可持续更新的 Markdown 文件。**所有 Topic 必须使用同一套章节模板。**

## 固定章节顺序（不得增删改标题）

每个模块 `summary` 必须按顺序包含以下 `##` 二级标题：

1. `## 一句话摘要`
2. `## 模块目标`
3. `## 相关会议`
4. `## 当前状态`
5. `## 已确认事项`（Markdown 表格：事项｜确认结果）
6. `## 待办事项`（Markdown 表格：任务｜负责人｜截止时间｜优先级）
7. `## 负责人与时间表`（Markdown 表格：事项｜负责人｜截止时间｜状态）
8. `## 风险或未解决问题`（列表，可用 change-risk 标记）
9. `## Demo 影响`
10. `## 最近变化`（列表，可用 change-new / change-updated 标记）

## 写作要求

- 使用中文 Markdown。
- 无信息的章节写「原文未明确」，但章节本身不能省略。
- 不要写空话，不要重复整段原始会议内容。
- 负责人、时间、状态缺失时写「原文未明确」。
- HTML 输出由统一模板生成，不要自行设计页面结构。
