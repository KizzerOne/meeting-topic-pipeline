import { TOPIC_MODULE_SECTIONS } from '../constants.js';
import { escapeHtml, sanitizeFileBaseName } from './paths.js';
import { extractMarkdownSection, markdownToHtml } from './text.js';

const TEMPLATE_CSS = `
:root {
  --bg: #f0f2f5;
  --panel: #ffffff;
  --text: #1f2a3a;
  --muted: #5f6b7a;
  --border: #e8eaed;
  --accent: #3370ff;
  --accent-soft: #f0f5ff;
  --risk: #cf1322;
  --risk-bg: #fff1f0;
  --new: #08979c;
  --new-bg: #e6fffb;
  --updated: #d48806;
  --updated-bg: #fffbe6;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.55;
}
.page { max-width: 1200px; margin: 0 auto; padding: 20px 16px 48px; }
.top-bar {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.top-bar h1 { margin: 0 0 6px; font-size: 22px; font-weight: 600; }
.top-bar .meta { color: var(--muted); font-size: 13px; }
.topic-nav {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin-top: 14px;
}
.topic-nav a {
  text-decoration: none;
  font-size: 13px;
  color: var(--muted);
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #fff;
}
.topic-nav a:hover, .topic-nav a.active {
  color: var(--accent);
  border-color: #cfe0ff;
  background: var(--accent-soft);
}
.section {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 22px;
  margin-bottom: 14px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}
.section h2 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.section-body { font-size: 14px; }
.section-body table { width: 100%; border-collapse: collapse; font-size: 13px; }
.section-body th, .section-body td {
  border: 1px solid var(--border);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}
.section-body th { background: #f6f8fa; font-weight: 600; }
.section-body ul { margin: 0; padding-left: 20px; }
.section-body p { margin: 0 0 8px; }
.section-body p:last-child { margin-bottom: 0; }
.change-new { color: var(--new); background: var(--new-bg); padding: 1px 6px; border-radius: 4px; }
.change-updated { color: var(--updated); background: var(--updated-bg); padding: 1px 6px; border-radius: 4px; }
.change-risk { color: var(--risk); background: var(--risk-bg); padding: 1px 6px; border-radius: 4px; }
.footer { color: var(--muted); font-size: 12px; margin-top: 8px; }
`;

function parseMarkdownSections(markdown) {
  const lines = String(markdown || '').split('\n');
  const sections = new Map();
  let currentTitle = null;
  let body = [];

  const flush = () => {
    if (!currentTitle) return;
    const content = body.join('\n').trim();
    if (content) sections.set(currentTitle, content);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) continue;
    if (trimmed.startsWith('## ')) {
      flush();
      currentTitle = trimmed.slice(2).trim();
      body = [];
      continue;
    }
    if (currentTitle) body.push(line);
  }
  flush();
  return sections;
}

function resolveSectionContent(sectionMap, spec) {
  const titles = [spec.title, ...(spec.aliases || [])];
  for (const title of titles) {
    const content = sectionMap.get(title);
    if (content) return content;
  }
  return '';
}

export function normalizeTopicModuleMarkdown(topicName, rawMarkdown) {
  const sectionMap = parseMarkdownSections(rawMarkdown);
  const lines = [`# ${topicName}`, ''];

  for (const spec of TOPIC_MODULE_SECTIONS) {
    const content = resolveSectionContent(sectionMap, spec) || spec.fallback || '原文未明确。';
    lines.push(`## ${spec.title}`, '', content, '');
  }

  return lines.join('\n').trim() + '\n';
}

function renderInlineWithChangeSpans(value) {
  const parts = String(value || '').split(/(<span class="change-(?:new|updated|risk)">[\s\S]*?<\/span>)/giu);
  return parts.map((part) => {
    const match = part.match(/^<span class="change-(new|updated|risk)">([\s\S]*)<\/span>$/iu);
    if (match) {
      return `<span class="change-${match[1]}">${escapeHtml(match[2])}</span>`;
    }
    return escapeHtml(part)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }).join('');
}

function sectionBodyToHtml(markdown) {
  const text = String(markdown || '').trim();
  if (!text) return '<p>原文未明确。</p>';
  if (text.includes('<span class="change-')) {
    const lines = text.split('\n');
    const htmlParts = [];
    let buffer = [];
    const flushBuffer = () => {
      if (buffer.length === 0) return;
      htmlParts.push(markdownToHtml(buffer.join('\n')));
      buffer = [];
    };
    for (const line of lines) {
      if (line.trim().startsWith('|') || line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        buffer.push(line);
      } else if (line.trim()) {
        flushBuffer();
        htmlParts.push(`<p>${renderInlineWithChangeSpans(line)}</p>`);
      }
    }
    flushBuffer();
    return htmlParts.join('\n') || '<p>原文未明确。</p>';
  }
  return markdownToHtml(text);
}

