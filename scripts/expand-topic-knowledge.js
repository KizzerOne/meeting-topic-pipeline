#!/usr/bin/env node
/**
 * Expand external knowledge for emerging ontology topics via Tavily dual-track search.
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expandTopicExternalKnowledge } from '../src/tavily-search.js';
import {
  listEmergingTopics,
  loadOntology,
  walkOntologyNodes
} from '../src/lib/ontology.js';
import { sanitizeFileBaseName } from '../src/lib/paths.js';

const projectRoot = process.cwd();
const ontologyPath = process.env.ONTOLOGY_PATH || 'topic-ontology/ontology.json';
const externalDir = path.join(projectRoot, 'topic-ontology', 'external');
const reportPath = path.join(projectRoot, 'topic-ontology', 'external-expand-report.md');

function formatExternalMarkdown(topic, expansion) {
  const lines = [
    `# ${topic.label} — 外部知识`,
    '',
    `- 更新时间：${new Date().toISOString()}`,
    `- 状态：emerging（confidence ${topic.confidence}）`,
    `- 路径：${topic.path.join(' / ')}`,
    `- 匹配领域 profile：${(expansion.matched_profile_ids || []).join(', ') || '无'}`,
    ''
  ];

  if (expansion.search_batches?.some((batch) => batch.answer)) {
    lines.push('## Tavily 摘要', '');
    for (const batch of expansion.search_batches) {
      if (!batch.answer) continue;
      lines.push(`### ${batch.track}: ${batch.query}`, '', batch.answer, '');
    }
  }

  lines.push('## 检索结果（术语 / 最佳实践 / 竞品）', '');
  const topResults = (expansion.merged_results || []).slice(0, 12);
  if (topResults.length === 0) {
    lines.push('- 无高置信检索结果');
  } else {
    for (const item of topResults) {
      lines.push(`- [${item.title || item.url}](${item.url}) (score ${item.score.toFixed(2)}, ${item.source_track})`);
      if (item.content) lines.push(`  - ${item.content.slice(0, 240).replace(/\s+/g, ' ')}`);
    }
  }

  lines.push('', '## 抽取页面', '');
  const pages = expansion.extracted_pages || [];
  if (pages.length === 0) {
    lines.push('- 未抽取整页内容');
  } else {
    for (const page of pages.slice(0, 5)) {
      lines.push(`### ${page.url}`, '');
      lines.push((page.raw_content || '').slice(0, 2000) || '- 空内容');
      lines.push('');
    }
  }

  return lines.join('\n');
}

function attachExternalRefs(ontology, topicId, refs) {
  walkOntologyNodes(ontology.roots || [], (node) => {
    if (node.id !== topicId) return;
    node.external_refs = refs;
  });
}

async function main() {
  const ontology = await loadOntology(ontologyPath, projectRoot);
  if (!ontology) {
    console.error(`Ontology not found: ${ontologyPath}`);
    process.exitCode = 1;
    return;
  }

  if (!process.env.TAVILY_API_KEY) {
    console.log('TAVILY_API_KEY not configured; external knowledge expansion skipped.');
    return;
  }

  const emerging = listEmergingTopics(ontology);
  if (emerging.length === 0) {
    console.log('No emerging topics found. Nothing to expand.');
    return;
  }

  await fs.mkdir(externalDir, { recursive: true });
  const reportRows = [];
  let expandedCount = 0;

  for (const topic of emerging) {
    const slug = sanitizeFileBaseName(topic.label) || topic.id.slice(0, 8);
    const outPath = path.join(externalDir, `${slug}.md`);
    try {
      console.log(`Expanding: ${topic.path.join(' / ')}`);
      const expansion = await expandTopicExternalKnowledge(topic);
      const markdown = formatExternalMarkdown(topic, expansion);
      await fs.writeFile(outPath, markdown, 'utf8');

      const refs = (expansion.merged_results || []).slice(0, 8).map((item) => ({
        title: item.title,
        url: item.url,
        score: item.score,
        track: item.source_track
      }));
      attachExternalRefs(ontology, topic.id, refs);
      expandedCount += 1;
      reportRows.push(`| ${topic.label} | ${refs.length} | ${path.relative(projectRoot, outPath)} |`);
    } catch (error) {
      console.warn(`Expand failed for ${topic.label}: ${error.message}`);
      reportRows.push(`| ${topic.label} | error | ${error.message.slice(0, 80)} |`);
    }
  }

  ontology.updated_at = new Date().toISOString();
  ontology.external_knowledge_expanded_at = ontology.updated_at;
  await fs.writeFile(path.resolve(projectRoot, ontologyPath), `${JSON.stringify(ontology, null, 2)}\n`, 'utf8');

  const report = [
    '# External Knowledge Expansion Report',
    '',
    `- Generated: ${ontology.updated_at}`,
    `- Emerging topics: ${emerging.length}`,
    `- Expanded: ${expandedCount}`,
    '',
    '| Topic | Refs | Output |',
    '|---|---|---|',
    ...reportRows
  ].join('\n');
  await fs.writeFile(reportPath, report, 'utf8');

  console.log(`Expanded ${expandedCount}/${emerging.length} topics. Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
