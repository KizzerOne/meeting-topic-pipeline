import fs from 'node:fs/promises';
import path from 'node:path';
import { TOPIC_SIDECAR_NAME } from '../constants.js';

export async function writeTopicSidecar(outputDir, {
  sourceInput,
  suggestedTitle,
  summaryMarkdownPath,
  topicHints = []
}) {
  const sidecarPath = path.join(outputDir, TOPIC_SIDECAR_NAME);
  const payload = {
    generated_at: new Date().toISOString(),
    source_input: sourceInput,
    suggested_title: suggestedTitle || '',
    summary_markdown: path.basename(summaryMarkdownPath || 'summary.md'),
    topic_hints: topicHints
  };
  await fs.writeFile(sidecarPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return sidecarPath;
}
