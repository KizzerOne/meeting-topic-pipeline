#!/usr/bin/env node

import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse';
import {
  archiveExtensions,
  clawhubMarkdownMaxBytes,
  imageExtensions,
  inputNamePattern,
  kpitMeetingTopics,
  markitdownExtensions,
  modelExtensions,
  sidecarExtensions,
  supportedExtensions,
  textExtensions,
  viewableModelExtensions,
  visualHtmlRequirements,
  workflowSummaryRequirements,
  zh
} from './constants.js';
import { runCommand } from './lib/process.js';


const program = new Command();

program
  .name('chat-summary')
  .description('Generate Chinese summaries from PDF and text chat logs.')
  .option('-i, --input <file...>', 'Input files. Repeat or pass multiple paths.')
  .option('--input-dir <dir>', 'Directory containing input files.', 'input-files')
  .option('--skill-input-dir <dir>', 'Directory containing inputs used to generate Skills documents.', 'skill-inputs')
  .option('-o, --out-dir <dir>', 'Output directory.', 'pdf-chat-summaries')
  .option('--output-by-input-name', 'Use the input file base name as the output folder name. Requires one input file.', false)
  .option('--model <model>', 'OpenAI-compatible model name.', process.env.OPENAI_MODEL || 'deepseek-v4-flash')
  .option('--vision-model <model>', 'OpenAI-compatible vision model name for image inputs.', process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'deepseek-v4-flash')
  .option('--base-url <url>', 'OpenAI-compatible API base URL.', process.env.OPENAI_BASE_URL || 'https://api.deepseek.com')
  .option('--vision-base-url <url>', 'OpenAI-compatible API base URL for image inputs.', process.env.OPENAI_VISION_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com')
  .option('--clawhub-markdown-url <url>', 'ClawHub Markdown Converter endpoint.', process.env.CLAWHUB_MARKDOWN_URL || 'https://markdown.new/convert')
  .option('--disable-clawhub-markdown', 'Disable ClawHub Markdown Converter and use local extraction only.', false)
  .option('--clawhub-html-url <url>', 'Optional ClawHub Markdown-to-HTML endpoint.', process.env.CLAWHUB_HTML_URL || '')
  .option('--disable-clawhub-html', 'Disable ClawHub HTML output converter and use the built-in HTML template only.', false)
  .option('--skills-dir <dir>', 'Directory containing Claude/Agent Skill folders.', process.env.SKILLS_DIR || '.claude/skills')
  .option('--skills-html-dir <dir>', 'Output directory for generated Skills HTML pages.', process.env.SKILLS_HTML_DIR || 'skills-html')
  .option('--docs-dir <dir>', 'GitHub Pages output directory.', process.env.DOCS_DIR || 'docs')
  .option('--meeting-knowledge-dir <dir>', 'Directory for rolling meeting knowledge summaries by feature module.', process.env.MEETING_KNOWLEDGE_DIR || 'meeting-knowledge')
  .option('--meeting-summary-root <dir>', 'Directory containing meeting Markdown summaries used for topic knowledge updates.', process.env.MEETING_SUMMARY_ROOT || 'pdf-chat-summaries/KPIT会议')
  .option('--generate-skills-site-only', 'Generate the Skills HTML site and exit without model calls.', false)
  .option('--generate-llm-model-config-only', 'Generate the LLM model config document from skill inputs and exit without summary output.', false)
  .option('--render-markdown-to-html-only', 'Generate visual HTML pages for existing Markdown files and exit.', false)
  .option('--publish-docs-only', 'Publish generated summary HTML files into the GitHub Pages docs directory and exit.', false)
  .option('--update-meeting-knowledge-only', 'Update overall and per-module meeting knowledge Markdown files from generated summaries and exit.', false)
  .option('--disable-meeting-knowledge-update', 'Skip rolling meeting knowledge updates after summary generation.', false)
  .option('--github-repository <repo>', 'GitHub repository for browser-based Markdown writeback.', process.env.GITHUB_REPOSITORY || '')
  .option('--github-branch <branch>', 'GitHub branch for browser-based Markdown writeback.', process.env.GITHUB_REF_NAME || '')
  .option('--summary-name <name>', 'Base name for generated archive files.', 'chat-summary')
  .option('--require-name-pattern', 'Require file name format: member_YYYY-MM-DD.ext.', false)
  .option('--font <path>', 'Font file for generated Chinese PDF.', process.env.PDF_FONT_PATH)
  .option('--ocr-lang <lang>', 'Tesseract OCR language for scanned PDFs.', process.env.OCR_LANG || 'chi_sim+eng')
  .option('--llm-model-config-output <file>', 'Generate an LLM model usage/config record Markdown file from document inputs.', process.env.LLM_MODEL_CONFIG_OUTPUT || 'skills/llm_model_config.md')
  .option('--disable-skill-creation', 'Disable generation of new .claude/skills entries from skill inputs.', false)
  .option('--disable-llm-model-config', 'Disable generation of the LLM model usage/config record.', false)
  .parse();

const options = program.opts();
const projectRoot = process.cwd();
async function main() {
  const startedAt = new Date();
  const runStamp = startedAt.toISOString().replace(/[:.]/g, '-');
  if (options.generateSkillsSiteOnly) {
    const skillsSiteDir = await writeSkillsHtmlSite();
    console.log(skillsSiteDir ? `Skills HTML site: ${skillsSiteDir}` : 'No project Skills found.');
    return;
  }

  if (options.publishDocsOnly) {
    const docsIndex = await publishDocsSite();
    console.log(`GitHub Pages docs index: ${docsIndex}`);
    return;
  }

  if (options.updateMeetingKnowledgeOnly) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is missing. Add your OpenAI-compatible API key to .env locally or GitHub Actions secrets.');
    }
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: options.baseUrl
    });
    const knowledgeDir = await updateMeetingKnowledge(client, options.model);
    console.log(`Meeting knowledge directory: ${knowledgeDir}`);
    return;
  }

  if (options.renderMarkdownToHtmlOnly) {
    const inputPaths = await resolveMarkdownInputPaths(options.input);
    if (inputPaths.length === 0) {
      console.log('No Markdown files found. Nothing to render.');
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is missing. Add your OpenAI-compatible API key to .env locally or GitHub Actions secrets.');
    }
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: options.baseUrl
    });
    for (const markdownPath of inputPaths) {
      const markdown = await fs.readFile(markdownPath, 'utf8');
      const htmlPath = replaceExtension(markdownPath, '.html');
      const title = `${path.basename(markdownPath, '.md')} Visual Summary`;
      const visualHtml = await summarizeVisualHtml(client, {
        sourceText: markdown,
        markdownSummary: markdown,
        model: options.model,
        originalFileName: path.basename(markdownPath),
        sourceKind: 'markdown'
      }).catch((error) => {
        console.warn(`AI visual HTML generation failed for ${markdownPath}: ${error.message}`);
        return '';
      });
      await writeGeneratedHtml(htmlPath, visualHtml, title, markdown, markdownPath);
      console.log(`Generated visual HTML: ${htmlPath}`);
    }
    const docsIndex = await publishDocsSite();
    console.log(`GitHub Pages docs index: ${docsIndex}`);
    return;
  }

  if (options.generateLlmModelConfigOnly) {
    const inputPaths = await resolveInputPaths(options.input, options.skillInputDir);
    if (inputPaths.length === 0) {
      console.log('No supported skill input files found. Nothing to generate.');
      const skillsSiteDir = await writeSkillsHtmlSite();
      if (skillsSiteDir) console.log(`Skills HTML site: ${skillsSiteDir}`);
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is missing. Add your OpenAI-compatible API key to .env locally or GitHub Actions secrets.');
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: options.baseUrl
    });
    await processSkillInputs(client, inputPaths, options.model);
    const skillsSiteDir = await writeSkillsHtmlSite();
    if (skillsSiteDir) console.log(`Skills HTML site: ${skillsSiteDir}`);
    return;
  }

  const inputPaths = await resolveInputPaths(options.input, options.inputDir);
  if (inputPaths.length === 0) {
    console.log('No supported input files found. Nothing to summarize.');
    return;
  }

  if (options.outputByInputName && inputPaths.length !== 1) {
    throw new Error('--output-by-input-name requires exactly one input file.');
  }

  const outputFolderName = options.outputByInputName
    ? outputFolderForInput(inputPaths[0], options.inputDir)
    : runStamp;
  const outputDir = path.resolve(projectRoot, options.outDir, outputFolderName);
  await fs.mkdir(outputDir, { recursive: true });

  validateInputNames(inputPaths, options.requireNamePattern);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing. Add your OpenAI-compatible API key to .env locally or GitHub Actions secrets.');
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: options.baseUrl
  });
  const visionClient = new OpenAI({
    apiKey: process.env.OPENAI_VISION_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: options.visionBaseUrl
  });
  const results = [];
  const usedBaseNames = new Set();
  const tempDirs = [];

  try {
    const workItems = await expandArchiveInputs(inputPaths, tempDirs);
    if (workItems.length === 0) {
      console.log('No supported files found inside input archives. Nothing to summarize.');
      return;
    }

    for (const inputPath of workItems) {
      const inputContent = await extractInputContent(inputPath, options.ocrLang);
      const archivedOriginal = await archiveOriginalIfNeeded(inputPath, outputDir);
      const viewerHtml = await writeModelViewerIfNeeded(inputPath, archivedOriginal, outputDir);
      const comparisonContext = await buildKpitComparisonContext(inputPath, outputDir);
      const generated = await summarizeInput({ text: client, vision: visionClient }, inputContent, options, inputPath, archivedOriginal, viewerHtml, comparisonContext);
      const baseName = uniqueFileBaseName(generated.fileName, inputPath, usedBaseNames);
      const markdownPath = path.join(outputDir, `${baseName}.md`);
      const htmlSummaryPath = path.join(outputDir, `${baseName}.html`);

      await fs.writeFile(markdownPath, generated.summary, 'utf8');
      await writeGeneratedHtml(htmlSummaryPath, generated.htmlContent, `${baseName} Summary`, generated.summary, markdownPath);

      results.push({
        input: inputPath,
        generatedFileName: baseName,
        summaryMarkdown: markdownPath,
        summaryHtml: htmlSummaryPath,
        archivedOriginal,
        viewerHtml
      });
    }
  } finally {
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
  }

  const skillsSiteDir = await writeSkillsHtmlSite();
  if (skillsSiteDir) console.log(`Skills HTML site: ${skillsSiteDir}`);
  if (!options.disableMeetingKnowledgeUpdate) {
    const knowledgeDir = await updateMeetingKnowledge(client, options.model);
    console.log(`Meeting knowledge directory: ${knowledgeDir}`);
  }
  const docsIndex = await publishDocsSite();
  console.log(`GitHub Pages docs index: ${docsIndex}`);

  console.log(`Processed ${results.length} file(s).`);
  console.log(`Output directory: ${outputDir}`);
}

