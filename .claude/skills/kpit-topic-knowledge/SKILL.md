---
name: kpit-topic-knowledge
description: Organize KPIT project meeting records into stable topic-based Markdown knowledge files instead of date-based meeting notes.
---

# KPIT Topic 知识库

用于把 KPIT 项目的会议记录按 Topic 持续沉淀，而不是按会议日期堆叠。

## 固定 Topic

| Topic | 内容范围 |
|---|---|
| 机械臂控制 | 真实机械臂接口、坐标格式、夹具、误差、移动策略 |
| 仿真机械臂 | 仿真环境、不可达区域、路径规划、开环控制 |
| VLM 测试点定位 | 原理图、位号图、实物图、测试点识别 |
| GitHub CI Pages | 上传、转换、CI、Markdown、HTML、Pages 发布 |
| Demo 路线图 | 5 月底目标、时间表、任务分配 |
| 模型 Benchmark | 模型选择、前处理、数据集、评分指标 |

## 输出原则

- 原始会议纪要可以保留用于追溯。
- 项目主文档必须按 Topic 组织。
- `input-files/KPIT会议/` 新上传文件生成单次会议 summary 时，也要与该会议输出目录中的历史 summary 对比。
- 单次会议 summary 中只有明显区别需要染色，不要整篇染色。
- 每次新增会议后，Topic 文档应突出明显变化：
  - `<span class="change-new">新增：...</span>`
  - `<span class="change-updated">变化：...</span>`
  - `<span class="change-risk">风险：...</span>`
- 每个 Topic 文件都要能回答：
  - 当前做到哪了
  - 下一步做什么
  - 谁负责
  - 什么时候交付
  - 有什么风险或问题
- 未提及的信息写“原文未明确”。
- 不输出账号、密码、Token、会议密码、API Key 等敏感信息。

## Tavily 外扩检索（include_domains 提质）

Topic 外部知识扩展使用 `config/tavily_domain_profiles.json` 中的领域白名单：

- **双轨检索**：开放全网 query + 带 `include_domains` 的权威域 query
- **全局排除**：`reddit.com`、`quora.com` 等低信噪比站点
- **领域 profile**：按 Topic 标签匹配 `robotics_simulation`、`vlm_perception`、`devops_platform`、`project_management` 等
- **PM 维度**：`pm_dimension_domains` 为范围/进度/风险等 L2 追加权威域
- 实现：`src/tavily-domains.js`（匹配与 query plan）、`src/tavily-search.js`（Search + Extract API）
