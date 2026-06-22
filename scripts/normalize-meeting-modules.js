#!/usr/bin/env node
/**
 * Re-normalize existing meeting-knowledge module Markdown + HTML to unified template (no LLM).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeFileBaseName, toBrowserPath } from '../src/lib/paths.js';
import {
  buildFlexibleDocumentHtml,
  buildTopicKnowledgeIndexHtml,
  buildTopicModuleHtml,
  normalizeTopicModuleMarkdown
} from '../src/lib/topic-template.js';

const projectRoot = process.cwd();
const knowledgeDir = path.join(projectRoot, 'meeting-knowledge');
const modulesDir = path.join(knowledgeDir, 'modules');

async function listModuleMarkdownFiles() {
  const entries = await fs.readdir(modulesDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(modulesDir, e.name));
}

async function main() {
  const modulePaths = await listModuleMarkdownFiles();
  if (modulePaths.length === 0) {
    console.log('No module markdown files found.');
    return;
  }

  const updatedAt = new Date().toISOString();
  const normalizedModules = [];

  for (const modulePath of modulePaths) {
    const fileName = path.basename(modulePath, '.md');
    const displayName = fileName.replace(/_/g, ' ');
    const raw = await fs.readFile(modulePath, 'utf8');
    const markdown = normalizeTopicModuleMarkdown(displayName, raw);
    await fs.writeFile(modulePath, markdown, 'utf8');
    normalizedModules.push({ name: displayName, fileName, status: 'stable' });
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
    console.log(`Normalized: ${item.name}`);
  }

  const overallPath = path.join(knowledgeDir, 'overall-summary.md');
  try {
    const overallRaw = await fs.readFile(overallPath, 'utf8');
    await fs.writeFile(
      path.join(knowledgeDir, 'overall-summary.html'),
      buildFlexibleDocumentHtml({
        topicName: '会议总览',
        markdown: overallRaw,
        moduleLinks,
        markdownPath: toBrowserPath(path.relative(projectRoot, overallPath)),
        updatedAt
      }),
      'utf8'
    );
  } catch {
    console.warn('overall-summary.md not found, skipped.');
  }

  const indexPath = path.join(knowledgeDir, 'index.md');
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
  await fs.writeFile(indexPath, indexMarkdown, 'utf8');
  await fs.writeFile(
    path.join(knowledgeDir, 'index.html'),
    buildTopicKnowledgeIndexHtml({ modules: normalizedModules, updatedAt }),
    'utf8'
  );

  console.log(`Done. ${normalizedModules.length} modules normalized with unified template.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
