import fs from 'node:fs/promises';
import path from 'node:path';
import {
  zh,
  workflowSummaryRequirements,
  visualHtmlRequirements
} from '../constants.js';
import { projectRoot, options } from '../context.js';
import { expandArchiveInputs, pathExists } from './io.js';
import { extractInputContent } from './extract.js';
import { readImageAsDataUrl } from './archive.js';
import {
  cleanOcrText,
  cleanGeneratedMarkdown,
  parseSummaryResponse,
  parseJsonObject,
  stripMarkdownFence,
  maskSensitiveContent,
  hasRequiredLlmModelConfigSections,
  buildFallbackLlmModelConfig
} from './text.js';
import { loadSkillInstructions, formatSkillPromptBlock } from './skills.js';
import { writeSummaryHtml } from './html.js';
import { replaceExtension, sanitizeSkillName } from './paths.js';
import { cleanGeneratedHtml } from './html.js';

export async function summarizeInput(clients, inputContent, options, inputPath, archivedOriginal, viewerHtml, comparisonContext = '') {
  if (inputContent.kind === 'image') {
    const imageDataUrl = await readImageAsDataUrl(inputPath);
    const generated = await summarizeImage(clients.vision, imageDataUrl, options.visionModel, path.basename(inputPath));
    generated.htmlContent = await summarizeVisualHtml(clients.text, {
      sourceText: generated.summary,
      markdownSummary: generated.summary,
      model: options.model,
      originalFileName: path.basename(inputPath),
      sourceKind: 'image'
    }).catch((error) => {
      console.warn(`AI visual HTML generation failed for ${path.basename(inputPath)}: ${error.message}`);
      return '';
    });
    return generated;
  }
  if (inputContent.kind === 'model') {
    return buildNonDocumentDeliveryNote(inputPath, inputContent.kind, archivedOriginal, viewerHtml);
  }
  const originalFileName = path.basename(inputPath);
  const generated = await summarizeChat(clients.text, inputContent.text, options.model, originalFileName, comparisonContext);
  generated.htmlContent = await summarizeVisualHtml(clients.text, {
    sourceText: inputContent.text,
    markdownSummary: generated.summary,
    model: options.model,
    originalFileName,
    sourceKind: 'text'
  }).catch((error) => {
    console.warn(`AI visual HTML generation failed for ${originalFileName}: ${error.message}`);
    return '';
  });
  return generated;
}

export async function summarizeChat(client, text, model, originalFileName, comparisonContext = '') {
  const sourceText = cleanOcrText(text).slice(0, 50000);
  const skillInstructions = await loadSkillInstructions([
    'file-conversion-router',
    'important-info-extractor',
    'document-format',
    'workflow-diagram',
    'interactive-walkthrough'
  ]);
  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: zh.system },
      {
        role: 'user',
        content: `${zh.promptIntro}\n\n${formatSkillPromptBlock(skillInstructions)}\n\n${workflowSummaryRequirements}\n\n${comparisonContext}\n\n${zh.fileName}: ${originalFileName}\n\n${zh.jsonShape}\n\n${zh.requirements}\n\n${zh.content}:\n${sourceText}`
      }
    ]
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  const parsed = parseSummaryResponse(raw);
  return {
    fileName: parsed.fileName || path.basename(originalFileName, path.extname(originalFileName)),
    summary: cleanGeneratedMarkdown(parsed.summary || raw || zh.defaultSummary)
  };
}

