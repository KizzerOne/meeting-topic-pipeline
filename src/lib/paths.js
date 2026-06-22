import path from 'node:path';

export function toBrowserPath(filePath) {
  return String(filePath).split(path.sep).join('/');
}

export function replaceExtension(filePath, ext) {
  return filePath.replace(/\.[^.]+$/u, ext.startsWith('.') ? ext : `.${ext}`);
}

export function outputFolderForInput(inputPath, inputDir, projectRoot) {
  const relative = path.relative(path.resolve(projectRoot, inputDir), inputPath);
  const relativeWithoutExt = relative.replace(/\.[^.]+$/u, '');
  const safeParts = relativeWithoutExt
    .split(/[\\/]/u)
    .map((part) => part.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').trim())
    .filter(Boolean);
  return path.join('pdf-chat-summaries', ...safeParts);
}

export function sanitizeFileBaseName(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/g, '')
    .trim()
    .slice(0, 120) || 'summary';
}

export function sanitizeSkillName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function uniqueFileBaseName(suggestedName, originalPath, usedBaseNames) {
  const base = sanitizeFileBaseName(suggestedName || path.basename(originalPath, path.extname(originalPath)));
  let candidate = base;
  let index = 2;
  while (usedBaseNames.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  usedBaseNames.add(candidate);
  return candidate;
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
