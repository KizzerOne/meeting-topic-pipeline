import fs from 'node:fs/promises';
import path from 'node:path';
import { markitdownExtensions, sidecarExtensions } from '../constants.js';
import { extractDocumentText } from './extract.js';
import { sanitizeFileBaseName, toBrowserPath, escapeHtml } from './paths.js';
import { modelExtensions, imageExtensions, viewableModelExtensions } from '../constants.js';

export async function readImageAsDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const buffer = await fs.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export async function buildModelArchiveText(filePath, ocrLang) {
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

export async function findSidecarFiles(filePath) {
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

export async function extractSidecarText(filePath, ocrLang) {
  const ext = path.extname(filePath).toLowerCase();
  if (markitdownExtensions.has(ext)) return extractDocumentText(filePath, ocrLang);
  throw new Error(`Unsupported sidecar file type: ${filePath}`);
}

export async function archiveOriginalIfNeeded(inputPath, outputDir) {
  const ext = path.extname(inputPath).toLowerCase();
  if (!modelExtensions.has(ext) && !imageExtensions.has(ext)) return '';

  const originalsDir = path.join(outputDir, 'original');
  await fs.mkdir(originalsDir, { recursive: true });
  const archivedPath = path.join(originalsDir, path.basename(inputPath));
  await fs.copyFile(inputPath, archivedPath);
  return archivedPath;
}

export async function writeModelViewerIfNeeded(inputPath, archivedOriginal, outputDir) {
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