async function resolveInputPaths(inputs, inputDir) {
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

async function resolveMarkdownInputPaths(inputs) {
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

async function listMarkdownFiles(dir) {
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

async function listSupportedFiles(dir) {
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

async function expandArchiveInputs(inputPaths, tempDirs) {
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

async function extractZip(filePath, outputDir) {
  try {
    await runCommand('unzip', ['-q', filePath, '-d', outputDir]);
  } catch (unzipError) {
    try {
      await runCommand('tar', ['-xf', filePath, '-C', outputDir]);
    } catch {
      throw new Error(`Failed to extract ZIP archive: ${filePath}. Install unzip or tar. ${unzipError.message}`);
    }
  }
}

async function listSupportedFilesRecursive(dir) {
  const resolvedRoot = path.resolve(dir);
  const found = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    const resolvedEntry = path.resolve(entryPath);
    if (!resolvedEntry.startsWith(resolvedRoot + path.sep) && resolvedEntry !== resolvedRoot) continue;

    if (entry.isDirectory()) {
      found.push(...await listSupportedFilesRecursive(entryPath));
    } else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
      found.push(entryPath);
    }
  }

  return found;
}

function validateInputNames(inputPaths, required) {
  for (const filePath of inputPaths) {
    const fileName = path.basename(filePath);
    if (required && !inputNamePattern.test(fileName)) {
      throw new Error(`Invalid input file name: ${fileName}. Expected format: ${zh.invalidName}.ext`);
    }
  }
}

async function buildKpitComparisonContext(inputPath, outputDir) {
  if (!isKpitMeetingInput(inputPath)) return '';
  const existingMarkdownFiles = await listMarkdownFiles(outputDir);
  const historicalSummaries = [];
  for (const filePath of existingMarkdownFiles) {
    if (path.basename(filePath).startsWith(options.summaryName)) continue;
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

function isKpitMeetingInput(inputPath) {
  const relativeInput = toBrowserPath(path.relative(projectRoot, inputPath));
  return relativeInput.startsWith('input-files/KPIT会议/');
}

async function extractInputContent(filePath, ocrLang) {
  const ext = path.extname(filePath).toLowerCase();
  if (markitdownExtensions.has(ext)) {
    return { kind: 'text', text: await extractDocumentText(filePath, ocrLang) };
  }
  if (imageExtensions.has(ext)) {
    return { kind: 'image' };
  }
  if (modelExtensions.has(ext)) {
    return { kind: 'model' };
  }
  throw new Error(`Unsupported input file type: ${filePath}. Supported: ${[...supportedExtensions].join(', ')}`);
}

async function extractDocumentText(filePath, ocrLang) {
  const ext = path.extname(filePath).toLowerCase();
  if (!options.disableClawhubMarkdown && await shouldUseClawHubMarkdown(filePath)) {
    const clawhubText = await extractTextWithClawHub(filePath, options.clawhubMarkdownUrl).catch((error) => {
      console.warn(`ClawHub Markdown Converter failed for ${filePath}: ${error.message}`);
      return '';
    });
    if (clawhubText) return clawhubText;
  }

  const markitdownText = await extractTextWithMarkitdown(filePath).catch((error) => {
    console.warn(`markitdown failed for ${filePath}: ${error.message}`);
    return '';
  });

  if (markitdownText) return markitdownText;
  if (ext === '.pdf') return extractPdfText(filePath, ocrLang);
  if (textExtensions.has(ext)) return cleanOcrText(await fs.readFile(filePath, 'utf8'));

  throw new Error(`No text could be extracted from ${filePath}. Install markitdown or use a supported text/PDF fallback.`);
}

async function shouldUseClawHubMarkdown(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > clawhubMarkdownMaxBytes) {
    console.warn(`Skipping ClawHub Markdown Converter for ${filePath}: file is ${(stat.size / 1024 / 1024).toFixed(1)} MB and exceeds the safe upload limit.`);
    return false;
  }
  return true;
}




async function extractTextWithClawHub(filePath, endpoint) {
  const buffer = await fs.readFile(filePath);
  const formData = new FormData();
  formData.append('file', new Blob([buffer]), path.basename(filePath));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
    signal: controller.signal
  }).finally(() => clearTimeout(timer));

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return cleanOcrText(raw);
  }

  const parsed = JSON.parse(raw);
  if (parsed.success === false) {
    throw new Error(parsed.error || parsed.message || 'conversion failed');
  }

  return cleanOcrText(
    parsed?.data?.content ||
    parsed?.data?.markdown ||
    parsed?.content ||
    parsed?.markdown ||
    ''
  );
}

async function extractTextWithMarkitdown(filePath) {
  const { stdout } = await runCommand('markitdown', [filePath]);
  return cleanOcrText(stdout);
}

async function extractPdfText(filePath, ocrLang) {
  const buffer = await fs.readFile(filePath);
  const parsed = await pdfParse(buffer);
  const text = cleanOcrText(parsed.text.replace(/\r/g, '').trim());
  if (text) return text;

  console.warn(`No embedded text found in PDF, trying OCR: ${filePath}`);
  const ocrText = await extractPdfTextWithOcr(filePath, ocrLang);
  if (!ocrText) {
    throw new Error(`No extractable text found in PDF after OCR: ${filePath}. Check scan quality or OCR language.`);
  }
  return ocrText;
}

async function extractPdfTextWithOcr(filePath, ocrLang) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-summary-ocr-'));
  try {
    const imagePrefix = path.join(tempDir, 'page');
    await runCommand('pdftoppm', ['-png', '-r', '220', filePath, imagePrefix]);

    const pageImages = (await fs.readdir(tempDir))
      .filter((name) => /^page-\d+\.png$/u.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => path.join(tempDir, name));

    if (pageImages.length === 0) {
      throw new Error('pdftoppm did not produce page images for OCR.');
    }

    const pages = [];
    for (const imagePath of pageImages) {
      const { stdout } = await runCommand('tesseract', [imagePath, 'stdout', '-l', ocrLang, '--psm', '6']);
      pages.push(stdout.trim());
    }

    return cleanOcrText(pages.join('\n\n'));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function summarizeInput(clients, inputContent, options, inputPath, archivedOriginal, viewerHtml, comparisonContext = '') {
  if (inputContent.kind === 'image') {
    const imageDataUrl = await readImageAsDataUrl(inputPath);
    const generated = await summarizeImage(clients.vision, imageDataUrl, options.visionModel, path.basename(inputPath));
    generated.htmlContent = await summarizeVisualHtml(clients.text, {
      sourceText: generated.summary,
      markdownSummary: generated.summary,
      model: options.model,
      originalFileName: path.basename(inputPath),
      sourceKind: 'image'
    }).catch((error) => {
      console.warn(`AI visual HTML generation failed for ${path.basename(inputPath)}: ${error.message}`);
      return '';
    });
    return generated;
  }
  if (inputContent.kind === 'model') {
    return buildNonDocumentDeliveryNote(inputPath, inputContent.kind, archivedOriginal, viewerHtml);
  }
  const originalFileName = path.basename(inputPath);
  const generated = await summarizeChat(clients.text, inputContent.text, options.model, originalFileName, comparisonContext);
  generated.htmlContent = await summarizeVisualHtml(clients.text, {
    sourceText: inputContent.text,
    markdownSummary: generated.summary,
    model: options.model,
    originalFileName,
    sourceKind: 'text'
  }).catch((error) => {
    console.warn(`AI visual HTML generation failed for ${originalFileName}: ${error.message}`);
    return '';
  });
  return generated;
}

async function summarizeChat(client, text, model, originalFileName, comparisonContext = '') {
  const sourceText = cleanOcrText(text).slice(0, 50000);
  const skillInstructions = await loadSkillInstructions([
    'file-conversion-router',
    'important-info-extractor',
    'document-format',
    'workflow-diagram',
    'interactive-walkthrough'
  ]);
  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: zh.system },
      {
        role: 'user',
        content: `${zh.promptIntro}\n\n${formatSkillPromptBlock(skillInstructions)}\n\n${workflowSummaryRequirements}\n\n${comparisonContext}\n\n${zh.fileName}: ${originalFileName}\n\n${zh.jsonShape}\n\n${zh.requirements}\n\n${zh.content}:\n${sourceText}`
      }
    ]
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  const parsed = parseSummaryResponse(raw);
  return {
    fileName: parsed.fileName || path.basename(originalFileName, path.extname(originalFileName)),
    summary: cleanGeneratedMarkdown(parsed.summary || raw || zh.defaultSummary)
  };
}

async function summarizeVisualHtml(client, { sourceText, markdownSummary, model, originalFileName, sourceKind }) {
  const sourceExcerpt = cleanOcrText(sourceText).slice(0, sourceKind === 'image' ? 12000 : 36000);
  const summaryExcerpt = cleanGeneratedMarkdown(markdownSummary).slice(0, 22000);
  const skillInstructions = await loadSkillInstructions([
    'html-output',
    'interactive-html-artifact',
    'workflow-diagram',
    'interactive-walkthrough'
  ]);
  const prompt = [
    visualHtmlRequirements,
    '',
    formatSkillPromptBlock(skillInstructions),
    '',
    `Source file: ${originalFileName}`,
    `Source kind: ${sourceKind}`,
    '',
    'Markdown text summary follows. Use it as the factual baseline, but do not render it as Markdown:',
    summaryExcerpt,
    '',
    'Source excerpt follows. Use it only to confirm dates, people, tasks, models, metrics, risks, and process details:',
    sourceExcerpt
  ].join('\n');

  const response = await client.chat.completions.create({
    model,
    temperature: 0.25,
    messages: [
      {
        role: 'system',
        content: 'You design Chinese project-management visual HTML pages. Return only one complete HTML document. Do not return Markdown. Do not explain. Use only source-confirmed facts.'
      },
      { role: 'user', content: prompt }
    ]
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  return cleanGeneratedHtml(raw, `${path.basename(originalFileName, path.extname(originalFileName))} Visual Summary`);
}

async function generateLlmModelConfig(client, sources, model) {
  const skillInstructions = await loadSkillInstructions(['llm-model-config', 'document-format']);
  const sourceText = sources
    .map((source, index) => [
      `# Source ${index + 1}: ${path.basename(source.inputPath)}`,
      maskSensitiveContent(cleanOcrText(source.text).slice(0, 30000))
    ].join('\n\n'))
    .join('\n\n---\n\n')
    .slice(0, 60000);

  const prompt = [
    '请根据下面上传文件中的大模型使用记录及其对话，生成中文 Markdown 文档。',
    '',
    '必须严格满足：',
    '- 标题必须是：# 大模型调用与配置记录',
    '- 必须包含且只按以下顺序输出这些二级标题：',
    '  ## 1. 用途',
    '  ## 2. 输入',
    '  ## 3. 输出',
    '  ## 4. 操作步骤',
    '  ## 5. config 文件示例',
    '  ## 6. 模型切换记录表格',
    '  ## 7. 注意事项',
    '- config 文件示例必须使用 fenced code block，优先使用 yaml 或 env。',
    '- 模型切换记录必须使用 Markdown 表格。',
    '- 不要输出 Markdown 代码块包裹全文。',
    '- 不要写入真实 API Key、账号、密码、Token、Cookie、私钥或其它敏感信息；如果原文出现敏感值，替换为 <REDACTED>。',
    '- 只基于原文能确认的信息；原文未明确的信息写“原文未明确”。',
    '',
    formatSkillPromptBlock(skillInstructions),
    '',
    '上传文件内容：',
    sourceText
  ].join('\n');

  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: '你是严谨的中文技术文档整理助手。你只输出合规 Markdown，不泄露任何密钥或账号密码。'
      },
      { role: 'user', content: prompt }
    ]
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  const markdown = maskSensitiveContent(cleanGeneratedMarkdown(stripMarkdownFence(raw)));
  if (hasRequiredLlmModelConfigSections(markdown)) return markdown;
  return buildFallbackLlmModelConfig(sources);
}

async function collectTextSourcesFromInputs(inputPaths) {
  const sources = [];
  const tempDirs = [];

  try {
    const workItems = await expandArchiveInputs(inputPaths, tempDirs);
    for (const inputPath of workItems) {
      const inputContent = await extractInputContent(inputPath, options.ocrLang);
      if (inputContent.kind !== 'text') {
        console.warn(`Skipping non-document skill input: ${inputPath}`);
        continue;
      }
      sources.push({ inputPath, text: inputContent.text });
    }
  } finally {
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
  }

  return sources;
}

