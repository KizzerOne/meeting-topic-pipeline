import path from 'node:path';
import { projectRoot } from '../context.js';
import { cleanPdfText } from './text.js';

export function toBrowserPath(filePath) {
  return filePath.split(path.sep).join('/');
}

export function replaceExtension(filePath, ext) {
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${ext}`);
}

export function outputFolderForInput(inputPath, inputDir) {
  const inputRoot = path.resolve(projectRoot, inputDir);
  const resolvedInput = path.resolve(inputPath);
  const relativeInput = path.relative(inputRoot, resolvedInput);
  const isInsideInputRoot = relativeInput && !relativeInput.startsWith('..') && !path.isAbsolute(relativeInput);
  const relativeWithoutExt = isInsideInputRoot
    ? path.join(path.dirname(relativeInput), path.basename(relativeInput, path.extname(relativeInput)))
    : path.basename(resolvedInput, path.extname(resolvedInput));
  const safeSegments = relativeWithoutExt
    .split(path.sep)
    .filter((segment) => segment && segment !== '.')
    .map((segment) => sanitizeFileBaseName(segment) || 'input');
  return safeSegments.length > 0 ? path.join(...safeSegments) : 'input';
}

export function sanitizeFileBaseName(value) {
  return cleanPdfText(String(value || ''))
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80)
    .trim();
}

export function sanitizeSkillName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function uniqueFileBaseName(suggestedName, originalPath, usedBaseNames) {
  const fallback = path.basename(originalPath, path.extname(originalPath));
  const cleaned = sanitizeFileBaseName(suggestedName) || sanitizeFileBaseName(fallback) || 'summary';
  let candidate = cleaned;
  let index = 2;
  while (usedBaseNames.has(candidate.toLowerCase())) {
    candidate = `${cleaned}-${index}`;
    index += 1;
  }
  usedBaseNames.add(candidate.toLowerCase());
  return candidate;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
