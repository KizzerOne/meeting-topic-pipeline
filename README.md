# AI Chat PDF Summary Workflow

这个仓库用于接收 AI 聊天或会议记录文件，并通过 GitHub Actions 自动生成中文 Summary。

## 目录约定

- 提交原始文件到 `input-files/`
- 支持格式：`.pdf`、`.txt`、`.md`、`.csv`、`.json`、`.log`
- 文件名建议使用 `成员名_日期.ext`，例如：`张三_2026-05-08.pdf`
- 生成结果会写入 `pdf-chat-summaries/`

## GitHub Secrets

在 GitHub 仓库页面设置：

1. `Settings` -> `Secrets and variables` -> `Actions`
2. 新增 Repository secret：`OPENAI_API_KEY`
3. 值填写你的 OpenAI 或 DeepSeek API Key

可选变量：

- `OPENAI_BASE_URL`：DeepSeek 使用 `https://api.deepseek.com`
- `OPENAI_MODEL`：默认由 workflow 使用 `deepseek-v4-flash`
- `TAVILY_API_KEY`：Topic 外扩检索（见 `config/tavily_domain_profiles.json`）

## 本地脚本

```bash
npm install
cp .env.example .env   # 填入 OPENAI_API_KEY、TAVILY_API_KEY
npm run clean:artifacts
npm run bootstrap:ontology   # 生成 topic-ontology/ontology.json
npm start -- --publish-docs-only
```

## 目录（重构后）

| 路径 | 说明 |
|------|------|
| `src/` | 流水线代码（`constants.js`、提取与摘要） |
| `topic-ontology/` | LLM 驱动的 Topic 树（冷启动见 bootstrap） |
| `config/` | 模型与 Tavily 领域白名单 |
| `scripts/` | `clean-artifacts`、`bootstrap-topic-ontology` |
| `input-files/` | 原始输入（大文件/录音建议放 `archive/`） |
| `archive/` | 本地归档（不进 Git） |
| `pdf-chat-summaries/`、`docs/` | 生成产物（默认不进 Git，由 CI 发布） |

## 自动流程

当有人向 `input-files/` 提交支持格式的文件时，GitHub Actions 会：

1. 检查文件格式和可读取性
2. 读取文件文本；PDF 没有内嵌文字时会自动 OCR
3. 让 DeepSeek 总结内容并生成适合归档的输出文件名
4. 生成本次处理的汇总 PDF、metadata JSON 和 zip 归档
5. 把处理结果提交回 GitHub 仓库的 `pdf-chat-summaries/`

单个文件的 Summary 文件名由 DeepSeek 根据内容总结生成，例如可能输出 `张三_项目复盘_2026-05-08.md` 和 `张三_项目复盘_2026-05-08.pdf`。

## 本地运行

```bash
npm install
cp .env.example .env
npm start -- --input-dir input-files --out-dir outputs
```

也可以只处理某些文件：

```bash
npm start -- --input "input-files/张三_2026-05-08.pdf" --out-dir outputs
```
