import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, options } from './context.js';
import { replaceExtension, sanitizeFileBaseName, toBrowserPath } from './lib/paths.js';
import { loadSkillInstructions, formatSkillPromptBlock } from './lib/skills.js';
import { listMarkdownFiles } from './lib/io.js';
import { cleanGeneratedMarkdown, parseJsonObject } from './lib/text.js';
import {
  buildTopicGuideMarkdown,
  listMeetingKnowledgeTopics,
  loadOntology
} from './lib/ontology.js';
import { TOPIC_MODULE_SECTIONS } from './constants.js';
import {
  buildFlexibleDocumentHtml,
  buildTopicKnowledgeIndexHtml,
  buildTopicModuleHtml,
  normalizeTopicModuleMarkdown
} from './lib/topic-template.js';

function buildModuleSectionSpecPrompt() {
  return TOPIC_MODULE_SECTIONS.map((section, index) => {
    const aliasNote = section.aliases?.length ? `（同义：${section.aliases.join('、')}）` : '';
    return `${index + 1}. ## ${section.title}${aliasNote}`;
  }).join('\n');
}

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
  const sectionSpec = buildModuleSectionSpecPrompt();
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
    '- 优先使用以下 ontology 驱动 Topic 名称；没有信息的 Topic 也要保留：',
    topicGuide,
    '- 每个 Topic 的 summary Markdown 必须严格按以下二级标题顺序输出（缺一不可，无信息写“原文未明确”）：',
    sectionSpec,
    '- 待办事项、负责人与时间表必须使用 Markdown 表格。',
    '- 已确认事项必须使用 Markdown 表格（列：事项｜确认结果）。',
    '- GitHub Pages 需回答：现在做到哪了、下一步做什么、谁负责、什么时候交付、有什么问题。',
    '- Demo 路线图 Topic 的 Demo 影响章节需写清 5 月底/6 月底目标与阻塞。',
    '- 对明显新增、变更、风险使用 HTML 标记：<span class="change-new">新增：...</span>、<span class="change-updated">变化：...</span>、<span class="change-risk">风险：...</span>。',
    '- 不要编造原文没有的负责人、日期、结论。',
    '- 不要输出 API Key、账号密码、Token、Cookie 等敏感信息。',
    '',
    '会议摘要来源：',
    sources.join('\n\n')
  ].join('\n');

  const response = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你是中文会议知识库整理助手。每个 Topic 模块必须使用完全相同的章节模板，只填内容不改标题。' },
      { role: 'user', content: prompt }
    ]
  });

  const raw = response.choices?.[0]?.message?.content || '{}';
  const parsed = parseJsonObject(raw);
  const overall = cleanGeneratedMarkdown(parsed.overall || '# 会议总览\n\n原文未明确。');
  const modules = Array.isArray(parsed.modules) ? parsed.modules : [];
  const updatedAt = new Date().toISOString();

  await fs.rm(modulesDir, { recursive: true, force: true });
  await fs.mkdir(modulesDir, { recursive: true });

  const overallPath = path.join(outputDir, 'overall-summary.md');
  await fs.writeFile(overallPath, overall, 'utf8');
  await fs.writeFile(
    replaceExtension(overallPath, '.html'),
    buildFlexibleDocumentHtml({
      topicName: '会议总览',
      markdown: overall,
      moduleLinks: modules.map((m) => ({ name: m?.name || '模块' })),
      markdownPath: toBrowserPath(path.relative(projectRoot, overallPath)),
      updatedAt
    }),
    'utf8'
  );

  const normalizedModules = [];
  for (const item of modules) {
    const name = sanitizeFileBaseName(item?.name || '未命名模块') || 'module';
    const rawMarkdown = cleanGeneratedMarkdown(item?.summary || `# ${name}\n\n原文未明确。`);
    const markdown = normalizeTopicModuleMarkdown(name.replace(/_/g, ' '), rawMarkdown);
    const modulePath = path.join(modulesDir, `${name}.md`);
    await fs.writeFile(modulePath, markdown, 'utf8');
    normalizedModules.push({
      name: name.replace(/_/g, ' '),
      fileName: name,
      status: ontologyTopics.find((t) => t.name.replace(/\s/g, '_') === name || t.name === name.replace(/_/g, ' '))?.status || 'stable'
    });
  }

  const moduleLinks = normalizedModules.map((m) => ({ name: m.name }));
  for (const item of normalizedModules) {
    const modulePath = path.join(modulesDir, `${item.fileName}.md`);
    const markdown = await fs.readFile(modulePath, 'utf8');
    await fs.writeFile(
      path.join(modulesDir, `${item.fileName}.html`),
      buildTopicModuleHtml({
        topicName: item.name,
        markdown,
        moduleLinks,
        markdownPath: toBrowserPath(path.relative(projectRoot, modulePath)),
        updatedAt
      }),
      'utf8'
    );
  }

  const indexRows = normalizedModules.map((item) =>
    `| [${item.name}](modules/${encodeURI(item.fileName)}.md) | [HTML](modules/${encodeURI(item.fileName)}.html) |`
  );
  const indexMarkdown = [
    '# 会议知识库索引',
    '',
    `更新时间：${updatedAt}`,
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
  await fs.writeFile(
    replaceExtension(indexPath, '.html'),
    buildTopicKnowledgeIndexHtml({ modules: normalizedModules, updatedAt }),
    'utf8'
  );
  return outputDir;
}
