---
name: meeting-module-router
description: Identify feature modules from meeting records and route relevant facts into module documents.
---

# 会议功能模块识别

用于从多份会议记录中识别“功能模块”，并判断每条信息应该进入哪个模块文档。

## 模块识别规则

- 模块应按产品或技术功能划分，不按日期、参会人或单次会议划分。
- 模块名称保持短、稳定、可复用。
- 常见模块示例：
  - 文件解析
  - 重要信息提取
  - 总结生成
  - 流程图生成
  - 网页生成
  - 网页编辑
  - Markdown 回写
  - GitHub Actions
  - GitHub Pages
  - Skills 管理
  - 大模型调用配置

## 路由规则

- 同一条会议事实可以进入多个模块，但不要重复堆砌无关内容。
- 无法归类的内容进入“项目通用事项”。
- 模块名称不明确时，从上下文归纳，但必须基于原文。
