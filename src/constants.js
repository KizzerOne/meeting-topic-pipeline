export const textExtensions = new Set(['.txt', '.md', '.csv', '.json', '.jsonl', '.log']);

export const markitdownExtensions = new Set([
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.xls',
  '.html',
  '.htm',
  '.xml',
  '.rss',
  '.atom',
  '.epub',
  '.ipynb',
  ...textExtensions
]);

export const imageExtensions = new Set(['.png', '.jpg', '.jpeg']);
export const modelExtensions = new Set(['.step', '.stp', '.stl', '.obj', '.sldprt', '.sldasm']);
export const viewableModelExtensions = new Set(['.step', '.stp', '.stl', '.obj']);
export const archiveExtensions = new Set(['.zip']);
export const sidecarExtensions = new Set([...markitdownExtensions]);
export const supportedExtensions = new Set([
  ...markitdownExtensions,
  ...imageExtensions,
  ...modelExtensions,
  ...archiveExtensions
]);

export const clawhubMarkdownMaxBytes = 9.5 * 1024 * 1024;

/** Fixed basename when --output-by-input-name is used (CI default path). */
export const CANONICAL_SUMMARY_BASE = 'summary';

/** Sidecar filename for topic hints and suggested titles (replaces legacy *.metadata.json). */
export const TOPIC_SIDECAR_NAME = 'topic_candidates.json';

/** Fixed section order for meeting-knowledge Topic module pages (Markdown + HTML). */
export const TOPIC_MODULE_SECTIONS = [
  { title: '一句话摘要', fallback: '原文未明确。' },
  { title: '模块目标', aliases: ['Topic 目标'], fallback: '原文未明确。' },
  { title: '相关会议', aliases: ['相关会议来源'], fallback: '- 原文未明确' },
  { title: '当前状态', fallback: '原文未明确。' },
  {
    title: '已确认事项',
    fallback: '| 事项 | 确认结果 |\n|------|----------|\n| 原文未明确 | 原文未明确 |'
  },
  {
    title: '待办事项',
    fallback: '| 任务 | 负责人 | 截止时间 | 优先级 |\n|------|--------|----------|--------|\n| 原文未明确 | 原文未明确 | 原文未明确 | 原文未明确 |'
  },
  {
    title: '负责人与时间表',
    fallback: '| 事项 | 负责人 | 截止时间 | 状态 |\n|------|--------|----------|------|\n| 原文未明确 | 原文未明确 | 原文未明确 | 原文未明确 |'
  },
  {
    title: '风险或未解决问题',
    aliases: ['风险问题', '风险与问题'],
    fallback: '- 原文未明确'
  },
  { title: 'Demo 影响', fallback: '原文未明确。' },
  { title: '最近变化', fallback: '- 原文未明确' }
];

/** @deprecated Fallback when ontology.json is missing; prefer topic-ontology/ontology.json. */
export const kpitMeetingTopics = [
  { name: '机械臂控制', scope: '真实机械臂接口、坐标格式、夹具、误差、移动策略' },
  { name: '仿真机械臂', scope: '仿真环境、不可达区域、路径规划、开环控制' },
  { name: 'VLM 测试点定位', scope: '原理图、位号图、实物图、测试点识别' },
  { name: 'GitHub CI Pages', scope: '上传、转换、CI、Markdown、HTML、Pages 发布' },
  { name: 'Demo 路线图', scope: '5 月底目标、时间表、任务分配' },
  { name: '模型 Benchmark', scope: '模型选择、前处理、数据集、评分指标' }
];

export const PM_L2_BRANCHES = [
  { id: 'scope', label: '范围与交付物' },
  { id: 'schedule', label: '进度与里程碑' },
  { id: 'resource_cost', label: '资源与成本' },
  { id: 'quality', label: '质量' },
  { id: 'risk_issues', label: '风险与问题' },
  { id: 'stakeholders', label: '干系人与责任' },
  { id: 'communications', label: '沟通与协作' },
  { id: 'change_decisions', label: '变更与决策' }
];

