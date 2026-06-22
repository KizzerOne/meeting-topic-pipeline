import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pdfParse from 'pdf-parse';
import {
  markitdownExtensions,
  imageExtensions,
  modelExtensions,
  supportedExtensions,
  textExtensions,
  clawhubMarkdownMaxBytes
} from '../constants.js';
import { options } from '../context.js';
import { runCommand } from './process.js';
import { cleanOcrText } from './text.js';

export async function extractZip(filePath, outputDir) {
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

export async function listSupportedFilesRecursive(dir) {
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

export async function extractInputContent(filePath, ocrLang) {
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

export async function extractDocumentText(filePath, ocrLang) {
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

export async function shouldUseClawHubMarkdown(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > clawhubMarkdownMaxBytes) {
    console.warn(`Skipping ClawHub Markdown Converter for ${filePath}: file is ${(stat.size / 1024 / 1024).toFixed(1)} MB and exceeds the safe upload limit.`);
    return false;
  }
  return true;
}

export async function extractTextWithClawHub(filePath, endpoint) {
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

export async function extractTextWithMarkitdown(filePath) {
  const { stdout } = await runCommand('markitdown', [filePath]);
  return cleanOcrText(stdout);
}

export async function extractPdfText(filePath, ocrLang) {
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

export async function extractPdfTextWithOcr(filePath, ocrLang) {
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