async function processSkillInputs(client, inputPaths, model) {
  const sources = await collectTextSourcesFromInputs(inputPaths);

  if (sources.length === 0) {
    console.log('No text skill inputs found. Nothing to generate.');
    return;
  }

  if (!options.disableSkillCreation) {
    await generateProjectSkills(client, sources, model);
  }

  if (!options.disableLlmModelConfig) {
    await writeLlmModelConfig(client, sources, model);
  }
}

async function writeLlmModelConfig(client, sources, model) {
  const llmConfigPath = path.resolve(projectRoot, options.llmModelConfigOutput);
  const llmConfigMarkdown = await generateLlmModelConfig(client, sources, model);
  await fs.mkdir(path.dirname(llmConfigPath), { recursive: true });
  await fs.writeFile(llmConfigPath, llmConfigMarkdown, 'utf8');
  await writeSummaryHtml(replaceExtension(llmConfigPath, '.html'), llmConfigMarkdown, '大模型调用与配置记录', llmConfigPath);
  console.log(`LLM model config: ${llmConfigPath}`);
  return llmConfigPath;
}

async function generateProjectSkills(client, sources, model) {
  const generatedSkills = await createSkillsFromSources(client, sources, model);
  for (const generatedSkill of generatedSkills) {
    const name = sanitizeSkillName(generatedSkill.name);
    if (!name || !generatedSkill.content) continue;
    const skillPath = path.resolve(projectRoot, options.skillsDir, name, 'SKILL.md');
    if (await pathExists(skillPath)) {
      console.log(`Skill already exists, skipping: ${name}`);
      continue;
    }
    const content = normalizeSkillMarkdown(generatedSkill.content, name, generatedSkill.description);
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.writeFile(skillPath, content, 'utf8');
    console.log(`Generated skill: ${skillPath}`);
  }
}

async function createSkillsFromSources(client, sources, model) {
  const skillInstructions = await loadSkillInstructions(['skill-creator', 'skill-writer', 'document-format']);
  const sourceText = sources
    .map((source, index) => [
      `# Source ${index + 1}: ${path.basename(source.inputPath)}`,
      maskSensitiveContent(cleanOcrText(source.text).slice(0, 30000))
    ].join('\n\n'))
    .join('\n\n---\n\n')
    .slice(0, 60000);

  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: 'You create safe project-level Claude/Agent Skills. Return strict JSON only.'
      },
      {
        role: 'user',
        content: [
          'Create project Skills from the uploaded requirements when the source clearly asks for reusable AI skills, workflows, output formats, or capabilities.',
          '',
          'Return strict JSON in this shape:',
          '{"skills":[{"name":"lowercase-hyphen-name","description":"trigger-oriented description","content":"complete SKILL.md content"}]}',
          '',
          'Rules:',
          '- If the source is only an LLM model usage/config record and does not request a new reusable skill, return {"skills":[]}.',
          '- Do not generate duplicate skills for html-output, llm-model-config, document-format, or skill-creator unless the source explicitly requests a different new skill.',
          '- The skill name must use lowercase letters, digits, and hyphens only.',
          '- Each content value must be a complete SKILL.md with YAML frontmatter containing name and description.',
          '- Do not include real secrets. Replace sensitive values with <REDACTED>.',
          '',
          formatSkillPromptBlock(skillInstructions),
          '',
          'Uploaded source content:',
          sourceText
        ].join('\n')
      }
    ]
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  const parsed = parseJsonObject(stripMarkdownFence(raw));
  if (!Array.isArray(parsed.skills)) return [];
  return parsed.skills
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      description: typeof item.description === 'string' ? item.description : '',
      content: typeof item.content === 'string' ? maskSensitiveContent(item.content) : ''
    }));
}