export const zh = {
  invalidName: '成员名_YYYY-MM-DD',
  system:
    '你是严谨的中文会议和聊天记录分析助手。只基于原文总结，不编造原文没有的信息。输出严格 JSON，不要包裹 Markdown 代码块。OCR 原文可能包含乱码、方框或断行噪声，请只保留能确认的语义。',
  promptIntro: '请总结以下聊天或会议记录。',
  fileName: '文件名',
  jsonShape:
    '请只返回 JSON，格式为：{"fileName":"适合归档的中文文件名，不带扩展名","summary":"Markdown 摘要"}',
  requirements: `要求：
- fileName 由你根据内容总结得出，优先采用“主题_日期”或“人名_日期”。
- fileName 不要包含 / \\ : * ? " < > | 等文件名非法字符。
- summary 必须是结构清晰、便于归档的中文 Markdown，不要写空话，不要重复原文。
- summary 必须按以下顺序输出这些二级标题：
## 一句话结论
用 1-2 句话说明这份记录最重要的结论、结果或核心主题。
## 总体概览
用 3-5 条项目符号概括背景、参与方、主要议题和整体进展。
## 关键讨论点
用 Markdown 表格输出，列为：序号｜议题｜主要内容｜相关人员｜结论或状态。
## 已确认事项
用 Markdown 表格输出，列为：事项｜确认结果｜依据/备注。没有则写“未提及”。
## 待办事项
用 Markdown 表格输出，列为：任务｜负责人｜截止时间｜优先级｜备注。负责人、截止时间或优先级未提及时写“未提及”。
## 风险或未解决问题
用 Markdown 表格输出，列为：问题｜影响｜建议跟进。没有则写“未提及”。
## 简短时间线
按时间顺序列出关键节点；没有明确时间时，按对话推进顺序概括。
- 不要输出乱码、方框符号、OCR 残留字符或无法确认的片段。
- 只基于原文能确认的信息总结；不确定的信息必须标注“原文未明确”。`,
  content: '记录内容',
  archiveTitle: 'AI 聊天记录 Summary 汇总',
  generatedAt: '生成时间',
  processedCount: '处理文件数',
  outputIndex: '输出索引',
  originalFile: '原始文件',
  generatedBaseName: '归档名称',
  markdownFile: 'Markdown 摘要',
  htmlFile: 'HTML 摘要',
  defaultSummary: '未生成摘要。'
};

export const inputNamePattern = /^[^_\\/:*?"<>|]+_\d{4}-\d{2}-\d{2}\.[^.]+$/u;

export const workflowSummaryRequirements = [
  'Additional workflow requirements:',
  '- Extract important information explicitly: tasks, time, people, conclusions, unresolved issues, and code or configuration records.',
  '- Include a section named "## 重要信息提取".',
  '- Include a section named "## 流程图".',
  '- In "## 流程图", output a Mermaid fenced code block using ```mermaid.',
  '- Also include a PlantUML fenced code block using ```plantuml when a process or sequence can be represented clearly.',
  '- The Mermaid graph should describe the workflow or decision flow confirmed by the source. If no workflow exists, show the document processing flow inferred from the source.',
  '- Keep all content based on the source. Use "原文未明确" when a value is not confirmed.'
].join('\n');

export const visualHtmlRequirements = [
  'Visual HTML output requirements:',
  '- Generate a separate complete HTML file. Do not simply convert Markdown into HTML.',
  '- The Markdown output is only for text archiving. The HTML output is a standalone visual webpage.',
  '- Output one full HTML document only, with <!doctype html>, html, head, body, inline CSS, and any needed inline SVG/Canvas/plain JavaScript.',
  '- Do not depend on external CDN assets, remote images, chart libraries, Mermaid, PlantUML, or Markdown renderers.',
  '- The page must include visible modules for: timeline, roadmap, flowchart, Gantt chart, model Benchmark comparison chart, radar chart, task owner cards, risk status table, and Topic navigation page.',
  '- If the source does not contain enough data for a module, keep the module visible and mark missing fields as "source not explicit".',
  '- Use a Feishu-style project-management visual language: clean white panels, fine borders, pale section backgrounds, compact tables, status tags, metric cards, kanban/task cards, and restrained color accents.',
  '- Build charts with inline SVG, CSS grids, or semantic HTML tables. The flowchart, timeline, roadmap, Gantt chart, Benchmark bars, and radar chart must be visible without extra tooling.',
  '- Use only facts confirmed by the source or the Markdown summary for key conclusions, dates, people, model names, scores, task owners, status, and risks.',
  '- Do not write API keys, tokens, cookies, private keys, account passwords, or other secrets.',
  '- Output HTML only. Do not output Markdown, explanations, or fenced code blocks.'
].join('\n');
