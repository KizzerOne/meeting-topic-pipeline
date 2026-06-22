import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { supportedExtensions, archiveExtensions, inputNamePattern, zh } from '../constants.js';
import { projectRoot, options } from '../context.js';
import { toBrowserPath } from './paths.js';
import { extractZip, listSupportedFilesRecursive } from './extract.js';

export async function resolveInputPaths(inputs, inputDir) {
  const explicitInputs = (inputs || [])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const candidates = explicitInputs.length > 0
    ? explicitInputs.map((value) => path.resolve(projectRoot, value))
    : await listSupportedFiles(path.resolve(projectRoot, inputDir));

  const resolved = [];
  for (const filePath of candidates) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) throw new Error(`Input file not found: ${filePath}`);
    const ext = path.extname(filePath).toLowerCase();
    if (!supportedExtensions.has(ext)) {
      throw new Error(`Unsupported input file type: ${filePath}. Supported: ${[...supportedExtensions].join(', ')}`);
    }
    resolved.push(filePath);
  }
  return resolved.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export async function resolveMarkdownInputPaths(inputs) {
  const explicitInputs = (inputs || [])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const candidates = explicitInputs.length > 0
    ? explicitInputs.map((value) => path.resolve(projectRoot, value))
    : await listMarkdownFiles(path.resolve(projectRoot, options.outDir));

  const resolved = [];
  for (const filePath of candidates) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) throw new Error(`Markdown file not found: ${filePath}`);
    if (path.extname(filePath).toLowerCase() !== '.md') {
      throw new Error(`Not a Markdown file: ${filePath}`);
    }
    resolved.push(filePath);
  }
  return resolved.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export async function listMarkdownFiles(dir) {
  const found = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...await listMarkdownFiles(entryPath));
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
      found.push(entryPath);
    }
  }
  return found;
}

export async function listSupportedFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const found = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...await listSupportedFiles(entryPath));
    } else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
      found.push(entryPath);
    }
  }
  return found;
}

export async function expandArchiveInputs(inputPaths, tempDirs) {
  const expanded = [];

  for (const inputPath of inputPaths) {
    const ext = path.extname(inputPath).toLowerCase();
    if (!archiveExtensions.has(ext)) {
      expanded.push(inputPath);
      continue;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-summary-zip-'));
    tempDirs.push(tempDir);
    await extractZip(inputPath, tempDir);

    const archiveFiles = await listSupportedFilesRecursive(tempDir);
    expanded.push(...archiveFiles.filter((filePath) => !archiveExtensions.has(path.extname(filePath).toLowerCase())));
  }

  return expanded.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function validateInputNames(inputPaths, required) {
  for (const filePath of inputPaths) {
    const fileName = path.basename(filePath);
    if (required && !inputNamePattern.test(fileName)) {
      throw new Error(`Invalid input file name: ${fileName}. Expected format: ${zh.invalidName}.ext`);
    }
  }
}

export async function buildKpitComparisonContext(inputPath, outputDir) {
  if (!isKpitMeetingInput(inputPath)) return '';
  const existingMarkdownFiles = await listMarkdownFiles(outputDir);
  const historicalSummaries = [];
  for (const filePath of existingMarkdownFiles) {
    const base = path.basename(filePath);
    if (base.startsWith(options.summaryName) || base === 'topic_candidates.json') continue;
    if (base !== 'summary.md' && base.endsWith('.md') && existingMarkdownFiles.some((p) => path.basename(p) === 'summary.md')) continue;
    const markdown = await fs.readFile(filePath, 'utf8').catch(() => '');
    if (!markdown.trim()) continue;
    historicalSummaries.push([
      `--- Historical summary: ${toBrowserPath(path.relative(projectRoot, filePath))} ---`,
      markdown.slice(0, 12000)
    ].join('\n'));
  }
  if (historicalSummaries.length === 0) {
    return [
      'KPIT 会议差异标记要求：',
      '- 这是该会议输入目录下首次生成或没有可对比旧 summary。',
      '- 仍需对新增目标、计划变化、风险阻塞使用颜色标记：',
      '  - <span class="change-new">新增：...</span>',
      '  - <span class="change-updated">变化：...</span>',
      '  - <span class="change-risk">风险：...</span>'
    ].join('\n');
  }
  return [
    'KPIT 会议差异标记要求：',
    '- 请将本次会议内容与以下历史 summary 对比。',
    '- 明显新增内容使用 <span class="change-new">新增：...</span>。',
    '- 明显变更、调整、状态变化使用 <span class="change-updated">变化：...</span>。',
    '- 风险、阻塞、质量问题、延期风险使用 <span class="change-risk">风险：...</span>。',
    '- 只标记确实与历史 summary 有区别或对 Demo/任务有重要影响的内容，不要整篇都染色。',
    '',
    historicalSummaries.join('\n\n')
  ].join('\n');
}

export function isKpitMeetingInput(inputPath) {
  const relativeInput = toBrowserPath(path.relative(projectRoot, inputPath));
  return relativeInput.startsWith('input-files/KPIT会议/');
}

export async function pathExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}