function stripMarkdownFence(value) {
  return String(value || '')
    .replace(/^```(?:markdown|md)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
}

function hasRequiredLlmModelConfigSections(markdown) {
  const required = [
    '# 大模型调用与配置记录',
    '## 1. 用途',
    '## 2. 输入',
    '## 3. 输出',
    '## 4. 操作步骤',
    '## 5. config 文件示例',
    '## 6. 模型切换记录表格',
    '## 7. 注意事项'
  ];
  return required.every((heading) => markdown.includes(heading));
}

function buildFallbackLlmModelConfig(sources) {
  const sourceFiles = sources.map((source) => path.basename(source.inputPath)).join(', ') || '原文未明确';
  return `# 大模型调用与配置记录

## 1. 用途

本文档用于记录上传文件中涉及的大模型调用、配置方式、输入输出和模型切换信息。

来源文件：${sourceFiles}

## 2. 输入

- 上传文件：${sourceFiles}
- 输入内容类型：大模型使用记录及其对话
- 关键信息来源：原文可确认的信息

## 3. 输出

- 输出文件：\`skills/llm_model_config.md\`
- 输出格式：中文 Markdown
- 输出主题：大模型调用与配置记录

## 4. 操作步骤

1. 将大模型使用记录及其对话文件上传到 \`input-files/\`。
2. 运行摘要生成流程。
3. 系统提取上传文件文本内容。
4. 系统根据可确认内容生成 \`skills/llm_model_config.md\`。
5. 检查输出文档是否包含用途、输入、输出、操作步骤、config 示例、模型切换记录和注意事项。

## 5. config 文件示例

\`\`\`yaml
version: 1
project: 原文未明确

models:
  - name: 原文未明确
    provider: 原文未明确
    interface: OpenAI-compatible Chat Completions API
    base_url_env: OPENAI_BASE_URL
    api_key_env: OPENAI_API_KEY
    usage:
      - 原文未明确
    status: 原文未明确
\`\`\`

## 6. 模型切换记录表格

| 日期 | 变更前 | 变更后 | 影响范围 | 原因 | 状态 |
|---|---|---|---|---|---|
| 原文未明确 | 原文未明确 | 原文未明确 | 原文未明确 | 原文未明确 | 原文未明确 |

## 7. 注意事项

- 不要在本文档中写入真实 API Key、账号、密码、Token、Cookie 或私钥。
- 涉及敏感值时，统一使用 \`<REDACTED>\` 或环境变量名代替。
- 原文未明确的信息不要编造，应标注为“原文未明确”。
- 更换模型、接口地址或供应商时，应同步更新配置示例和模型切换记录表格。
`;
}

function maskSensitiveContent(value) {
  return String(value || '')
    .replace(/(api[_-]?key|token|password|passwd|secret|cookie|authorization)(\s*[:=]\s*)(["']?)[^\s"'`]+/giu, '$1$2$3<REDACTED>')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|sess-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/gu, '<REDACTED>')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, '<REDACTED>');
}

async function loadSkillInstructions(skillNames) {
  const skillsRoot = path.resolve(projectRoot, options.skillsDir);
  const loaded = [];

  for (const skillName of skillNames) {
    const skillPath = path.join(skillsRoot, skillName, 'SKILL.md');
    const content = await fs.readFile(skillPath, 'utf8').catch((error) => {
      console.warn(`Skill not loaded: ${skillName} (${error.message})`);
      return '';
    });
    if (!content.trim()) continue;
    loaded.push({ name: skillName, content: content.trim() });
  }

  return loaded;
}

function formatSkillPromptBlock(skills) {
  if (!skills?.length) return 'Skills: 未加载。';
  return [
    '请遵循以下项目 Skills 指令：',
    '',
    ...skills.map((skill) => [
      `--- Skill: ${skill.name} ---`,
      skill.content
    ].join('\n'))
  ].join('\n\n');
}

async function writeSkillsHtmlSite() {
  const skills = await listProjectSkills();
  if (skills.length === 0) return '';

  const outputDir = path.resolve(projectRoot, options.skillsHtmlDir);
  await fs.mkdir(outputDir, { recursive: true });

  const rows = [];
  for (const skill of skills) {
    const htmlFileName = `${skill.name}.html`;
    const markdown = buildSkillMarkdown(skill);
    await writeSummaryHtml(path.join(outputDir, htmlFileName), markdown, `${skill.name} Skill`);
    rows.push(`| [${skill.name}](${htmlFileName}) | ${skill.description || '未提供'} | ${skill.relativePath} |`);
  }

  const indexMarkdown = [
    '# AI Skills 网页目录',
    '',
    '本页面由 CI 根据 `.claude/skills/*/SKILL.md` 自动生成，用于展示当前项目已接入的 Agent Skills。',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '## Skills 清单',
    '',
    '| Skill | 用途 | 源文件 |',
    '|---|---|---|',
    ...rows,
    '',
    '## CI 调用说明',
    '',
    '- `document-format`：用于约束普通摘要和文档输出格式。',
    '- `llm-model-config`：用于根据上传的大模型使用记录生成 `skills/llm_model_config.md`。',
    '- `html-output`：用于约束 Markdown 到 HTML 的网页输出。'
  ].join('\n');

  await fs.writeFile(path.join(outputDir, 'index.md'), indexMarkdown, 'utf8');
  await writeSummaryHtml(path.join(outputDir, 'index.html'), indexMarkdown, 'AI Skills 网页目录');
  return outputDir;
}

async function updateMeetingKnowledge(client, model) {
  const meetingRoot = path.resolve(projectRoot, options.meetingSummaryRoot);
  const summaryFiles = (await listMarkdownFiles(meetingRoot))
    .filter((filePath) => !path.basename(filePath).startsWith(options.summaryName));
  const outputDir = path.resolve(projectRoot, options.meetingKnowledgeDir);
  const modulesDir = path.join(outputDir, 'modules');
  await fs.mkdir(modulesDir, { recursive: true });

  if (summaryFiles.length === 0) {
    console.log('No generated summary Markdown files found. Meeting knowledge update skipped.');
    return outputDir;
  }

  const sources = [];
  for (const filePath of summaryFiles) {
    const markdown = await fs.readFile(filePath, 'utf8');
    sources.push([
      `--- Source: ${toBrowserPath(path.relative(projectRoot, filePath))} ---`,
      markdown.slice(0, 12000)
    ].join('\n'));
  }

  const skillInstructions = await loadSkillInstructions([
    'meeting-overall-summary',
    'meeting-module-router',
    'meeting-module-summary',
    'kpit-topic-knowledge',
    'kpit-demo-pages',
    'document-format'
  ]);
  const topicGuide = kpitMeetingTopics
    .map((topic) => `- ${topic.name}：${topic.scope}`)
    .join('\n');
  const prompt = [
    '请根据以下多份会议记录摘要，生成一个持续更新的会议知识库。',
    '',
    formatSkillPromptBlock(skillInstructions),
    '',
    '输出必须是严格 JSON，不要包裹 Markdown 代码块。格式如下：',
    '{"overall":"总览 Markdown","modules":[{"name":"功能模块名称","summary":"该模块 Markdown"}]}',
    '',
    '要求：',
    '- overall 是所有会议的总 summary，面向项目管理和交接。',
    '- modules 必须按 Topic/功能模块聚合，不按单次会议日期堆叠。',
    '- 优先使用以下固定 Topic 名称；没有信息的 Topic 也要保留，并写“原文未明确”：',
    topicGuide,
    '- 每个 Topic Markdown 必须包含：Topic 目标、相关会议、当前状态、已确认事项、待办事项、负责人、时间表、风险问题、Demo 影响、最近变化。',
    '- GitHub Pages 相关内容必须清楚回答：现在做到哪了、下一步做什么、谁负责、什么时候交付、有什么问题。',
    '- Demo 路线图必须优先沉淀 5 月底目标、时间表、任务分配、当前状态和风险。',
    '- 对明显新增、变更、风险内容使用 HTML 标记突出：<span class="change-new">新增：...</span>、<span class="change-updated">变化：...</span>、<span class="change-risk">风险：...</span>。',
    '- 如果出现固定 Topic 外的重要内容，可以额外加入“项目通用事项”。',
    '- 不要编造原文没有的负责人、日期、结论；不明确写“原文未明确”。',
    '- 不要输出 API Key、账号密码、Token、Cookie 等敏感信息。',
    '',
    '会议摘要来源：',
    sources.join('\n\n')
  ].join('\n');

  const response = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你是中文会议知识库整理助手，负责把多次会议记录沉淀为总览和按功能模块维护的 Markdown 文档。' },
      { role: 'user', content: prompt }
    ]
  });

  const raw = response.choices?.[0]?.message?.content || '{}';
  const parsed = parseJsonObject(raw);
  const overall = cleanGeneratedMarkdown(parsed.overall || '# 会议总览\n\n原文未明确。');
  const modules = Array.isArray(parsed.modules) ? parsed.modules : [];

  await fs.rm(modulesDir, { recursive: true, force: true });
  await fs.mkdir(modulesDir, { recursive: true });

  const overallPath = path.join(outputDir, 'overall-summary.md');
  await fs.writeFile(overallPath, overall, 'utf8');
  await writeGeneratedHtml(
    replaceExtension(overallPath, '.html'),
    await summarizeVisualHtml(client, {
      sourceText: overall,
      markdownSummary: overall,
      model,
      originalFileName: path.basename(overallPath),
      sourceKind: 'meeting-knowledge-overall'
    }).catch((error) => {
      console.warn(`AI visual HTML generation failed for ${overallPath}: ${error.message}`);
      return '';
    }),
    '会议总览',
    overall,
    overallPath
  );

  const indexRows = [];
  for (const item of modules) {
    const name = sanitizeFileBaseName(item?.name || '未命名模块') || 'module';
    const markdown = cleanGeneratedMarkdown(item?.summary || `# ${name}\n\n原文未明确。`);
    const modulePath = path.join(modulesDir, `${name}.md`);
    await fs.writeFile(modulePath, markdown, 'utf8');
    await writeGeneratedHtml(
      replaceExtension(modulePath, '.html'),
      await summarizeVisualHtml(client, {
        sourceText: markdown,
        markdownSummary: markdown,
        model,
        originalFileName: path.basename(modulePath),
        sourceKind: 'meeting-knowledge-module'
      }).catch((error) => {
        console.warn(`AI visual HTML generation failed for ${modulePath}: ${error.message}`);
        return '';
      }),
      `${name} 模块会议知识`,
      markdown,
      modulePath
    );
    indexRows.push(`| [${name}](modules/${encodeURI(name)}.md) | [HTML](modules/${encodeURI(name)}.html) |`);
  }

  const indexMarkdown = [
    '# 会议知识库索引',
    '',
    `更新时间：${new Date().toISOString()}`,
    '',
    '## 总览',
    '',
    '- [会议总览 Markdown](overall-summary.md)',
    '- [会议总览 HTML](overall-summary.html)',
    '',
    '## 功能模块',
    '',
    '| 模块 | 网页 |',
    '|---|---|',
    ...indexRows
  ].join('\n');
  const indexPath = path.join(outputDir, 'index.md');
  await fs.writeFile(indexPath, indexMarkdown, 'utf8');
  await writeGeneratedHtml(
    replaceExtension(indexPath, '.html'),
    await summarizeVisualHtml(client, {
      sourceText: indexMarkdown,
      markdownSummary: indexMarkdown,
      model,
      originalFileName: path.basename(indexPath),
      sourceKind: 'topic-navigation'
    }).catch((error) => {
      console.warn(`AI visual HTML generation failed for ${indexPath}: ${error.message}`);
      return '';
    }),
    '会议知识库索引',
    indexMarkdown,
    indexPath
  );
  return outputDir;
}

async function publishDocsSite() {
  const summariesDir = path.resolve(projectRoot, options.outDir);
  const meetingKnowledgeDir = path.resolve(projectRoot, options.meetingKnowledgeDir);
  const docsDir = path.resolve(projectRoot, options.docsDir);
  const docsSummariesDir = path.join(docsDir, 'pdf-chat-summaries');
  const docsMeetingDir = path.join(docsDir, 'meeting-knowledge');
  await fs.mkdir(docsDir, { recursive: true });
  await fs.rm(docsSummariesDir, { recursive: true, force: true });
  await fs.rm(docsMeetingDir, { recursive: true, force: true });
  await fs.mkdir(docsSummariesDir, { recursive: true });
  await fs.mkdir(docsMeetingDir, { recursive: true });
  await fs.writeFile(path.join(docsDir, '.nojekyll'), '', 'utf8');

  const publishableFiles = await listDocsPublishableFiles(summariesDir);
  const pages = [];
  for (const sourcePath of publishableFiles) {
    const relativePath = path.relative(summariesDir, sourcePath);
    const targetPath = path.join(docsSummariesDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);

    if (path.extname(sourcePath).toLowerCase() === '.html') {
      const stat = await fs.stat(sourcePath);
      pages.push({
        title: path.basename(sourcePath, '.html'),
        relativePath: toBrowserPath(path.join('pdf-chat-summaries', relativePath)),
        updatedAt: stat.mtime.toISOString()
      });
    }
  }
  const meetingFiles = await listDocsPublishableFiles(meetingKnowledgeDir);
  for (const sourcePath of meetingFiles) {
    const relativePath = path.relative(meetingKnowledgeDir, sourcePath);
    const targetPath = path.join(docsMeetingDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);

    if (path.extname(sourcePath).toLowerCase() === '.html') {
      const stat = await fs.stat(sourcePath);
      pages.push({
        title: `会议知识库/${path.basename(sourcePath, '.html')}`,
        relativePath: toBrowserPath(path.join('meeting-knowledge', relativePath)),
        updatedAt: stat.mtime.toISOString()
      });
    }
  }

  const indexPath = path.join(docsDir, 'index.html');
  await fs.writeFile(indexPath, buildDocsIndexHtml(pages), 'utf8');
  return indexPath;
}

async function listDocsPublishableFiles(dir) {
  const publishableExtensions = new Set(['.html', '.md', '.json']);
  const found = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...await listDocsPublishableFiles(entryPath));
    } else if (entry.isFile() && publishableExtensions.has(path.extname(entry.name).toLowerCase())) {
      found.push(entryPath);
    }
  }
  return found.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function buildDocsIndexHtml(pages) {
  const generatedAt = new Date().toISOString();
  const rows = pages
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-Hans-CN'))
    .map((page) => {
      const href = encodeURI(page.relativePath);
      const folder = toBrowserPath(path.dirname(page.relativePath));
      return `<tr>
        <td><a href="${escapeHtml(href)}">${escapeHtml(page.title)}</a></td>
        <td>${escapeHtml(folder === '.' ? 'pdf-chat-summaries' : folder)}</td>
        <td>${escapeHtml(page.updatedAt)}</td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ChattingRecordTest 输出目录</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fa;
      --panel: #ffffff;
      --text: #1f2328;
      --muted: #57606a;
      --border: #d0d7de;
      --accent: #0969da;
    }
    body {
      margin: 0;
      font-family: Arial, "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
      padding: 32px 18px 48px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
    }
    .meta {
      color: var(--muted);
      margin: 0 0 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      border-bottom: 1px solid var(--border);
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f6f8fa;
      font-weight: 600;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }
    a:hover {
      text-decoration: underline;
    }
    .empty {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
    }
    @media (max-width: 720px) {
      table {
        display: block;
        overflow-x: auto;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>ChattingRecordTest 输出目录</h1>
    <p class="meta">生成时间：${escapeHtml(generatedAt)}；页面数量：${pages.length}</p>
    ${pages.length > 0 ? `<table>
      <thead>
        <tr>
          <th>网页</th>
          <th>路径</th>
          <th>更新时间</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>` : '<div class="empty">暂无可浏览的 HTML 输出。</div>'}
  </main>
</body>
</html>
`;
}

async function listProjectSkills() {
  const skillsRoot = path.resolve(projectRoot, options.skillsDir);
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
    const content = await fs.readFile(skillPath, 'utf8').catch(() => '');
    if (!content.trim()) continue;
    const metadata = parseSkillMarkdown(content);
    skills.push({
      name: metadata.name || entry.name,
      description: metadata.description || '',
      body: metadata.body,
      relativePath: toBrowserPath(path.relative(projectRoot, skillPath))
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function parseSkillMarkdown(content) {
  const normalized = String(content || '').trim();
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u);
  if (!match) {
    return { name: '', description: '', body: normalized };
  }

  const frontmatter = match[1];
  const body = match[2].trim();
  return {
    name: readYamlScalar(frontmatter, 'name'),
    description: readYamlScalar(frontmatter, 'description'),
    body
  };
}

function readYamlScalar(frontmatter, key) {
  const pattern = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'mu');
  const match = String(frontmatter || '').match(pattern);
  if (!match) return '';
  return match[1].replace(/^['"]|['"]$/g, '').trim();
}

async function pathExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

function sanitizeSkillName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function normalizeSkillMarkdown(content, name, description) {
  const cleaned = maskSensitiveContent(stripMarkdownFence(content)).trim();
  const metadata = parseSkillMarkdown(cleaned);
  const finalName = sanitizeSkillName(metadata.name || name);
  const finalDescription = (metadata.description || description || `Use this skill for ${finalName}.`)
    .replace(/\r?\n/g, ' ')
    .trim();
  const body = metadata.body || `# ${finalName}

## Purpose

原文未明确。

## Instructions

1. Follow the uploaded requirements.

## Expected Output

原文未明确。`;

  return [
    '---',
    `name: ${finalName}`,
    `description: ${finalDescription}`,
    '---',
    '',
    body,
    ''
  ].join('\n');
}

function buildSkillMarkdown(skill) {
  return [
    `# ${skill.name}`,
    '',
    '## Skill 信息',
    '',
    `- 名称：${skill.name}`,
    `- 描述：${skill.description || '未提供'}`,
    `- 源文件：${skill.relativePath}`,
    '',
    '## Skill 内容',
    '',
    skill.body || '未提供'
  ].join('\n');
}

async function buildNonDocumentDeliveryNote(filePath, kind, archivedOriginal, viewerHtml) {
  const stat = await fs.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const typeLabel = kind === 'image' ? '图片交付物' : '3D/CAD 模型交付物';
  const sections = [
    `# ${path.basename(filePath)}`,
    '',
    '## 交付物类型',
    typeLabel,
    '',
    '## 文件信息',
    `- 文件名: ${path.basename(filePath)}`,
    `- 格式: ${ext}`,
    `- 大小: ${stat.size} bytes`,
    `- 修改时间: ${stat.mtime.toISOString()}`,
    `- 原始文件归档: ${archivedOriginal ? path.join('original', path.basename(archivedOriginal)) : '未归档'}`
  ];

  if (viewerHtml) {
    sections.push('', '## 网页预览', `- Viewer: ${path.basename(viewerHtml)}`);
  }

  sections.push('', '## 说明', '该文件属于非文档类交付物，本系统不对其内容做 AI summary，仅完成类型标识和归档。');

  return {
    fileName: path.basename(filePath, ext),
    summary: sections.join('\n')
  };
}

async function summarizeImage(client, imageDataUrl, model, originalFileName) {
  const skillInstructions = await loadSkillInstructions([
    'important-info-extractor',
    'document-format',
    'workflow-diagram',
    'interactive-walkthrough'
  ]);
  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: zh.system },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${zh.promptIntro}\n\n${formatSkillPromptBlock(skillInstructions)}\n\n${workflowSummaryRequirements}\n\n${zh.fileName}: ${originalFileName}\n\n${zh.jsonShape}\n\n${zh.requirements}\n\n请基于图片中可见的内容总结。图片可能是工程图、模型截图、零件照片、流程图、代码截图、配置截图或会议白板。提取可见文字、流程、结构、问题和结论。看不清或无法确认的信息必须写“原图未明确”。`
          },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUrl,
              detail: 'high'
            }
          }
        ]
      }
    ]
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  const parsed = parseSummaryResponse(raw);
  return {
    fileName: parsed.fileName || path.basename(originalFileName, path.extname(originalFileName)),
    summary: cleanGeneratedMarkdown(parsed.summary || raw || zh.defaultSummary)
  };
}

async function readImageAsDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const buffer = await fs.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function buildModelArchiveText(filePath, ocrLang) {
  const stat = await fs.stat(filePath);
  const sidecars = await findSidecarFiles(filePath);
  const sections = [
    '这是一个 3D/CAD 模型归档摘要任务。模型文件本体不能直接解析几何细节，请基于文件元数据和同名说明/BOM/工程图内容总结。',
    '',
    '## 模型文件元数据',
    `- 文件名: ${path.basename(filePath)}`,
    `- 格式: ${path.extname(filePath).toLowerCase()}`,
    `- 大小: ${stat.size} bytes`,
    `- 修改时间: ${stat.mtime.toISOString()}`
  ];

  if (sidecars.length === 0) {
    sections.push(
      '',
      '## 同名说明文件',
      '未找到同名 .pdf/.txt/.md/.csv/.json/.log 说明文件。请在摘要中明确说明只能完成文件归档，无法判断模型结构、尺寸、材料或设计意图。'
    );
    return sections.join('\n');
  }

  sections.push('', '## 同名说明/BOM/工程图内容');
  for (const sidecar of sidecars) {
    const sidecarText = await extractSidecarText(sidecar, ocrLang);
    sections.push('', `### ${path.basename(sidecar)}`, sidecarText || '未提取到可读文字。');
  }

  return sections.join('\n');
}

async function findSidecarFiles(filePath) {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const sidecars = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const candidateBaseName = path.basename(entry.name, ext).toLowerCase();
    if (candidateBaseName === baseName && sidecarExtensions.has(ext)) {
      sidecars.push(path.join(dir, entry.name));
    }
  }

  return sidecars.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

async function extractSidecarText(filePath, ocrLang) {
  const ext = path.extname(filePath).toLowerCase();
  if (markitdownExtensions.has(ext)) return extractDocumentText(filePath, ocrLang);
  throw new Error(`Unsupported sidecar file type: ${filePath}`);
}

async function archiveOriginalIfNeeded(inputPath, outputDir) {
  const ext = path.extname(inputPath).toLowerCase();
  if (!modelExtensions.has(ext) && !imageExtensions.has(ext)) return '';

  const originalsDir = path.join(outputDir, 'original');
  await fs.mkdir(originalsDir, { recursive: true });
  const archivedPath = path.join(originalsDir, path.basename(inputPath));
  await fs.copyFile(inputPath, archivedPath);
  return archivedPath;
}

async function writeModelViewerIfNeeded(inputPath, archivedOriginal, outputDir) {
  const ext = path.extname(inputPath).toLowerCase();
  if (!modelExtensions.has(ext) || !archivedOriginal) return '';

  const baseName = sanitizeFileBaseName(path.basename(inputPath, ext)) || 'model';
  const viewerPath = path.join(outputDir, `${baseName}-viewer.html`);
  const relativeModelPath = toBrowserPath(path.relative(outputDir, archivedOriginal));
  const modelFileName = path.basename(inputPath);
  const isViewable = viewableModelExtensions.has(ext);

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(modelFileName)} - 3D Viewer</title>
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      font-family: Arial, "Microsoft YaHei", sans-serif;
      background: #f6f8fa;
      color: #1f2328;
    }
    .topbar {
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 18px;
      border-bottom: 1px solid #d0d7de;
      background: #ffffff;
      box-sizing: border-box;
    }
    .title {
      font-size: 15px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hint {
      font-size: 12px;
      color: #57606a;
      margin-left: 16px;
      white-space: nowrap;
    }
    .viewer {
      width: 100%;
      height: calc(100% - 52px);
    }
    .unsupported {
      max-width: 720px;
      margin: 48px auto;
      padding: 24px;
      background: #ffffff;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      line-height: 1.7;
    }
    code {
      background: #f6f8fa;
      padding: 2px 5px;
      border-radius: 4px;
    }
  </style>
  ${isViewable ? '<script src="https://cdn.jsdelivr.net/npm/online-3d-viewer@0.18.0/build/engine/o3dv.min.js"></script>' : ''}
</head>
<body>
  <div class="topbar">
    <div class="title">${escapeHtml(modelFileName)}</div>
    <div class="hint">Online3DViewer</div>
  </div>
  ${isViewable
    ? `<div class="online_3d_viewer viewer" model="${escapeHtml(relativeModelPath)}"></div>
  <script>
    window.addEventListener('load', function () {
      if (!window.OV) {
        document.body.insertAdjacentHTML('beforeend', '<div class="unsupported">Online3DViewer failed to load. Check network access to jsDelivr CDN.</div>');
        return;
      }
      OV.Init3DViewerElements();
    });
  </script>`
    : `<div class="unsupported">
    <h1>暂不支持直接预览 ${escapeHtml(ext)} 文件</h1>
    <p>Online3DViewer 支持 STEP/STP、STL、OBJ 等网页预览格式，但 SolidWorks 原生 <code>.sldprt</code>/<code>.sldasm</code> 通常需要先从 SolidWorks 导出为 <code>.step</code>、<code>.stp</code>、<code>.stl</code> 或 <code>.obj</code>。</p>
    <p>原始文件已归档在：<code>${escapeHtml(relativeModelPath)}</code></p>
  </div>`}
</body>
</html>
`;

  await fs.writeFile(viewerPath, html, 'utf8');
  return viewerPath;
}

function toBrowserPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function replaceExtension(filePath, ext) {
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${ext}`);
}

function outputFolderForInput(inputPath, inputDir) {
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseSummaryResponse(raw) {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/u, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      fileName: typeof parsed.fileName === 'string' ? parsed.fileName : '',
      summary: typeof parsed.summary === 'string' ? parsed.summary : ''
    };
  } catch {
    return { fileName: '', summary: cleaned };
  }
}

