# Skill 目录说明

## 核心 Skills（保留）

| Skill | 用途 |
|-------|------|
| `document-format` | 摘要 Markdown 结构约束 |
| `html-output` | 视觉 HTML 输出规范 |
| `meeting-overall-summary` | 会议总览生成 |
| `meeting-module-router` | Topic 路由到模块 |
| `meeting-module-summary` | 单模块知识沉淀 |
| `kpit-topic-knowledge` | KPIT Topic 知识库（与 ontology 协同） |
| `kpit-demo-pages` | Demo 路线图页面 |
| `file-conversion-router` | 文档提取路由 |
| `important-info-extractor` | 重要信息表格提取 |
| `workflow-diagram` | Mermaid / PlantUML 流程图 |
| `llm-model-config` | 大模型配置记录 |
| `skill-creator` / `skill-writer` | 从需求生成新 Skill |

## 辅助 Skills（可选加载）

| Skill | 说明 |
|-------|------|
| `interactive-html-artifact` | HTML artifact 交互模式 |
| `interactive-walkthrough` | 分步讲解 |
| `markdown-roundtrip` | Markdown 往返编辑 |

## 计划合并 / 弱化

以下 Skill 与核心能力重叠，后续版本可能合并进 `topic-ontology-curator` 或 `external-knowledge-expand`：

- 无独立 `meeting-module-*` 替代品前，**暂不删除**，避免 CI prompt 断裂
- 新增外扩知识请优先扩展 `scripts/expand-topic-knowledge.js`，而非新增 Skill

## 已废弃产物

- `*.metadata.json` — 已由 `topic_candidates.json` 替代（见 `src/lib/sidecar.js`）
- 硬编码 6 Topic 列表 — 已由 `topic-ontology/ontology.json` 驱动
