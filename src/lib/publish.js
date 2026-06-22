import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, options } from '../context.js';
import { toBrowserPath, escapeHtml } from './paths.js';

export async function publishDocsSite() {
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

export async function listDocsPublishableFiles(dir) {
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

export function buildDocsIndexHtml(pages) {
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
