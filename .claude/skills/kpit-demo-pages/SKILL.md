---
name: kpit-demo-pages
description: Build GitHub Pages-ready Markdown and HTML content for KPIT project roadmap, schedule, tasks, owners, status, risks, and demo goals.
---

# KPIT GitHub Pages 展示

用于生成适合 GitHub Pages 浏览的项目状态页面。

## Pages 重点展示

- 项目路线图
- 时间表
- 任务列表
- 负责人
- 当前状态
- 风险问题
- Demo 目标

## 写作要求

- 页面面向团队成员快速理解项目进展。
- 优先突出“5 月底 Demo 目标”和项目计划。
- `input-files/KPIT会议/` 的单次会议 summary 也要支持差异标记，方便团队看出本次会议相对历史记录新增或改变了什么。
- 明显新增目标、计划变更、风险阻塞必须用颜色标记：
  - `<span class="change-new">新增：...</span>`
  - `<span class="change-updated">变化：...</span>`
  - `<span class="change-risk">风险：...</span>`
- 每个页面都要结构清晰，标题稳定，适合转成 HTML。
- 对任务类信息优先使用表格：
  - 任务
  - 所属 Topic
  - 负责人
  - 截止时间
  - 当前状态
  - 风险/阻塞
- 不把会议原文整段复制进主页面；原文只作为追溯来源。
