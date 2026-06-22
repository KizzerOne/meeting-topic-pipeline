#!/usr/bin/env node
/**
 * Weekly ontology evolution: promote high-confidence emerging topics and write diff report.
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  applyPromotions,
  buildWeeklyDiffMarkdown,
  loadOntology
} from '../src/lib/ontology.js';

const projectRoot = process.cwd();
const ontologyPath = process.env.ONTOLOGY_PATH || 'topic-ontology/ontology.json';
const previousPath = path.join(projectRoot, 'topic-ontology', 'ontology.previous.json');
const diffDir = path.join(projectRoot, 'topic-ontology', 'weekly-diffs');

async function main() {
  const resolvedOntology = path.resolve(projectRoot, ontologyPath);
  const ontology = await loadOntology(ontologyPath, projectRoot);
  if (!ontology) {
    console.error(`Ontology not found: ${ontologyPath}`);
    process.exitCode = 1;
    return;
  }

  let previousOntology = null;
  try {
    previousOntology = JSON.parse(await fs.readFile(previousPath, 'utf8'));
  } catch {
    previousOntology = structuredClone(ontology);
  }

  const promoted = applyPromotions(ontology);
  ontology.updated_at = new Date().toISOString();
  ontology.last_evolution_at = ontology.updated_at;

  await fs.mkdir(diffDir, { recursive: true });
  const weekLabel = ontology.updated_at.slice(0, 10);
  const diffPath = path.join(diffDir, `topic-changelog-week-${weekLabel}.md`);
  const diffMarkdown = buildWeeklyDiffMarkdown(ontology, previousOntology, promoted);
  await fs.writeFile(diffPath, diffMarkdown, 'utf8');

  await fs.writeFile(previousPath, `${JSON.stringify(ontology, null, 2)}\n`, 'utf8');
  await fs.writeFile(resolvedOntology, `${JSON.stringify(ontology, null, 2)}\n`, 'utf8');

  console.log(`Promoted ${promoted.length} topic(s). Diff: ${diffPath}`);
  if (promoted.length > 0) {
    for (const item of promoted) {
      console.log(`  - ${item.label} (${item.confidence})`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