export async function summarizeVisualHtml(client, { sourceText, markdownSummary, model, originalFileName, sourceKind }) {
  const sourceExcerpt = cleanOcrText(sourceText).slice(0, sourceKind === 'image' ? 12000 : 36000);
  const summaryExcerpt = cleanGeneratedMarkdown(markdownSummary).slice(0, 22000);
  const skillInstructions = await loadSkillInstructions([
    'html-output',
    'interactive-html-artifact',
    'workflow-diagram',
    'interactive-walkthrough'
  ]);
  const prompt = [
    visualHtmlRequirements,
    '',
    formatSkillPromptBlock(skillInstructions),
    '',
    `Source file: ${originalFileName}`,
    `Source kind: ${sourceKind}`,
    '',
    'Markdown text summary follows. Use it as the factual baseline, but do not render it as Markdown:',
    summaryExcerpt,
    '',
    'Source excerpt follows. Use it only to confirm dates, people, tasks, models, metrics, risks, and process details:',
    sourceExcerpt
  ].join('\n');

  const response = await client.chat.completions.create({
    model,
    temperature: 0.25,
    messages: [
      {
        role: 'system',
        content: 'You design Chinese project-management visual HTML pages. Return only one complete HTML document. Do not return Markdown. Do not explain. Use only source-confirmed facts.'
      },
      { role: 'user', content: prompt }
    ]
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  return cleanGeneratedHtml(raw, `${path.basename(originalFileName, path.extname(originalFileName))} Visual Summary`);
}

export async function generateLlmModelConfig(client, sources, model) {
  const skillInstructions = await loadSkillInstructions(['llm-model-config', 'document-format']);
  const sourceText = sources
    .map((source, index) => [
      `# Source ${index + 1}: ${path.basename(source.inputPath)}`,
      maskSensitiveContent(cleanOcrText(source.text).slice(0, 30000))
    ].join('\n\n'))
    .join('\n\n---\n\n')
    .slice(0, 60000);

  const prompt = [
    '请根据下面上传文件中的大模型使用记录及其对话，生成中文 Markdown 文档。',
    '',
    '必须严格满足：',
    '- 标题必须是：# 大模型调用与配置记录',
    '- 必须包含且只按以下顺序输出这些二级标题：',
    '  ## 1. 用途',
    '  ## 2. 输入',
    '  ## 3. 输出',
    '  ## 4. 操作步骤',
    '  ## 5. config 文件示例',
    '  ## 6. 模型切换记录表格',
    '  ## 7. 注意事项',
    '- config 文件示例必须使用 fenced code block，优先使用 yaml 或 env。',
    '- 模型切换记录必须使用 Markdown 表格。',
    '- 不要输出 Markdown 代码块包裹全文。',
    '- 不要写入真实 API Key、账号、密码、Token、Cookie、私钥或其它敏感信息；如果原文出现敏感值，替换为 <REDACTED>。',
    '- 只基于原文能确认的信息；原文未明确的信息写“原文未明确”。',
    '',
    formatSkillPromptBlock(skillInstructions),
    '',
    '上传文件内容：',
    sourceText
  ].join('\n');

  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文技术文档整理助手。你只输出合规 Markdown，不泄露任何密钥或账号密码。'
      },
      { role: 'user', content: prompt }
    ]
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  const markdown = maskSensitiveContent(cleanGeneratedMarkdown(stripMarkdownFence(raw)));
  if (hasRequiredLlmModelConfigSections(markdown)) return markdown;
  return buildFallbackLlmModelConfig(sources);
}

export async function collectTextSourcesFromInputs(inputPaths) {
  const sources = [];
  const tempDirs = [];

  try {
    const workItems = await expandArchiveInputs(inputPaths, tempDirs);
    for (const inputPath of workItems) {
      const inputContent = await extractInputContent(inputPath, options.ocrLang);
      if (inputContent.kind !== 'text') {
        console.warn(`Skipping non-document skill input: ${inputPath}`);
        continue;
      }
      sources.push({ inputPath, text: inputContent.text });
    }
  } finally {
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
  }

  return sources;
}

export async function processSkillInputs(client, inputPaths, model) {
  const sources = await collectTextSourcesFromInputs(inputPaths);

  if (sources.length === 0) {
    console.log('No text skill inputs found. Nothing to generate.');
    return;
  }

  if (!options.disableSkillCreation) {
    await generateProjectSkills(client, sources, model);
  }

  if (!options.disableLlmModelConfig) {
    await writeLlmModelConfig(client, sources, model);
  }
}

export async function writeLlmModelConfig(client, sources, model) {
  const llmConfigPath = path.resolve(projectRoot, options.llmModelConfigOutput);
  const llmConfigMarkdown = await generateLlmModelConfig(client, sources, model);
  await fs.mkdir(path.dirname(llmConfigPath), { recursive: true });
  await fs.writeFile(llmConfigPath, llmConfigMarkdown, 'utf8');
  await writeSummaryHtml(replaceExtension(llmConfigPath, '.html'), llmConfigMarkdown, '大模型调用与配置记录', llmConfigPath);
  console.log(`LLM model config: ${llmConfigPath}`);
  return llmConfigPath;
}

export async function generateProjectSkills(client, sources, model) {
  const generatedSkills = await createSkillsFromSources(client, sources, model);
  for (const generatedSkill of generatedSkills) {
    const name = sanitizeSkillName(generatedSkill.name);
    if (!name || !generatedSkill.content) continue;
    const skillPath = path.resolve(projectRoot, options.skillsDir, name, 'SKILL.md');
    if (await pathExists(skillPath)) {
      console.log(`Skill already exists, skipping: ${name}`);
      continue;
    }
    const content = normalizeSkillMarkdown(generatedSkill.content, name, generatedSkill.description);
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.writeFile(skillPath, content, 'utf8');
    console.log(`Generated skill: ${skillPath}`);
  }
}

