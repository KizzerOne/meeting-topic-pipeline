import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, options } from './context.js';
import { replaceExtension, sanitizeFileBaseName, toBrowserPath } from './lib/paths.js';
import { writeGeneratedHtml } from './lib/html.js';
import { loadSkillInstructions, formatSkillPromptBlock } from './lib/skills.js';
import { listMarkdownFiles } from './lib/io.js';
import { summarizeVisualHtml } from './lib/summarize.js';
import { cleanGeneratedMarkdown, parseJsonObject } from './lib/text.js';
import {
  buildTopicGuideMarkdown,
  listMeetingKnowledgeTopics,
  loadOntology
} from './lib/ontology.js';

export async function updateMeetingKnowledge(client, model) {
  const meetingRoot = path.resolve(projectRoot, options.meetingSummaryRoot);
  const summaryFiles = (await listMarkdownFiles(meetingRoot))
    .filter((filePath) => !path.basename(filePath).startsWith(options.summaryName));
  const outputDir = path.resolve(projectRoot, options.meetingKnowledgeDir);
  const modulesDir = path.join(outputDir, 'modules');
  await fs.mkdir(modulesDir, { recursive: true });

  if (summaryFiles.length === 0) {
    console.log('No generated summary Markdown files found. Meeting knowledge update skipped.');
    return outputDir;
  }

  const sources = [];
  for (const filePath of summaryFiles) {
    const markdown = await fs.readFile(filePath, 'utf8');
    sources.push([
      `--- Source: ${toBrowserPath(path.relative(projectRoot, filePath))} ---`,
      markdown.slice(0, 12000)
    ].join('\n'));
  }

  const skillInstructions = await loadSkillInstructions([
    'meeting-overall-summary',
    'meeting-module-router',
    'meeting-module-summary',
    'kpit-topic-knowledge',
    'kpit-demo-pages',
    'document-format'
  ]);
  const ontology = await loadOntology(options.ontologyPath, projectRoot);
  const ontologyTopics = listMeetingKnowledgeTopics(ontology);
  const topicGuide = buildTopicGuideMarkdown(ontologyTopics);
  const ontologyNote = ontology
    ? `- Topic 列表来自 \`topic-ontology/ontology.json\`（${ontologyTopics.length} 个模块，promote 阈值 ${ontology.promote_threshold ?? 0.9}）。`
    : '- Topic 列表来自内置 fallback（ontology.json 未找到）。';
  const prompt = [
    '请根据以下多份会议记录摘要，生成一个持续更新的会议知识库。',
    '',
    formatSkillPromptBlock(skillInstructions),
    '',
    '输出必须是严格 JSON，不要包裹 Markdown 代码块。格式如下：',
    '{"overall":"总览 Markdown","modules":[{"name":"功能模块名称","summary":"该模块 Markdown"}]}',
    '',
    '要求：',
    ontologyNote,
    '- overall 是所有会议的总 summary，面向项目管理和交接。',
    '- modules 必须按 Topic/功能模块聚合，不按单次会议日期堆叠。',
    '- 优先使用以下 ontology 驱动 Topic 名称；没有信息的 Topic 也要保留，并写“原文未明确”：',
    topicGuide,
    '- 每个 Topic Markdown 必须包含：Topic 目标、相关会议、当前状态、已确认事项、待办事项、负责人、时间表、风险问题、Demo 影响、最近变化。',
    '- GitHub Pages 相关内容必须清楚回答：现在做到哪了、下一步做什么、谁负责、什么时候交付、有什么问题。',
    '- Demo 路线图必须优先沉淀 5 月底目标、时间表、任务分配、当前状态和风险。',
    '- 对明显新增、变更、风险内容使用 HTML 标记突出：<span class="change-new">新增：...</span>、<span class="change-updated">变化：...</span>、<span class="change-risk">风险：...</span>。',
    '- 如果出现固定 Topic 外的重要内容，可以额外加入“项目通用事项”。',
    '- 不要编造原文没有的负责人、日期、结论；不明确写“原文未明确”。',
    '- 不要输出 API Key、账号密码、Token、Cookie 等敏感信息。',
    '',
    '会议摘要来源：',
    sources.join('\n\n')
  ].join('\n');

  const response = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你是中文会议知识库整理助手，负责把多次会议记录沉淀为总览和按功能模块维护的 Markdown 文档。' },
      { role: 'user', content: prompt }
    ]
  });

  const raw = response.choices?.[0]?.message?.content || '{}';
  const parsed = parseJsonObject(raw);
  const overall = cleanGeneratedMarkdown(parsed.overall || '# 会议总览\n\n原文未明确。');
  const modules = Array.isArray(parsed.modules) ? parsed.modules : [];

  await fs.rm(modulesDir, { recursive: true, force: true });
  await fs.mkdir(modulesDir, { recursive: true });

  const overallPath = path.join(outputDir, 'overall-summary.md');
  await fs.writeFile(overallPath, overall, 'utf8');
  await writeGeneratedHtml(
    replaceExtension(overallPath, '.html'),
    await summarizeVisualHtml(client, {
      sourceText: overall,
      markdownSummary: overall,
      model,
      originalFileName: path.basename(overallPath),
      sourceKind: 'meeting-knowledge-overall'
    }).catch((error) => {
      console.warn(`AI visual HTML generation failed for ${overallPath}: ${error.message}`);
      return '';
    }),
    '会议总览',
    overall,
    overallPath
  );

  const indexRows = [];
  for (const item of modules) {
    const name = sanitizeFileBaseName(item?.name || '未命名模块') || 'module';
    const markdown = cleanGeneratedMarkdown(item?.summary || `# ${name}\n\n原文未明确。`);
    const modulePath = path.join(modulesDir, `${name}.md`);
    await fs.writeFile(modulePath, markdown, 'utf8');
    await writeGeneratedHtml(
      replaceExtension(modulePath, '.html'),
      await summarizeVisualHtml(client, {
        sourceText: markdown,
        markdownSummary: markdown,
        model,
        originalFileName: path.basename(modulePath),
        sourceKind: 'meeting-knowledge-module'
      }).catch((error) => {
        console.warn(`AI visual HTML generation failed for ${modulePath}: ${error.message}`);
        return '';
      }),
      `${name} 模块会议知识`,
      markdown,
      modulePath
    );
    indexRows.push(`| [${name}](modules/${encodeURI(name)}.md) | [HTML](modules/${encodeURI(name)}.html) |`);
  }

  const indexMarkdown = [
    '# 会议知识库索引',
    '',
    `更新时间：${new Date().toISOString()}`,
    '',
    '## 总览',
    '',
    '- [会议总览 Markdown](overall-summary.md)',
    '- [会议总览 HTML](overall-summary.html)',
    '',
    '## 功能模块',
    '',
    '| 模块 | 网页 |',
    '|---|---|',
    ...indexRows
  ].join('\n');
  const indexPath = path.join(outputDir, 'index.md');
  await fs.writeFile(indexPath, indexMarkdown, 'utf8');
  await writeGeneratedHtml(
    replaceExtension(indexPath, '.html'),
    await summarizeVisualHtml(client, {
      sourceText: indexMarkdown,
      markdownSummary: indexMarkdown,
      model,
      originalFileName: path.basename(indexPath),
      sourceKind: 'topic-navigation'
    }).catch((error) => {
      console.warn(`AI visual HTML generation failed for ${indexPath}: ${error.message}`);
      return '';
    }),
    '会议知识库索引',
    indexMarkdown,
    indexPath
  );
  return outputDir;
}