function parseJsonObject(raw) {
  try {
    const parsed = JSON.parse(String(raw || '').trim());
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSummaryHtml(filePath, markdown, title, markdownPath = '') {
  const htmlSkillInstructions = await loadSkillInstructions([
    'html-output',
    'interactive-html-artifact',
    'markdown-roundtrip'
  ]);
  const convertedHtml = options.clawhubHtmlUrl && !options.disableClawhubHtml
    ? await convertMarkdownToHtmlWithClawHub(markdown, title, options.clawhubHtmlUrl).catch((error) => {
      console.warn(`ClawHub HTML converter failed for ${filePath}: ${error.message}`);
      return '';
    })
    : '';
  const html = buildSummaryHtml(markdown, title, htmlSkillInstructions, markdownPath, convertedHtml);
  await fs.writeFile(filePath, html, 'utf8');
}

async function writeGeneratedHtml(filePath, htmlContent, title, fallbackMarkdown, markdownPath = '') {
  const html = cleanGeneratedHtml(htmlContent, title) || buildFallbackVisualHtml(title, fallbackMarkdown, markdownPath);
  await fs.writeFile(filePath, html, 'utf8');
}

async function writeArchiveHtml(filePath, results, startedAt, markdownPath = '') {
  const generatedAt = startedAt.toISOString();
  const rows = results.map((result, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(path.basename(result.input))}</td>
          <td><a href="${escapeHtml(toBrowserPath(path.relative(path.dirname(filePath), result.summaryMarkdown)))}">MD</a></td>
          <td><a href="${escapeHtml(toBrowserPath(path.relative(path.dirname(filePath), result.summaryHtml)))}">HTML</a></td>
          <td>${escapeHtml(result.viewerHtml ? path.basename(result.viewerHtml) : 'source not explicit')}</td>
        </tr>`).join('');
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Chat Summary Archive</title>
  <style>${visualHtmlBaseCss()}</style>
</head>
<body>
  <main class="page-shell">
    <section class="hero-panel">
      <p class="eyebrow">Topic navigation page</p>
      <h1>AI Chat Summary Archive</h1>
      <p class="muted">Generated at ${escapeHtml(generatedAt)}. Markdown and HTML outputs are linked separately.</p>
    </section>
    <section class="metric-grid">
      <article class="metric-card"><span>Processed files</span><strong>${results.length}</strong></article>
      <article class="metric-card"><span>Markdown outputs</span><strong>${results.length + 1}</strong></article>
      <article class="metric-card"><span>HTML outputs</span><strong>${results.length + 1}</strong></article>
    </section>
    <section class="visual-panel">
      <h2>Topic 导航页</h2>
      <table>
        <thead><tr><th>#</th><th>Source</th><th>Markdown</th><th>HTML</th><th>Viewer</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    <section class="visual-panel">
      <h2>Output Flow</h2>
      <svg class="flow-svg" viewBox="0 0 820 150" role="img" aria-label="Output flow">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563"/></marker></defs>
        <g class="flow-node"><rect x="20" y="45" width="150" height="58"/><text x="95" y="80">Source files</text></g>
        <g class="flow-node"><rect x="235" y="45" width="150" height="58"/><text x="310" y="80">Markdown text</text></g>
        <g class="flow-node"><rect x="450" y="45" width="150" height="58"/><text x="525" y="80">Visual HTML</text></g>
        <g class="flow-node"><rect x="665" y="45" width="135" height="58"/><text x="732" y="80">Docs site</text></g>
        <path class="flow-line" d="M170 74 H235"/><path class="flow-line" d="M385 74 H450"/><path class="flow-line" d="M600 74 H665"/>
      </svg>
    </section>
  </main>
</body>
</html>`;
  await fs.writeFile(filePath, html, 'utf8');
  if (markdownPath) await fs.access(markdownPath).catch(() => {});
}

function cleanGeneratedHtml(raw, title) {
  const cleaned = String(raw || '')
    .replace(/^```(?:html)?\s*/iu, '')
    .replace(/```\s*$/u, '')
    .trim();
  if (!cleaned) return '';
  if (!/<!doctype html|<html[\s>]|<body[\s>]|<main[\s>]|<section[\s>]|<article[\s>]/iu.test(cleaned)) return '';
  const normalized = normalizeHtmlDocument(cleaned, title);
  if (!/<body[\s>]|<main[\s>]|<section[\s>]/iu.test(normalized)) return '';
  return normalized;
}

function buildFallbackVisualHtml(title, markdown, markdownPath = '') {
  const plain = cleanGeneratedMarkdown(markdown).replace(/[#*_`|>\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  const excerpt = plain.slice(0, 700) || 'source not explicit';
  const text = cleanGeneratedMarkdown(markdown);
  const headings = [...text.matchAll(/^#{1,3}\s+(.+)$/gmu)].map((match) => match[1].trim()).slice(0, 8);
  const topicItems = (headings.length ? headings : ['Timeline', 'Roadmap', 'Flowchart', 'Gantt', 'Benchmark', 'Radar', 'Owners', 'Risks'])
    .map((item) => `<a href="#${escapeHtml(sanitizeFileBaseName(item) || 'topic')}">${escapeHtml(item)}</a>`)
    .join('');
  const taskRows = extractSimpleRows(text, ['待办', '任务', '负责人', '风险', 'Benchmark']).slice(0, 8)
    .map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.slice(0, 90))}</td><td>source not explicit</td><td><span class="tag">open</span></td></tr>`)
    .join('') || '<tr><td>1</td><td>source not explicit</td><td>source not explicit</td><td><span class="tag">unknown</span></td></tr>';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${visualHtmlBaseCss()}</style>
</head>
<body>
  <main class="page-shell">
    <section class="hero-panel">
      <p class="eyebrow">Separated visual HTML</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="muted">${escapeHtml(excerpt)}</p>
    </section>
    <nav class="topic-nav" aria-label="Topic navigation">${topicItems}</nav>
    <section class="metric-grid">
      <article class="metric-card"><span>Tasks</span><strong>${countMatches(text, /任务|待办|todo/giu)}</strong></article>
      <article class="metric-card"><span>Risks</span><strong>${countMatches(text, /风险|问题|risk/giu)}</strong></article>
      <article class="metric-card"><span>Topics</span><strong>${headings.length || 8}</strong></article>
      <article class="metric-card"><span>Owners</span><strong>${countMatches(text, /负责人|owner|人员/giu)}</strong></article>
    </section>
    ${fallbackTimelineSection()}
    ${fallbackRoadmapSection()}
    ${fallbackFlowchartSection()}
    ${fallbackGanttSection()}
    ${fallbackBenchmarkSection()}
    ${fallbackRadarSection()}
    ${fallbackOwnerCardsSection()}
    <section class="visual-panel" id="risks"><h2>风险状态表</h2><table><thead><tr><th>#</th><th>Item</th><th>Owner</th><th>Status</th></tr></thead><tbody>${taskRows}</tbody></table></section>
    <footer class="footer-note">Markdown source: ${escapeHtml(markdownPath ? toBrowserPath(path.relative(projectRoot, markdownPath)) : 'source not explicit')}</footer>
  </main>
</body>
</html>`;
}

function visualHtmlBaseCss() {
  return `
    :root{--bg:#f6f8fb;--panel:#fff;--text:#202733;--muted:#687386;--border:#d9e0ea;--blue:#2f6fed;--green:#25b36b;--amber:#f6b73c;--red:#ef5b5b;--purple:#7c5cff}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,"Microsoft YaHei",sans-serif;line-height:1.55}.page-shell{max-width:1180px;margin:0 auto;padding:28px 18px 56px}.hero-panel,.visual-panel,.metric-card,.owner-card{background:var(--panel);border:1px solid var(--border);border-radius:8px}.hero-panel{padding:28px;margin-bottom:16px}.eyebrow{margin:0 0 8px;color:var(--blue);font-size:13px;font-weight:700;text-transform:uppercase}.hero-panel h1{margin:0 0 10px;font-size:30px;letter-spacing:0}.muted{color:var(--muted)}.topic-nav{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.topic-nav a,.tag{border:1px solid var(--border);background:#fff;border-radius:999px;padding:5px 10px;color:var(--text);text-decoration:none;font-size:13px}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}.metric-card{padding:16px}.metric-card span{display:block;color:var(--muted);font-size:13px}.metric-card strong{display:block;font-size:30px;margin-top:6px}.visual-panel{padding:18px;margin:14px 0;overflow:auto}.visual-panel h2{margin:0 0 14px;font-size:20px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid var(--border);padding:9px 10px;text-align:left;vertical-align:top}th{background:#f2f5fa}.flow-svg,.chart-svg{width:100%;min-height:180px}.flow-node rect{fill:#fff;stroke:var(--blue);stroke-width:1.5;rx:8}.flow-node text{text-anchor:middle;font-size:13px;fill:var(--text)}.flow-line{stroke:#4b5563;stroke-width:1.5;marker-end:url(#arrow);fill:none}.timeline{display:grid;grid-template-columns:repeat(4,minmax(160px,1fr));gap:12px}.timeline-item{border-left:3px solid var(--blue);padding:8px 10px;background:#f8fbff}.roadmap{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.roadmap div{background:#f8fbff;border:1px solid var(--border);border-radius:8px;padding:12px}.gantt-row{display:grid;grid-template-columns:120px 1fr;gap:10px;align-items:center;margin:8px 0}.gantt-bar{height:20px;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--green));}.owners{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.owner-card{padding:14px}.radar-wrap{max-width:420px}.footer-note{color:var(--muted);font-size:12px;margin-top:18px}@media(max-width:760px){.metric-grid,.timeline,.roadmap,.owners{grid-template-columns:1fr}.hero-panel h1{font-size:24px}}`;
}

function extractSimpleRows(text, keywords) {
  return String(text || '').split('\n').map((line) => line.trim()).filter((line) => line && keywords.some((keyword) => line.includes(keyword)));
}

function countMatches(text, regex) {
  return (String(text || '').match(regex) || []).length;
}

function fallbackTimelineSection() {
  return '<section class="visual-panel" id="timeline"><h2>时间线</h2><div class="timeline"><div class="timeline-item"><strong>Start</strong><p>source not explicit</p></div><div class="timeline-item"><strong>Plan</strong><p>source not explicit</p></div><div class="timeline-item"><strong>Execute</strong><p>source not explicit</p></div><div class="timeline-item"><strong>Review</strong><p>source not explicit</p></div></div></section>';
}

function fallbackRoadmapSection() {
  return '<section class="visual-panel" id="roadmap"><h2>路线图</h2><div class="roadmap"><div><strong>Phase 1</strong><p>source not explicit</p></div><div><strong>Phase 2</strong><p>source not explicit</p></div><div><strong>Phase 3</strong><p>source not explicit</p></div><div><strong>Phase 4</strong><p>source not explicit</p></div></div></section>';
}

function fallbackFlowchartSection() {
  return `<section class="visual-panel" id="flowchart"><h2>流程图</h2><svg class="flow-svg" viewBox="0 0 760 160"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563"/></marker></defs><g class="flow-node"><rect x="20" y="50" width="150" height="56"/><text x="95" y="83">Input</text></g><g class="flow-node"><rect x="220" y="50" width="150" height="56"/><text x="295" y="83">Analyze</text></g><g class="flow-node"><rect x="420" y="50" width="150" height="56"/><text x="495" y="83">Decide</text></g><g class="flow-node"><rect x="620" y="50" width="120" height="56"/><text x="680" y="83">Output</text></g><path class="flow-line" d="M170 78 H220"/><path class="flow-line" d="M370 78 H420"/><path class="flow-line" d="M570 78 H620"/></svg></section>`;
}

function fallbackGanttSection() {
  return '<section class="visual-panel" id="gantt"><h2>甘特图</h2><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div></section>';
}

function fallbackBenchmarkSection() {
  return '<section class="visual-panel" id="benchmark"><h2>模型 Benchmark 对比图</h2><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div></section>';
}

function fallbackRadarSection() {
  return `<section class="visual-panel radar-wrap" id="radar"><h2>雷达图</h2><svg class="chart-svg" viewBox="0 0 320 280"><polygon points="160,30 276,105 232,235 88,235 44,105" fill="#f4f7ff" stroke="#b7c4d9"/><polygon points="160,70 230,115 206,205 106,205 90,120" fill="rgba(47,111,237,.22)" stroke="#2f6fed" stroke-width="2"/><text x="160" y="20" text-anchor="middle">Accuracy</text><text x="292" y="108">Speed</text><text x="236" y="260">Cost</text><text x="44" y="260">Stability</text><text x="5" y="108">Coverage</text></svg></section>`;
}

function fallbackOwnerCardsSection() {
  return '<section class="visual-panel" id="owners"><h2>任务负责人卡片</h2><div class="owners"><article class="owner-card"><strong>Owner</strong><p>source not explicit</p><span class="tag">open</span></article><article class="owner-card"><strong>Reviewer</strong><p>source not explicit</p><span class="tag">pending</span></article><article class="owner-card"><strong>Support</strong><p>source not explicit</p><span class="tag">watch</span></article></div></section>';
}

async function convertMarkdownToHtmlWithClawHub(markdown, title, endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      markdown,
      title
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timer));

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return normalizeHtmlDocument(raw, title);
  }

  const parsed = JSON.parse(raw);
  if (parsed.success === false) {
    throw new Error(parsed.error || parsed.message || 'conversion failed');
  }

  const html = parsed?.data?.html || parsed?.html || parsed?.data?.content || parsed?.content || '';
  return normalizeHtmlDocument(html, title);
}

function normalizeHtmlDocument(html, title) {
  const value = String(html || '').trim();
  if (!value) return '';
  if (/<!doctype html|<html[\s>]/iu.test(value)) return value;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body>
${value}
</body>
</html>
`;
}

function extractHtmlBody(html) {
  const value = String(html || '').trim();
  if (!value) return '';
  const match = value.match(/<body[^>]*>([\s\S]*?)<\/body>/iu);
  return match ? match[1].trim() : value;
}

function buildSummaryHtml(markdown, title, skillInstructions = [], markdownPath = '', renderedHtml = '') {
  const skillNames = skillInstructions.map((skill) => skill.name).join(', ') || 'none';
  const defaultMarkdownPath = markdownPath
    ? toBrowserPath(path.relative(projectRoot, markdownPath))
    : '';
  const defaultRepository = options.githubRepository || '';
  const defaultBranch = options.githubBranch || '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="generator-skills" content="${escapeHtml(skillNames)}">
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fa;
      --panel: #ffffff;
      --text: #1f2328;
      --muted: #57606a;
      --border: #d0d7de;
      --accent: #0969da;
    }
    body {
      margin: 0;
      font-family: Arial, "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.65;
    }
    main {
      max-width: 980px;
      margin: 0 auto;
      padding: 32px 18px 48px;
    }
    article {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 28px;
    }
    h1, h2, h3 {
      line-height: 1.3;
      margin: 1.2em 0 0.5em;
    }
    h1 {
      margin-top: 0;
      font-size: 28px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }
    h2 {
      font-size: 21px;
      color: var(--accent);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0 22px;
      font-size: 14px;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 8px 10px;
      vertical-align: top;
      text-align: left;
    }
    th {
      background: #f6f8fa;
      font-weight: 600;
    }
    code {
      background: #f6f8fa;
      border-radius: 4px;
      padding: 2px 5px;
    }
    pre {
      white-space: pre-wrap;
      background: #f6f8fa;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      overflow: auto;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 16px;
    }
    .toolbar button {
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #ffffff;
      color: var(--text);
      cursor: pointer;
      font: inherit;
      padding: 6px 10px;
    }
    .editor {
      display: none;
      margin: 0 0 18px;
    }
    .editor.is-open {
      display: block;
    }
    .editor textarea {
      width: 100%;
      min-height: 320px;
      box-sizing: border-box;
      border: 1px solid var(--border);
      border-radius: 6px;
      font: 13px Consolas, "Courier New", monospace;
      line-height: 1.5;
      padding: 12px;
    }
    .diagram-editor {
      display: none;
      margin: 0 0 18px;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      background: #ffffff;
    }
    .diagram-editor.is-open {
      display: block;
    }
    .diagram-editor textarea {
      width: 100%;
      min-height: 150px;
      box-sizing: border-box;
      border: 1px solid var(--border);
      border-radius: 6px;
      font: 13px Consolas, "Courier New", monospace;
      line-height: 1.5;
      padding: 10px;
    }
    .diagram-canvas {
      width: 100%;
      min-height: 360px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #f6f8fa;
      margin: 10px 0 12px;
      touch-action: none;
    }
    .diagram-node rect {
      fill: #ffffff;
      stroke: #0969da;
      stroke-width: 1.6;
      rx: 6;
    }
    .diagram-node text {
      fill: #1f2328;
      font: 13px Arial, "Microsoft YaHei", sans-serif;
      pointer-events: none;
      user-select: none;
    }
    .diagram-edge {
      stroke: #57606a;
      stroke-width: 1.5;
      marker-end: url(#arrow);
    }
    .writeback {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin: 0 0 16px;
    }
    .writeback input {
      box-sizing: border-box;
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 6px;
      font: inherit;
      padding: 7px 9px;
    }
    .writeback .wide {
      grid-column: 1 / -1;
    }
    .status {
      color: var(--muted);
      font-size: 13px;
      margin: -6px 0 16px;
    }
    .mermaid {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      overflow: auto;
    }
    .change-new {
      color: #116329;
      background: #dafbe1;
      border-radius: 4px;
      padding: 1px 4px;
      font-weight: 600;
    }
    .change-updated {
      color: #7d4e00;
      background: #fff8c5;
      border-radius: 4px;
      padding: 1px 4px;
      font-weight: 600;
    }
    .change-risk {
      color: #a40e26;
      background: #ffebe9;
      border-radius: 4px;
      padding: 1px 4px;
      font-weight: 600;
    }
    @media (max-width: 640px) {
      article {
        padding: 18px;
      }
      table {
        display: block;
        overflow-x: auto;
      }
      .writeback {
        grid-template-columns: 1fr;
      }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
<body>
  <main>
    <div class="toolbar">
      <button type="button" id="toggle-editor">Edit Markdown</button>
      <button type="button" id="download-markdown">Download Markdown</button>
      <button type="button" id="render-preview">Preview</button>
      <button type="button" id="toggle-diagram-editor">Diagram Editor</button>
      <button type="button" id="save-github">Save to GitHub</button>
    </div>
    <div class="writeback" id="github-writeback">
      <input id="github-repo" placeholder="owner/repo" value="${escapeHtml(defaultRepository)}">
      <input id="github-branch" placeholder="branch" value="${escapeHtml(defaultBranch)}">
      <input class="wide" id="github-path" placeholder="path/to/file.md" value="${escapeHtml(defaultMarkdownPath)}">
      <input class="wide" id="github-token" placeholder="GitHub token (not stored)" type="password" autocomplete="off">
      <input class="wide" id="github-message" placeholder="commit message" value="Update Markdown from HTML editor">
    </div>
    <div class="status" id="save-status">Edit, preview, then save Markdown back to GitHub to trigger CI.</div>
    <div class="editor" id="markdown-editor">
      <textarea id="markdown-source">${escapeHtml(markdown)}</textarea>
    </div>
    <div class="diagram-editor" id="diagram-editor">
      <p>Edit Mermaid edges as one per line: <code>Start --&gt; Process</code></p>
      <textarea id="diagram-edges"></textarea>
      <svg class="diagram-canvas" id="diagram-canvas" viewBox="0 0 900 360" role="img" aria-label="Visual flow diagram editor"></svg>
      <div class="toolbar">
        <button type="button" id="load-diagram">Load from Markdown</button>
        <button type="button" id="render-diagram-canvas">Render Canvas</button>
        <button type="button" id="apply-diagram">Apply to Markdown</button>
      </div>
    </div>
    <article id="document-preview">
${extractHtmlBody(renderedHtml) || markdownToHtml(markdown)}
    </article>
  </main>
  <script>
    const source = document.getElementById('markdown-source');
    const editor = document.getElementById('markdown-editor');
    const preview = document.getElementById('document-preview');
    const fileName = ${JSON.stringify(`${sanitizeFileBaseName(title) || 'document'}.md`)};
    const hasMermaid = typeof window.mermaid !== 'undefined';
    if (hasMermaid) window.mermaid.initialize({ startOnLoad: true });
    document.getElementById('toggle-editor').addEventListener('click', () => {
      editor.classList.toggle('is-open');
    });
    document.getElementById('toggle-diagram-editor').addEventListener('click', () => {
      document.getElementById('diagram-editor').classList.toggle('is-open');
    });
    document.getElementById('download-markdown').addEventListener('click', () => {
      const blob = new Blob([source.value], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    });
    document.getElementById('render-preview').addEventListener('click', () => {
      preview.innerHTML = clientMarkdownToHtml(source.value);
      if (hasMermaid) window.mermaid.run({ querySelector: '.mermaid' });
    });
    document.getElementById('save-github').addEventListener('click', saveMarkdownToGitHub);
    document.getElementById('load-diagram').addEventListener('click', () => {
      const edges = mermaidToEdgeList(extractFirstMermaid(source.value));
      document.getElementById('diagram-edges').value = edges || defaultEdgeList();
      renderDiagramCanvas();
    });
    document.getElementById('render-diagram-canvas').addEventListener('click', renderDiagramCanvas);
    document.getElementById('apply-diagram').addEventListener('click', () => {
      const mermaidCode = edgeListToMermaid(document.getElementById('diagram-edges').value);
      source.value = replaceFirstMermaid(source.value, mermaidCode);
      preview.innerHTML = clientMarkdownToHtml(source.value);
      if (hasMermaid) window.mermaid.run({ querySelector: '.mermaid' });
    });
    function parseEdgeList(edgeList) {
      const edges = [];
      const nodes = new Map();
      const addNode = (label) => {
        const clean = String(label || '').trim();
        if (!clean) return null;
        if (!nodes.has(clean)) nodes.set(clean, { id: 'N' + (nodes.size + 1), label: clean, x: 0, y: 0 });
        return nodes.get(clean);
      };
      String(edgeList || '').split('\\n').map((line) => line.trim()).filter(Boolean).forEach((line) => {
        const parts = line.split(/\\s*-->\\s*/u);
        if (parts.length < 2) return;
        const from = addNode(parts[0]);
        const to = addNode(parts.slice(1).join(' --> '));
        if (from && to) edges.push({ from: from.label, to: to.label });
      });
      const nodeList = [...nodes.values()];
      nodeList.forEach((node, index) => {
        const columns = Math.max(1, Math.ceil(Math.sqrt(nodeList.length)));
        node.x = 80 + (index % columns) * 240;
        node.y = 70 + Math.floor(index / columns) * 110;
      });
      return { nodes: nodeList, edges };
    }
    function renderDiagramCanvas() {
      const svg = document.getElementById('diagram-canvas');
      const edgeInput = document.getElementById('diagram-edges');
      if (!edgeInput.value.trim()) edgeInput.value = defaultEdgeList();
      const graph = parseEdgeList(edgeInput.value);
      const nodeByLabel = new Map(graph.nodes.map((node) => [node.label, node]));
      svg.innerHTML = '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#57606a"></path></marker></defs>';
      const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.append(edgeLayer, nodeLayer);
      const redrawEdges = () => {
        edgeLayer.innerHTML = '';
        for (const edge of graph.edges) {
          const from = nodeByLabel.get(edge.from);
          const to = nodeByLabel.get(edge.to);
          if (!from || !to) continue;
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('class', 'diagram-edge');
          line.setAttribute('x1', from.x + 150);
          line.setAttribute('y1', from.y + 24);
          line.setAttribute('x2', to.x);
          line.setAttribute('y2', to.y + 24);
          edgeLayer.append(line);
        }
      };
      const syncEdges = () => {
        document.getElementById('diagram-edges').value = graph.edges.map((edge) => edge.from + ' --> ' + edge.to).join('\\n');
      };
      redrawEdges();
      for (const node of graph.nodes) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'diagram-node');
        group.setAttribute('transform', 'translate(' + node.x + ' ' + node.y + ')');
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', '150');
        rect.setAttribute('height', '48');
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '75');
        text.setAttribute('y', '29');
        text.setAttribute('text-anchor', 'middle');
        text.textContent = formatNodeLabel(node.label);
        group.append(rect, text);
        nodeLayer.append(group);
        let dragging = false;
        let offset = { x: 0, y: 0 };
        group.addEventListener('pointerdown', (event) => {
          dragging = true;
          group.setPointerCapture(event.pointerId);
          const point = svgPoint(svg, event);
          offset = { x: point.x - node.x, y: point.y - node.y };
        });
        group.addEventListener('pointermove', (event) => {
          if (!dragging) return;
          const point = svgPoint(svg, event);
          node.x = Math.max(10, Math.min(740, point.x - offset.x));
          node.y = Math.max(10, Math.min(300, point.y - offset.y));
          group.setAttribute('transform', 'translate(' + node.x + ' ' + node.y + ')');
          redrawEdges();
        });
        group.addEventListener('pointerup', (event) => {
          dragging = false;
          group.releasePointerCapture(event.pointerId);
        });
        group.addEventListener('dblclick', () => {
          const next = prompt('Node label', node.label);
          if (!next || next.trim() === node.label) return;
          const old = node.label;
          node.label = next.trim();
          text.textContent = formatNodeLabel(node.label);
          nodeByLabel.delete(old);
          nodeByLabel.set(node.label, node);
          graph.edges.forEach((edge) => {
            if (edge.from === old) edge.from = node.label;
            if (edge.to === old) edge.to = node.label;
          });
          syncEdges();
          redrawEdges();
        });
      }
    }
    function formatNodeLabel(label) {
      const value = String(label || '');
      return value.length > 16 ? value.slice(0, 15) + '...' : value;
    }
    function defaultEdgeList() {
      return [
        '\\u4e0a\\u4f20\\u6587\\u4ef6 --> \\u89e3\\u6790\\u5185\\u5bb9',
        '\\u89e3\\u6790\\u5185\\u5bb9 --> \\u751f\\u6210\\u6458\\u8981',
        '\\u751f\\u6210\\u6458\\u8981 --> \\u751f\\u6210\\u7f51\\u9875'
      ].join('\\n');
    }
    function svgPoint(svg, event) {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(svg.getScreenCTM().inverse());
    }
    function utf8ToBase64(value) {
      const bytes = new TextEncoder().encode(value);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    }
    async function saveMarkdownToGitHub() {
      const status = document.getElementById('save-status');
      const repo = document.getElementById('github-repo').value.trim();
      const branch = document.getElementById('github-branch').value.trim();
      const filePath = document.getElementById('github-path').value.trim();
      const token = document.getElementById('github-token').value.trim();
      const message = document.getElementById('github-message').value.trim() || 'Update Markdown from HTML editor';
      if (!repo || !branch || !filePath || !token) {
        status.textContent = 'Repository, branch, path, and token are required.';
        return;
      }
      status.textContent = 'Saving Markdown to GitHub...';
      const apiUrl = 'https://api.github.com/repos/' + repo + '/contents/' + encodeURIComponent(filePath).replace(/%2F/g, '/');
      try {
        const current = await fetch(apiUrl + '?ref=' + encodeURIComponent(branch), {
          headers: {
            authorization: 'Bearer ' + token,
            accept: 'application/vnd.github+json'
          }
        });
        if (!current.ok) throw new Error('Failed to read current file: HTTP ' + current.status);
        const currentJson = await current.json();
        const saved = await fetch(apiUrl, {
          method: 'PUT',
          headers: {
            authorization: 'Bearer ' + token,
            accept: 'application/vnd.github+json',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            message,
            content: utf8ToBase64(source.value),
            sha: currentJson.sha,
            branch
          })
        });
        if (!saved.ok) {
          const text = await saved.text();
          throw new Error('Failed to save file: HTTP ' + saved.status + ' ' + text.slice(0, 200));
        }
        status.textContent = 'Saved to GitHub. CI should run if this path is watched by the workflow.';
      } catch (error) {
        status.textContent = error.message;
      }
    }
    function extractFirstMermaid(markdownText) {
      const fence = String.fromCharCode(96, 96, 96);
      const lines = String(markdownText || '').split('\\n');
      const collected = [];
      let inside = false;
      for (const line of lines) {
        const trimmed = line.trim().toLowerCase();
        if (!inside && trimmed === fence + 'mermaid') {
          inside = true;
          continue;
        }
        if (inside && trimmed.startsWith(fence)) break;
        if (inside) collected.push(line);
      }
      return collected.join('\\n').trim();
    }
    function replaceFirstMermaid(markdownText, mermaidCode) {
      const fence = String.fromCharCode(96, 96, 96);
      const block = fence + 'mermaid\\n' + mermaidCode + '\\n' + fence;
      const lines = String(markdownText || '').split('\\n');
      let start = -1;
      let end = -1;
      for (let index = 0; index < lines.length; index += 1) {
        if (start < 0 && lines[index].trim().toLowerCase() === fence + 'mermaid') {
          start = index;
          continue;
        }
        if (start >= 0 && index > start && lines[index].trim().startsWith(fence)) {
          end = index;
          break;
        }
      }
      if (start >= 0 && end >= start) {
        return [...lines.slice(0, start), block, ...lines.slice(end + 1)].join('\\n');
      }
      return markdownText + '\\n\\n## \\u6d41\\u7a0b\\u56fe\\n\\n' + block + '\\n';
    }
    function mermaidToEdgeList(mermaidCode) {
      return String(mermaidCode || '')
        .split('\\n')
        .map((line) => line.trim())
        .filter((line) => /-->|---|==>/.test(line))
        .map((line) => line
          .replace(/^\\w+\\s+/u, '')
          .replace(/\\[([^\\]]+)\\]/gu, '$1')
          .replace(/\\(([^)]+)\\)/gu, '$1')
          .replace(/\\s*(-->|---|==>)\\s*/u, ' --> '))
        .join('\\n');
    }
    function edgeListToMermaid(edgeList) {
      const labels = new Map();
      const getId = (label) => {
        const clean = String(label || '').trim();
        if (!labels.has(clean)) labels.set(clean, 'N' + (labels.size + 1));
        return labels.get(clean);
      };
      const lines = String(edgeList || '')
        .split('\\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\\s*-->\\s*/u);
          if (parts.length < 2) return '';
          const from = parts[0].trim();
          const to = parts.slice(1).join(' --> ').trim();
          if (!from || !to) return '';
          return '  ' + getId(from) + '[' + from.replace(/[\\[\\]]/g, '') + '] --> ' + getId(to) + '[' + to.replace(/[\\[\\]]/g, '') + ']';
        })
        .filter(Boolean);
      return ['flowchart TD', ...lines].join('\\n');
    }
    function escapeHtmlClient(value) {
      return String(value || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }
    function clientMarkdownToHtml(markdownText) {
      return escapeHtmlClient(markdownText)
        .replace(/^### (.*)$/gm, '<h3>$1</h3>')
        .replace(/^## (.*)$/gm, '<h2>$1</h2>')
        .replace(/^# (.*)$/gm, '<h1>$1</h1>')
        .replace(new RegExp('\\\\x60\\\\x60\\\\x60mermaid\\\\n([\\\\s\\\\S]*?)\\\\x60\\\\x60\\\\x60', 'g'), '<pre class="mermaid">$1</pre>')
        .replace(new RegExp('\\\\x60\\\\x60\\\\x60([\\\\s\\\\S]*?)\\\\x60\\\\x60\\\\x60', 'g'), '<pre><code>$1</code></pre>')
        .replace(/^[-*] (.*)$/gm, '<ul><li>$1</li></ul>')
        .replace(/\\n{2,}/g, '<br><br>');
    }
  </script>
</body>
</html>
`;
}

function buildCombinedMarkdown(results, generatedAt) {
  const rows = results.map((item, index) => [
    index + 1,
    path.basename(item.input),
    item.generatedFileName,
    path.basename(item.summaryMarkdown),
    path.basename(item.summaryHtml),
    item.archivedOriginal ? path.join('original', path.basename(item.archivedOriginal)) : 'N/A',
    item.viewerHtml ? path.basename(item.viewerHtml) : 'N/A'
  ]);

  return [
    `# ${zh.archiveTitle}`,
    '',
    `${zh.generatedAt}: ${generatedAt.toISOString()}`,
    '',
    `${zh.processedCount}: ${results.length}`,
    '',
    `## ${zh.outputIndex}`,
    '',
    `| # | ${zh.originalFile} | ${zh.generatedBaseName} | ${zh.markdownFile} | ${zh.htmlFile} | Original | Viewer |`,
    '|---:|---|---|---|---|---|---|',
    ...rows.map((row) => `| ${row.join(' | ')} |`)
  ].join('\n');
}

function uniqueFileBaseName(suggestedName, originalPath, usedBaseNames) {
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

function extractFencedCodeBlocks(markdown, language) {
  const blocks = [];
  const target = String(language || '').toLowerCase();
  const lines = String(markdown || '').split('\n');
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!current && trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim().toLowerCase();
      if (lang === target) current = [];
      continue;
    }
    if (current && trimmed.startsWith('```')) {
      blocks.push(current.join('\n').trim());
      current = null;
      continue;
    }
    if (current) current.push(line);
  }

  return blocks;
}

function parseImportantInfo(markdown) {
  const section = extractMarkdownSection(markdown, '重要信息提取');
  return {
    raw: section || '原文未明确',
    tasks: parseTableRows(section, ['任务', '负责人', '截止时间', '优先级', '状态']),
    issues: parseTableRows(section, ['问题', '影响', '建议']),
    codeRecords: parseCodeLikeLines(section)
  };
}

function extractMarkdownSection(markdown, title) {
  const lines = String(markdown || '').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start < 0) return '';
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index].trim())) break;
    body.push(lines[index]);
  }
  return body.join('\n').trim();
}

