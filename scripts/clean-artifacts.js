#!/usr/bin/env node
/**
 * Remove rerun and obsolete artifacts from output trees.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const roots = ['pdf-chat-summaries', 'docs'];
let removed = 0;

for (const root of roots) {
  const base = path.resolve(process.cwd(), root);
  try {
    await fs.access(base);
  } catch {
    continue;
  }
  for await (const entry of walk(base)) {
    if (entry.name.startsWith('chat-summary-') || entry.name.endsWith('.metadata.json')) {
      await fs.unlink(entry.fullPath);
      removed += 1;
    }
  }
}

console.log(`Removed ${removed} artifact file(s).`);

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield { name: entry.name, fullPath };
    }
  }
}