export function buildTopicModuleHtml({
  topicName,
  markdown,
  moduleLinks = [],
  markdownPath = '',
  updatedAt = new Date().toISOString()
}) {
  const slug = sanitizeFileBaseName(topicName);
  const navItems = moduleLinks.map((item) => {
    const itemSlug = sanitizeFileBaseName(item.name);
    const active = itemSlug === slug ? ' active' : '';
    const href = encodeURI(`${itemSlug}.html`);
    return `<a href="${href}" class="${active.trim()}">${escapeHtml(item.name)}</a>`;
  }).join('');

  const sectionsHtml = TOPIC_MODULE_SECTIONS.map((spec) => {
    const body = extractMarkdownSection(markdown, spec.title) || spec.fallback || '原文未明确。';
    return `
<section class="section" id="${escapeHtml(sanitizeFileBaseName(spec.title))}">
  <h2>${escapeHtml(spec.title)}</h2>
  <div class="section-body">${sectionBodyToHtml(body)}</div>
</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(topicName)} · Topic 知识库</title>
  <style>${TEMPLATE_CSS}</style>
</head>
<body>
  <div class="page">
    <header class="top-bar">
      <h1>${escapeHtml(topicName)}</h1>
      <p class="meta">KPIT Topic 模块 · 更新时间 ${escapeHtml(updatedAt)}</p>
      <nav class="topic-nav" aria-label="Topic 导航">
        <a href="../index.html">知识库索引</a>
        <a href="../../index.html">输出总目录</a>
        ${navItems}
      </nav>
    </header>
    ${sectionsHtml}
    <p class="footer">Markdown 源：${escapeHtml(markdownPath || 'modules/' + slug + '.md')}</p>
  </div>
</body>
</html>`;
}

export function buildFlexibleDocumentHtml({
  topicName,
  markdown,
  moduleLinks = [],
  markdownPath = '',
  updatedAt = new Date().toISOString()
}) {
  const sectionMap = parseMarkdownSections(markdown);
  const slug = sanitizeFileBaseName(topicName);
  const navItems = moduleLinks.map((item) => {
    const itemSlug = sanitizeFileBaseName(item.name);
    const active = itemSlug === slug ? ' active' : '';
    return `<a href="modules/${encodeURI(itemSlug)}.html" class="${active.trim()}">${escapeHtml(item.name)}</a>`;
  }).join('');

  const sectionsHtml = [...sectionMap.entries()].map(([title, body]) => `
<section class="section" id="${escapeHtml(sanitizeFileBaseName(title))}">
  <h2>${escapeHtml(title)}</h2>
  <div class="section-body">${sectionBodyToHtml(body)}</div>
</section>`).join('\n');

  const indexHref = topicName === '会议总览' ? 'index.html' : '../index.html';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(topicName)} · Topic 知识库</title>
  <style>${TEMPLATE_CSS}</style>
</head>
<body>
  <div class="page">
    <header class="top-bar">
      <h1>${escapeHtml(topicName)}</h1>
      <p class="meta">KPIT 会议知识库 · 更新时间 ${escapeHtml(updatedAt)}</p>
      <nav class="topic-nav" aria-label="Topic 导航">
        <a href="${indexHref}">知识库索引</a>
        <a href="../../index.html">输出总目录</a>
        ${navItems}
      </nav>
    </header>
    ${sectionsHtml || '<section class="section"><div class="section-body"><p>原文未明确。</p></div></section>'}
    <p class="footer">Markdown 源：${escapeHtml(markdownPath || '')}</p>
  </div>
</body>
</html>`;
}

export function buildTopicKnowledgeIndexHtml({
  modules = [],
  updatedAt = new Date().toISOString()
}) {
  const rows = modules.map((item) => {
    const slug = sanitizeFileBaseName(item.name);
    return `<tr>
      <td><a href="modules/${encodeURI(slug)}.html">${escapeHtml(item.name)}</a></td>
      <td><a href="modules/${encodeURI(slug)}.md">Markdown</a></td>
      <td>${escapeHtml(item.status || 'stable')}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>会议知识库索引</title>
  <style>${TEMPLATE_CSS}</style>
</head>
<body>
  <div class="page">
    <header class="top-bar">
      <h1>会议知识库索引</h1>
      <p class="meta">更新时间 ${escapeHtml(updatedAt)} · ${modules.length} 个 Topic 模块</p>
      <nav class="topic-nav">
        <a href="../index.html">输出总目录</a>
        <a href="overall-summary.html">会议总览</a>
      </nav>
    </header>
    <section class="section">
      <h2>功能模块</h2>
      <div class="section-body">
        <table>
          <thead><tr><th>模块</th><th>Markdown</th><th>状态</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  </div>
</body>
</html>`;
}