function parseTableRows(markdown, expectedColumns) {
  const lines = String(markdown || '').split('\n').filter((line) => line.trim().startsWith('|'));
  if (lines.length < 3) return [];
  const headers = splitMarkdownTableRow(lines[0]);
  const hasExpectedColumn = expectedColumns.some((column) => headers.some((header) => header.includes(column)));
  if (!hasExpectedColumn) return [];
  return lines.slice(2).map((line) => {
    const cells = splitMarkdownTableRow(line);
    return Object.fromEntries(headers.map((header, index) => [header || `column${index + 1}`, cells[index] || '']));
  });
}

function parseCodeLikeLines(markdown) {
  return String(markdown || '')
    .split('\n')
    .filter((line) => /`[^`]+`|OPENAI_|CLAWHUB_|npm\s+|git\s+|\.ya?ml|\.json|\.js/iu.test(line))
    .map((line) => line.trim())
    .filter(Boolean);
}

function validateMermaid(code) {
  const value = String(code || '').trim();
  const errors = [];
  if (!value) errors.push('Mermaid code is empty.');
  if (!/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|journey|pie|mindmap|timeline)\b/iu.test(value)) {
    errors.push('Mermaid code should start with a supported diagram keyword.');
  }
  if ((value.match(/\[/g) || []).length !== (value.match(/\]/g) || []).length) {
    errors.push('Unbalanced square brackets.');
  }
  if ((value.match(/\{/g) || []).length !== (value.match(/\}/g) || []).length) {
    errors.push('Unbalanced curly braces.');
  }
  return {
    ok: errors.length === 0,
    errors
  };
}

function validatePlantUml(code) {
  const value = String(code || '').trim();
  const errors = [];
  if (!value) errors.push('PlantUML code is empty.');
  if (!value.includes('@startuml')) errors.push('Missing @startuml.');
  if (!value.includes('@enduml')) errors.push('Missing @enduml.');
  return {
    ok: errors.length === 0,
    errors
  };
}

function sanitizeFileBaseName(value) {
  return cleanPdfText(String(value || ''))
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80)
    .trim();
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').split('\n');
  const html = [];
  let paragraph = [];
  let listOpen = false;
  let tableRows = [];
  let codeBlock = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${formatInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listOpen) return;
    html.push('</ul>');
    listOpen = false;
  };
  const flushTable = () => {
    if (tableRows.length === 0) return;
    const [header, separator, ...body] = tableRows;
    if (!isMarkdownTableSeparator(separator || '')) {
      paragraph.push(...tableRows);
      tableRows = [];
      return;
    }

    html.push('<table>');
    html.push('<thead><tr>');
    for (const cell of splitMarkdownTableRow(header)) html.push(`<th>${formatInlineMarkdown(cell)}</th>`);
    html.push('</tr></thead>');
    html.push('<tbody>');
    for (const row of body) {
      html.push('<tr>');
      for (const cell of splitMarkdownTableRow(row)) html.push(`<td>${formatInlineMarkdown(cell)}</td>`);
      html.push('</tr>');
    }
    html.push('</tbody></table>');
    tableRows = [];
  };
  const flushBlocks = () => {
    flushTable();
    flushParagraph();
    closeList();
  };
  const flushCodeBlock = () => {
    if (!codeBlock) return;
    const code = codeBlock.lines.join('\n');
    if (codeBlock.lang === 'mermaid') {
      html.push(`<pre class="mermaid">${escapeHtml(code)}</pre>`);
    } else if (codeBlock.lang === 'plantuml' || codeBlock.lang === 'puml') {
      html.push(`<pre class="plantuml"><code>${escapeHtml(code)}</code></pre>`);
    } else {
      html.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    }
    codeBlock = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (codeBlock) {
      if (line.startsWith('```')) {
        flushCodeBlock();
      } else {
        codeBlock.lines.push(rawLine);
      }
      continue;
    }
    if (line.startsWith('```')) {
      flushBlocks();
      codeBlock = {
        lang: line.slice(3).trim().toLowerCase(),
        lines: []
      };
      continue;
    }
    if (!line) {
      flushBlocks();
      continue;
    }
    if (line.startsWith('|') && line.endsWith('|')) {
      flushParagraph();
      closeList();
      tableRows.push(line);
      continue;
    }

    flushTable();
    if (line.startsWith('# ')) {
      flushBlocks();
      html.push(`<h1>${formatInlineMarkdown(line.slice(2).trim())}</h1>`);
    } else if (line.startsWith('## ')) {
      flushBlocks();
      html.push(`<h2>${formatInlineMarkdown(line.slice(3).trim())}</h2>`);
    } else if (line.startsWith('### ')) {
      flushBlocks();
      html.push(`<h3>${formatInlineMarkdown(line.slice(4).trim())}</h3>`);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      flushParagraph();
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${formatInlineMarkdown(line.slice(2).trim())}</li>`);
    } else {
      closeList();
      paragraph.push(line);
    }
  }

  flushCodeBlock();
  flushBlocks();
  return html.join('\n');
}

function isMarkdownTableSeparator(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(line);
}

function splitMarkdownTableRow(line) {
  return line
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((cell) => cell.trim());
}

function formatInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function cleanOcrText(text) {
  return String(text || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\ue000-\uf8ff]/g, '')
    .replace(/[\u25a0-\u25ff\ufffd]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanGeneratedMarkdown(markdown) {
  return String(markdown || '')
    .replace(/[\u25a0-\u25ff\ufffd]+/g, '')
    .replace(/[\ue000-\uf8ff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function cleanPdfText(text) {
  return String(text || '')
    .replace(/[\u25a0-\u25ff\ufffd]+/g, '')
    .replace(/[\ue000-\uf8ff]/g, '')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .trim();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

