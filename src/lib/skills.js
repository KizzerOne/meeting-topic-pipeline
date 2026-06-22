import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, options } from '../context.js';
import { toBrowserPath, sanitizeSkillName } from './paths.js';
import { maskSensitiveContent, stripMarkdownFence } from './text.js';
import { writeSummaryHtml } from './html.js';

export async function loadSkillInstructions(skillNames) {
  const skillsRoot = path.resolve(projectRoot, options.skillsDir);
  const loaded = [];

  for (const skillName of skillNames) {
    const skillPath = path.join(skillsRoot, skillName, 'SKILL.md');
    const content = await fs.readFile(skillPath, 'utf8').catch((error) => {
      console.warn(`Skill not loaded: ${skillName} (${error.message})`);
      return '';
    });
    if (!content.trim()) continue;
    loaded.push({ name: skillName, content: content.trim() });
  }

  return loaded;
}

export function formatSkillPromptBlock(skills) {
  if (!skills?.length) return 'Skills: 未加载。';
  return [
    '请遵循以下项目 Skills 指令：',
    '',
    ...skills.map((skill) => [
      `--- Skill: ${skill.name} ---`,
      skill.content
    ].join('\n'))
  ].join('\n\n');
}

export async function writeSkillsHtmlSite() {
  const skills = await listProjectSkills();
  if (skills.length === 0) return '';

  const outputDir = path.resolve(projectRoot, options.skillsHtmlDir);
  await fs.mkdir(outputDir, { recursive: true });

  const rows = [];
  for (const skill of skills) {
    const htmlFileName = `${skill.name}.html`;
    const markdown = buildSkillMarkdown(skill);
    await writeSummaryHtml(path.join(outputDir, htmlFileName), markdown, `${skill.name} Skill`);
    rows.push(`| [${skill.name}](${htmlFileName}) | ${skill.description || '未提供'} | ${skill.relativePath} |`);
  }

  const indexMarkdown = [
    '# AI Skills 网页目录',
    '',
    '本页面由 CI 根据 `.claude/skills/*/SKILL.md` 自动生成，用于展示当前项目已接入的 Agent Skills。',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '## Skills 清单',
    '',
    '| Skill | 用途 | 源文件 |',
    '|---|---|---|',
    ...rows,
    '',
    '## CI 调用说明',
    '',
    '- `document-format`：用于约束普通摘要和文档输出格式。',
    '- `llm-model-config`：用于根据上传的大模型使用记录生成 `skills/llm_model_config.md`。',
    '- `html-output`：用于约束 Markdown 到 HTML 的网页输出。'
  ].join('\n');

  await fs.writeFile(path.join(outputDir, 'index.md'), indexMarkdown, 'utf8');
  await writeSummaryHtml(path.join(outputDir, 'index.html'), indexMarkdown, 'AI Skills 网页目录');
  return outputDir;
}

export async function listProjectSkills() {
  const skillsRoot = path.resolve(projectRoot, options.skillsDir);
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
    const content = await fs.readFile(skillPath, 'utf8').catch(() => '');
    if (!content.trim()) continue;
    const metadata = parseSkillMarkdown(content);
    skills.push({
      name: metadata.name || entry.name,
      description: metadata.description || '',
      body: metadata.body,
      relativePath: toBrowserPath(path.relative(projectRoot, skillPath))
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function parseSkillMarkdown(content) {
  const normalized = String(content || '').trim();
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u);
  if (!match) {
    return { name: '', description: '', body: normalized };
  }

  const frontmatter = match[1];
  const body = match[2].trim();
  return {
    name: readYamlScalar(frontmatter, 'name'),
    description: readYamlScalar(frontmatter, 'description'),
    body
  };
}

export function readYamlScalar(frontmatter, key) {
  const pattern = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'mu');
  const match = String(frontmatter || '').match(pattern);
  if (!match) return '';
  return match[1].replace(/^['"]|['"]$/g, '').trim();
}

export function normalizeSkillMarkdown(content, name, description) {
  const cleaned = maskSensitiveContent(stripMarkdownFence(content)).trim();
  const metadata = parseSkillMarkdown(cleaned);
  const finalName = sanitizeSkillName(metadata.name || name);
  const finalDescription = (metadata.description || description || `Use this skill for ${finalName}.`)
    .replace(/\r?\n/g, ' ')
    .trim();
  const body = metadata.body || `# ${finalName}

## Purpose

原文未明确。

## Instructions

1. Follow the uploaded requirements.

## Expected Output

原文未明确。`;

  return [
    '---',
    `name: ${finalName}`,
    `description: ${finalDescription}`,
    '---',
    '',
    body,
    ''
  ].join('\n');
}

export function buildSkillMarkdown(skill) {
  return [
    `# ${skill.name}`,
    '',
    '## Skill 信息',
    '',
    `- 名称：${skill.name}`,
    `- 描述：${skill.description || '未提供'}`,
    `- 源文件：${skill.relativePath}`,
    '',
    '## Skill 内容',
    '',
    skill.body || '未提供'
  ].join('\n');
}




