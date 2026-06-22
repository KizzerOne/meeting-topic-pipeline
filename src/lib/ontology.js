import fs from 'node:fs/promises';
import path from 'node:path';
import { kpitMeetingTopics } from '../constants.js';

const DEFAULT_ONTOLOGY_PATH = 'topic-ontology/ontology.json';

export async function loadOntology(ontologyPath, projectRoot = process.cwd()) {
  const resolved = path.resolve(projectRoot, ontologyPath || DEFAULT_ONTOLOGY_PATH);
  try {
    const raw = await fs.readFile(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function walkOntologyNodes(roots = [], visitor, pathLabels = []) {
  for (const node of roots) {
    if (!node || typeof node !== 'object') continue;
    const label = String(node.label || '').trim();
    const currentPath = label ? [...pathLabels, label] : [...pathLabels];
    visitor(node, currentPath);
    if (Array.isArray(node.children) && node.children.length > 0) {
      walkOntologyNodes(node.children, visitor, currentPath);
    }
  }
}

export function listMeetingKnowledgeTopics(ontology) {
  if (!ontology?.roots?.length) {
    return kpitMeetingTopics.map((topic) => ({
      name: topic.name,
      scope: topic.scope,
      status: 'stable',
      level: 2,
      path: [topic.name]
    }));
  }

  const topics = [];
  const seen = new Set();

  walkOntologyNodes(ontology.roots, (node, nodePath) => {
    const level = Number(node.level || nodePath.length);
    const tree = node.tree || '';
    const label = String(node.label || '').trim();
    if (!label) return;

    const isCapabilityL2 = tree === 'capability' && level === 2;
    const isDemoL2 = tree === 'demo' && level === 2;
    const isPmL2 = tree === 'pm' && level === 2;
    if (!isCapabilityL2 && !isDemoL2 && !isPmL2) return;

    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    topics.push({
      id: node.id || '',
      name: label.replace(/_/g, ' '),
      scope: String(node.scope || node.definition || '').slice(0, 500) || '原文未明确',
      status: node.status || 'stable',
      confidence: Number(node.confidence || 0),
      level,
      path: nodePath
    });
  });

  if (topics.length === 0) {
    return kpitMeetingTopics.map((topic) => ({
      name: topic.name,
      scope: topic.scope,
      status: 'stable',
      level: 2,
      path: [topic.name]
    }));
  }

  return topics.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export function buildTopicGuideMarkdown(topics = []) {
  return topics
    .map((topic) => {
      const statusNote = topic.status === 'emerging' ? '（演化中）' : '';
      const scope = topic.scope ? topic.scope.replace(/\s+/g, ' ').slice(0, 200) : '原文未明确';
      return `- ${topic.name}${statusNote}：${scope}`;
    })
    .join('\n');
}

export function listEmergingTopics(ontology, { minConfidence = 0, maxConfidence = 0.9 } = {}) {
  const emerging = [];
  walkOntologyNodes(ontology?.roots || [], (node, nodePath) => {
    if (node.status !== 'emerging') return;
    const confidence = Number(node.confidence || 0);
    if (confidence < minConfidence || confidence > maxConfidence) return;
    emerging.push({
      id: node.id || '',
      label: String(node.label || '').trim(),
      level: Number(node.level || nodePath.length),
      tree: node.tree || '',
      confidence,
      definition: String(node.definition || '').slice(0, 500),
      path: nodePath,
      proposed_path: nodePath
    });
  });
  return emerging.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
}

export function applyPromotions(ontology, promoteThreshold = ontology?.promote_threshold || 0.9) {
  const promoted = [];
  walkOntologyNodes(ontology?.roots || [], (node) => {
    if (node.status !== 'emerging') return;
    const confidence = Number(node.confidence || 0);
    if (confidence >= promoteThreshold) {
      node.status = 'stable';
      promoted.push({
        id: node.id,
        label: node.label,
        confidence
      });
    }
  });
  return promoted;
}

export function buildWeeklyDiffMarkdown(ontology, previousOntology, promoted = []) {
  const now = new Date().toISOString();
  const week = now.slice(0, 10);
  const prevTopics = listMeetingKnowledgeTopics(previousOntology).map((t) => t.name);
  const currTopics = listMeetingKnowledgeTopics(ontology).map((t) => t.name);
  const added = currTopics.filter((name) => !prevTopics.includes(name));
  const removed = prevTopics.filter((name) => !currTopics.includes(name));

  return [
    '# Topic Ontology Weekly Diff',
    '',
    `- Generated: ${now}`,
    `- Promote threshold: ${ontology?.promote_threshold ?? 0.9}`,
    `- Ontology version: ${ontology?.version ?? 'unknown'}`,
    '',
    '## Promoted (emerging → stable)',
    '',
    promoted.length
      ? promoted.map((item) => `- ${item.label} (confidence ${item.confidence})`).join('\n')
      : '- None',
    '',
    '## Module label changes',
    '',
    '### Added',
    added.length ? added.map((name) => `- ${name}`).join('\n') : '- None',
    '',
    '### Removed',
    removed.length ? removed.map((name) => `- ${name}`).join('\n') : '- None',
    '',
    '## Emerging topics (still below threshold)',
    '',
    listEmergingTopics(ontology)
      .map((topic) => `- ${topic.path.join(' / ')} (confidence ${topic.confidence})`)
      .join('\n') || '- None'
  ].join('\n');
}
