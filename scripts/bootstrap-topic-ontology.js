#!/usr/bin/env node
/**
 * Cold-start topic ontology (Spec v0.2) from existing KPIT summaries + meeting-knowledge.
 * Uses LLM when OPENAI_API_KEY is configured; otherwise builds from meeting-knowledge files.
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { PM_L2_BRANCHES } from '../src/constants.js';

const projectRoot = process.cwd();
const meetingRoot = path.join(projectRoot, 'pdf-chat-summaries', 'KPIT会议');
const meetingKnowledgeDir = path.join(projectRoot, 'meeting-knowledge');
const outputDir = path.join(projectRoot, 'topic-ontology');
const ontologyPath = path.join(outputDir, 'ontology.json');
const reportPath = path.join(outputDir, 'bootstrap-report.md');

const PROMOTE_THRESHOLD = 0.9;

function isValidApiKey(key) {
  return Boolean(key) && !key.includes('your-openai') && key.length > 20;
}

function makeNode({ label, level, tree, parentId = null, status = 'stable', definition = '', evidence = [] }) {
  return {
    id: randomUUID(),
    label,
    level,
    tree,
    parent_id: parentId,
    status,
    confidence: status === 'stable' ? 0.85 : 0.7,
    definition,
    scope: '',
    aliases: [],
    evidence_refs: evidence,
    children: []
  };
}

async function listCanonicalMarkdown(dir) {
  const results = [];
  try {
    for await (const entry of walk(dir)) {
      if (!entry.name.endsWith('.md') || entry.name.startsWith('chat-summary-')) continue;
      const text = await fs.readFile(entry.fullPath, 'utf8');
      results.push({
        path: path.relative(projectRoot, entry.fullPath),
        title: entry.name.replace(/\.md$/u, ''),
        excerpt: text.slice(0, 8000)
      });
    }
  } catch {
    return results;
  }
  return results;
}

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile()) yield { name: entry.name, fullPath };
  }
}

async function readMeetingKnowledgeModules() {
  const modulesDir = path.join(meetingKnowledgeDir, 'modules');
  const modules = [];
  try {
    const files = await fs.readdir(modulesDir);
    for (const name of files.filter((f) => f.endsWith('.md'))) {
      const text = await fs.readFile(path.join(modulesDir, name), 'utf8');
      modules.push({ label: name.replace(/\.md$/u, ''), content: text.slice(0, 6000) });
    }
  } catch {
    return modules;
  }
  return modules;
}

async function readOverallSummary() {
  try {
    return await fs.readFile(path.join(meetingKnowledgeDir, 'overall-summary.md'), 'utf8');
  } catch {
    return '';
  }
}

function buildFromMeetingKnowledge(summaries, modules, overall) {
  const program = makeNode({
    label: 'KPIT 机械臂自动测试 Demo',
    level: 1,
    tree: 'program',
    definition: '项目根节点'
  });

  const demoRoot = makeNode({
    label: 'Demo 路线图 / 里程碑',
    level: 1,
    tree: 'demo',
    parentId: program.id,
    definition: '交付导向：阶段目标、演示范围、里程碑与阻塞'
  });
  demoRoot.children.push(
    makeNode({
      label: '5月底 Demo 目标',
      level: 2,
      tree: 'demo',
      parentId: demoRoot.id,
      definition: overall.slice(0, 500) || '从会议总览沉淀'
    })
  );

  const pmRoot = makeNode({
    label: '项目管理度量视图',
    level: 1,
    tree: 'pm',
    parentId: program.id,
    definition: '范围、进度、成本、质量、风险、干系人、沟通、变更'
  });
  for (const branch of PM_L2_BRANCHES) {
    pmRoot.children.push(
      makeNode({
        label: branch.label,
        level: 2,
        tree: 'pm',
        parentId: pmRoot.id,
        status: 'emerging',
        definition: `PM 维度：${branch.label}`
      })
    );
  }

  const capRoot = makeNode({
    label: '能力域技术树',
    level: 1,
    tree: 'capability',
    parentId: program.id,
    definition: '技术能力按域组织，由会议与模块知识归纳'
  });

  for (const mod of modules) {
    const l2 = makeNode({
      label: mod.label,
      level: 2,
      tree: 'capability',
      parentId: capRoot.id,
      definition: mod.content.split('\n').slice(0, 15).join('\n')
    });
    capRoot.children.push(l2);
  }

  for (const summary of summaries) {
    const folder = path.dirname(summary.path).split('/').pop();
    const l3 = makeNode({
      label: summary.title,
      level: 3,
      tree: 'capability',
      status: 'emerging',
      definition: summary.excerpt.slice(0, 400),
      evidence: [{ meeting_path: summary.path, span: summary.excerpt.slice(0, 200) }]
    });
    const parent = capRoot.children.find((c) => summary.excerpt.includes(c.label)) || capRoot.children[0];
    if (parent) {
      l3.parent_id = parent.id;
      parent.children = parent.children || [];
      parent.children.push(l3);
    } else {
      l3.parent_id = capRoot.id;
      capRoot.children.push(l3);
    }
  }

  program.children = [demoRoot, pmRoot, capRoot];

  return {
    version: 2,
    updated_at: new Date().toISOString(),
    promote_threshold: PROMOTE_THRESHOLD,
    source: 'meeting-knowledge-bootstrap',
    roots: [program],
    staging: [],
    meeting_sources: summaries.map((s) => s.path)
  };
}

async function enrichWithLlm(ontology, summaries) {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com'
  });
  const model = process.env.OPENAI_MODEL || 'deepseek-v4-flash';
  const sourceText = summaries
    .map((s, i) => `### Source ${i + 1}: ${s.path}\n${s.excerpt.slice(0, 4000)}`)
    .join('\n\n')
    .slice(0, 50000);

  const prompt = [
    '你是 Topic Ontology 冷启动助手。根据会议摘要，完善能力域 L2/L3 节点 label、definition、scope。',
    '固定 L1：Demo 路线图、项目管理度量视图、能力域技术树。不要删除这三支。',
    '输出严格 JSON：{"capability_updates":[{"path":["能力域","L2","L3?"],"label":"","definition":"","scope":"","confidence":0.0}]}',
    '只基于原文；不确定写“原文未明确”。',
    '',
    sourceText
  ].join('\n');

  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Return JSON only.' },
      { role: 'user', content: prompt }
    ]
  });

  const raw = response.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  ontology.llm_enrichment = parsed;
  ontology.source = 'meeting-knowledge-bootstrap+llm';
  return ontology;
}

async function main() {
  const summaries = await listCanonicalMarkdown(meetingRoot);
  const modules = await readMeetingKnowledgeModules();
  const overall = await readOverallSummary();

  if (summaries.length === 0 && modules.length === 0) {
    console.error('No KPIT summaries or meeting-knowledge modules found.');
    process.exitCode = 1;
    return;
  }

  let ontology = buildFromMeetingKnowledge(summaries, modules, overall);

  if (isValidApiKey(process.env.OPENAI_API_KEY)) {
    console.log('Enriching ontology with LLM...');
    try {
      ontology = await enrichWithLlm(ontology, summaries);
    } catch (error) {
      console.warn(`LLM enrichment skipped: ${error.message}`);
    }
  } else {
    console.log('OPENAI_API_KEY not configured; using meeting-knowledge only.');
  }

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(ontologyPath, JSON.stringify(ontology, null, 2), 'utf8');

  const report = [
    '# Topic Ontology Bootstrap Report',
    '',
    `- Generated: ${ontology.updated_at}`,
    `- Source: ${ontology.source}`,
    `- KPIT summaries: ${summaries.length}`,
    `- Meeting modules: ${modules.length}`,
    `- Promote threshold: ${ontology.promote_threshold}`,
    '',
    '## Meeting sources',
    ...summaries.map((s) => `- ${s.path}`),
    '',
    `Ontology written to \`topic-ontology/ontology.json\`.`
  ].join('\n');
  await fs.writeFile(reportPath, report, 'utf8');

  console.log(`Ontology: ${ontologyPath}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