export async function createSkillsFromSources(client, sources, model) {
  const skillInstructions = await loadSkillInstructions(['skill-creator', 'skill-writer', 'document-format']);
  const sourceText = sources
    .map((source, index) => [
      `# Source ${index + 1}: ${path.basename(source.inputPath)}`,
      maskSensitiveContent(cleanOcrText(source.text).slice(0, 30000))
    ].join('\n\n'))
    .join('\n\n---\n\n')
    .slice(0, 60000);

  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: 'You create safe project-level Claude/Agent Skills. Return strict JSON only.'
      },
      {
        role: 'user',
        content: [
          'Create project Skills from the uploaded requirements when the source clearly asks for reusable AI skills, workflows, output formats, or capabilities.',
          '',
          'Return strict JSON in this shape:',
          '{"skills":[{"name":"lowercase-hyphen-name","description":"trigger-oriented description","content":"complete SKILL.md content"}]}',
          '',
          'Rules:',
          '- If the source is only an LLM model usage/config record and does not request a new reusable skill, return {"skills":[]}.',
          '- Do not generate duplicate skills for html-output, llm-model-config, document-format, or skill-creator unless the source explicitly requests a different new skill.',
          '- The skill name must use lowercase letters, digits, and hyphens only.',
          '- Each content value must be a complete SKILL.md with YAML frontmatter containing name and description.',
          '- Do not include real secrets. Replace sensitive values with <REDACTED>.',
          '',
          formatSkillPromptBlock(skillInstructions),
          '',
          'Uploaded source content:',
          sourceText
        ].join('\n')
      }
    ]
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  const parsed = parseJsonObject(stripMarkdownFence(raw));
  if (!Array.isArray(parsed.skills)) return [];
  return parsed.skills
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      description: typeof item.description === 'string' ? item.description : '',
      content: typeof item.content === 'string' ? maskSensitiveContent(item.content) : ''
    }));
}

export async function buildNonDocumentDeliveryNote(filePath, kind, archivedOriginal, viewerHtml) {
  const stat = await fs.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const typeLabel = kind === 'image' ? '图片交付物' : '3D/CAD 模型交付物';
  const sections = [
    `# ${path.basename(filePath)}`,
    '',
    '## 交付物类型',
    typeLabel,
    '',
    '## 文件信息',
    `- 文件名: ${path.basename(filePath)}`,
    `- 格式: ${ext}`,
    `- 大小: ${stat.size} bytes`,
    `- 修改时间: ${stat.mtime.toISOString()}`,
    `- 原始文件归档: ${archivedOriginal ? path.join('original', path.basename(archivedOriginal)) : '未归档'}`
  ];

  if (viewerHtml) {
    sections.push('', '## 网页预览', `- Viewer: ${path.basename(viewerHtml)}`);
  }

  sections.push('', '## 说明', '该文件属于非文档类交付物，本系统不对其内容做 AI summary，仅完成类型标识和归档。');

  return {
    fileName: path.basename(filePath, ext),
    summary: sections.join('\n')
  };
}

export async function summarizeImage(client, imageDataUrl, model, originalFileName) {
  const skillInstructions = await loadSkillInstructions([
    'important-info-extractor',
    'document-format',
    'workflow-diagram',
    'interactive-walkthrough'
  ]);
  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: zh.system },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${zh.promptIntro}\n\n${formatSkillPromptBlock(skillInstructions)}\n\n${workflowSummaryRequirements}\n\n${zh.fileName}: ${originalFileName}\n\n${zh.jsonShape}\n\n${zh.requirements}\n\n请基于图片中可见的内容总结。图片可能是工程图、模型截图、零件照片、流程图、代码截图、配置截图或会议白板。提取可见文字、流程、结构、问题和结论。看不清或无法确认的信息必须写“原图未明确”。`
          },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUrl,
              detail: 'high'
            }
          }
        ]
      }
    ]
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  const parsed = parseSummaryResponse(raw);
  return {
    fileName: parsed.fileName || path.basename(originalFileName, path.extname(originalFileName)),
    summary: cleanGeneratedMarkdown(parsed.summary || raw || zh.defaultSummary)
  };
}

export function buildCombinedMarkdown(results, generatedAt) {
  const rows = results.map((item, index) => [
    index + 1,
    path.basename(item.input),
    item.generatedFileName,
    path.basename(item.summaryMarkdown),
    path.basename(item.summaryHtml),
    item.archivedOriginal ? path.join('original', path.basename(item.archivedOriginal)) : 'N/A',
    item.viewerHtml ? path.basename(item.viewerHtml) : 'N/A'
  ]);

  return [
    `# ${zh.archiveTitle}`,
    '',
    `${zh.generatedAt}: ${generatedAt.toISOString()}`,
    '',
    `${zh.processedCount}: ${results.length}`,
    '',
    `## ${zh.outputIndex}`,
    '',
    `| # | ${zh.originalFile} | ${zh.generatedBaseName} | ${zh.markdownFile} | ${zh.htmlFile} | Original | Viewer |`,
    '|---:|---|---|---|---|---|---|',
    ...rows.map((row) => `| ${row.join(' | ')} |`)
  ].join('\n');
}
