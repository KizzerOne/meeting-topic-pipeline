import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { projectRoot, options } from './context.js';
import {
  resolveInputPaths,
  resolveMarkdownInputPaths,
  expandArchiveInputs,
  validateInputNames,
  buildKpitComparisonContext
} from './lib/io.js';
import { extractInputContent } from './lib/extract.js';
import { archiveOriginalIfNeeded, writeModelViewerIfNeeded } from './lib/archive.js';
import { summarizeInput, processSkillInputs, summarizeVisualHtml } from './lib/summarize.js';
import { writeGeneratedHtml } from './lib/html.js';
import { writeSkillsHtmlSite } from './lib/skills.js';
import { publishDocsSite } from './lib/publish.js';
import { updateMeetingKnowledge } from './meeting-knowledge.js';
import { writeTopicSidecar } from './lib/sidecar.js';
import { CANONICAL_SUMMARY_BASE } from './constants.js';
import { outputFolderForInput, replaceExtension, uniqueFileBaseName } from './lib/paths.js';

function resolveOutputBaseName(generated, inputPath, usedBaseNames, workItemCount) {
  if (options.outputByInputName) {
    if (workItemCount === 1) {
      usedBaseNames.add(CANONICAL_SUMMARY_BASE.toLowerCase());
      return CANONICAL_SUMMARY_BASE;
    }
    const stem = path.basename(inputPath, path.extname(inputPath));
    return uniqueFileBaseName(stem, inputPath, usedBaseNames);
  }
  return uniqueFileBaseName(generated.fileName, inputPath, usedBaseNames);
}

async function runExternalKnowledgeExpand() {
  const { spawn } = await import('node:child_process');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/expand-topic-knowledge.js'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: process.env
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`expand-topic-knowledge exited with code ${code}`))));
  });
}

export async function main() {
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
    if (!options.disableExternalKnowledgeExpand) {
      await runExternalKnowledgeExpand();
    }
    return;
  }

  if (options.expandExternalKnowledgeOnly) {
    await runExternalKnowledgeExpand();
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
      const baseName = resolveOutputBaseName(generated, inputPath, usedBaseNames, workItems.length);
      const markdownPath = path.join(outputDir, `${baseName}.md`);
      const htmlSummaryPath = path.join(outputDir, `${baseName}.html`);

      await fs.writeFile(markdownPath, generated.summary, 'utf8');
      await writeGeneratedHtml(htmlSummaryPath, generated.htmlContent, `${baseName} Summary`, generated.summary, markdownPath);
      await writeTopicSidecar(outputDir, {
        sourceInput: path.relative(projectRoot, inputPath),
        suggestedTitle: generated.fileName,
        summaryMarkdownPath: markdownPath
      });

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
    if (!options.disableExternalKnowledgeExpand) {
      await runExternalKnowledgeExpand().catch((error) => {
        console.warn(`External knowledge expansion skipped: ${error.message}`);
      });
    }
  }
  const docsIndex = await publishDocsSite();
  console.log(`GitHub Pages docs index: ${docsIndex}`);

  console.log(`Processed ${results.length} file(s).`);
  console.log(`Output directory: ${outputDir}`);
}
