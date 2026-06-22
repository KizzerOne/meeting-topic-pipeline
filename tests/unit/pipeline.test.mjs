import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTopicGuideMarkdown,
  listMeetingKnowledgeTopics,
  listEmergingTopics
} from '../../src/lib/ontology.js';
import { parseSummaryResponse, cleanGeneratedMarkdown } from '../../src/lib/text.js';
import { sanitizeFileBaseName, uniqueFileBaseName } from '../../src/lib/paths.js';
import { CANONICAL_SUMMARY_BASE, TOPIC_MODULE_SECTIONS } from '../../src/constants.js';
import { normalizeTopicModuleMarkdown } from '../../src/lib/topic-template.js';

const sampleOntology = {
  promote_threshold: 0.9,
  roots: [
    {
      id: 'root',
      label: 'KPIT Demo',
      level: 1,
      children: [
        {
          id: 'cap',
          label: '能力域',
          level: 1,
          tree: 'capability',
          children: [
            {
              id: 'arm',
              label: '机械臂控制',
              level: 2,
              tree: 'capability',
              status: 'stable',
              confidence: 0.85,
              definition: '真机控制',
              children: []
            },
            {
              id: 'vlm',
              label: 'VLM测试点定位',
              level: 2,
              tree: 'capability',
              status: 'emerging',
              confidence: 0.7,
              definition: '视觉定位',
              children: []
            }
          ]
        }
      ]
    }
  ]
};

test('ontology lists capability L2 topics for meeting knowledge', () => {
  const topics = listMeetingKnowledgeTopics(sampleOntology);
  assert.ok(topics.some((t) => t.name.includes('机械臂')));
  assert.ok(topics.some((t) => t.name.includes('VLM')));
});

test('ontology lists emerging topics below promote threshold', () => {
  const emerging = listEmergingTopics(sampleOntology);
  assert.equal(emerging.length, 1);
  assert.equal(emerging[0].label, 'VLM测试点定位');
});

test('buildTopicGuideMarkdown includes scope text', () => {
  const guide = buildTopicGuideMarkdown(listMeetingKnowledgeTopics(sampleOntology));
  assert.match(guide, /机械臂/);
  assert.match(guide, /演化中/);
});

test('parseSummaryResponse parses fenced JSON', () => {
  const raw = '```json\n{"fileName":"主题_2026-05-08","summary":"# 标题\\n\\n内容"}\n```';
  const parsed = parseSummaryResponse(raw);
  assert.equal(parsed.fileName, '主题_2026-05-08');
  assert.ok(parsed.summary.includes('# 标题'));
});

test('cleanGeneratedMarkdown normalizes whitespace', () => {
  const md = cleanGeneratedMarkdown('## 一句话结论\n\n测试   \n');
  assert.ok(md.includes('一句话结论'));
});

test('uniqueFileBaseName avoids collisions', () => {
  const used = new Set();
  const a = uniqueFileBaseName('demo', '/tmp/a.txt', used);
  const b = uniqueFileBaseName('demo', '/tmp/b.txt', used);
  assert.equal(a, 'demo');
  assert.equal(b, 'demo-2');
});

test('canonical summary base name is fixed', () => {
  assert.equal(CANONICAL_SUMMARY_BASE, 'summary');
});

test('normalizeTopicModuleMarkdown enforces all section headings', () => {
  const raw = '# 机械臂控制\n\n## 模块目标\n\n控制真机。\n\n## 待办事项\n\n| 任务 | 负责人 | 截止时间 | 优先级 |\n| a | b | c | 高 |';
  const normalized = normalizeTopicModuleMarkdown('机械臂控制', raw);
  for (const section of TOPIC_MODULE_SECTIONS) {
    assert.ok(normalized.includes(`## ${section.title}`), `missing ${section.title}`);
  }
  assert.ok(normalized.includes('控制真机'));
});

test('sanitizeFileBaseName removes illegal characters', () => {
  assert.equal(sanitizeFileBaseName('机械臂/测试:2026'), '机械臂_测试_2026');
});
