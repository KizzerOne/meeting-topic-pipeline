import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, options } from '../context.js';
import { escapeHtml, sanitizeFileBaseName, toBrowserPath } from './paths.js';
import { loadSkillInstructions } from './skills.js';
import { cleanGeneratedMarkdown, markdownToHtml } from './text.js';

export async function writeSummaryHtml(filePath, markdown, title, markdownPath = '') {
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

export async function writeGeneratedHtml(filePath, htmlContent, title, fallbackMarkdown, markdownPath = '') {
  const html = cleanGeneratedHtml(htmlContent, title) || buildFallbackVisualHtml(title, fallbackMarkdown, markdownPath);
  await fs.writeFile(filePath, html, 'utf8');
}

export async function writeArchiveHtml(filePath, results, startedAt, markdownPath = '') {
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

export function cleanGeneratedHtml(raw, title) {
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

export function buildFallbackVisualHtml(title, markdown, markdownPath = '') {
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

export function visualHtmlBaseCss() {
  return `
    :root{--bg:#f6f8fb;--panel:#fff;--text:#202733;--muted:#687386;--border:#d9e0ea;--blue:#2f6fed;--green:#25b36b;--amber:#f6b73c;--red:#ef5b5b;--purple:#7c5cff}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,"Microsoft YaHei",sans-serif;line-height:1.55}.page-shell{max-width:1180px;margin:0 auto;padding:28px 18px 56px}.hero-panel,.visual-panel,.metric-card,.owner-card{background:var(--panel);border:1px solid var(--border);border-radius:8px}.hero-panel{padding:28px;margin-bottom:16px}.eyebrow{margin:0 0 8px;color:var(--blue);font-size:13px;font-weight:700;text-transform:uppercase}.hero-panel h1{margin:0 0 10px;font-size:30px;letter-spacing:0}.muted{color:var(--muted)}.topic-nav{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.topic-nav a,.tag{border:1px solid var(--border);background:#fff;border-radius:999px;padding:5px 10px;color:var(--text);text-decoration:none;font-size:13px}.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}.metric-card{padding:16px}.metric-card span{display:block;color:var(--muted);font-size:13px}.metric-card strong{display:block;font-size:30px;margin-top:6px}.visual-panel{padding:18px;margin:14px 0;overflow:auto}.visual-panel h2{margin:0 0 14px;font-size:20px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid var(--border);padding:9px 10px;text-align:left;vertical-align:top}th{background:#f2f5fa}.flow-svg,.chart-svg{width:100%;min-height:180px}.flow-node rect{fill:#fff;stroke:var(--blue);stroke-width:1.5;rx:8}.flow-node text{text-anchor:middle;font-size:13px;fill:var(--text)}.flow-line{stroke:#4b5563;stroke-width:1.5;marker-end:url(#arrow);fill:none}.timeline{display:grid;grid-template-columns:repeat(4,minmax(160px,1fr));gap:12px}.timeline-item{border-left:3px solid var(--blue);padding:8px 10px;background:#f8fbff}.roadmap{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.roadmap div{background:#f8fbff;border:1px solid var(--border);border-radius:8px;padding:12px}.gantt-row{display:grid;grid-template-columns:120px 1fr;gap:10px;align-items:center;margin:8px 0}.gantt-bar{height:20px;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--green));}.owners{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.owner-card{padding:14px}.radar-wrap{max-width:420px}.footer-note{color:var(--muted);font-size:12px;margin-top:18px}@media(max-width:760px){.metric-grid,.timeline,.roadmap,.owners{grid-template-columns:1fr}.hero-panel h1{font-size:24px}}`;
}

export function extractSimpleRows(text, keywords) {
  return String(text || '').split('\n').map((line) => line.trim()).filter((line) => line && keywords.some((keyword) => line.includes(keyword)));
}

export function countMatches(text, regex) {
  return (String(text || '').match(regex) || []).length;
}

export function fallbackTimelineSection() {
  return '<section class="visual-panel" id="timeline"><h2>时间线</h2><div class="timeline"><div class="timeline-item"><strong>Start</strong><p>source not explicit</p></div><div class="timeline-item"><strong>Plan</strong><p>source not explicit</p></div><div class="timeline-item"><strong>Execute</strong><p>source not explicit</p></div><div class="timeline-item"><strong>Review</strong><p>source not explicit</p></div></div></section>';
}

export function fallbackRoadmapSection() {
  return '<section class="visual-panel" id="roadmap"><h2>路线图</h2><div class="roadmap"><div><strong>Phase 1</strong><p>source not explicit</p></div><div><strong>Phase 2</strong><p>source not explicit</p></div><div><strong>Phase 3</strong><p>source not explicit</p></div><div><strong>Phase 4</strong><p>source not explicit</p></div></div></section>';
}

export function fallbackFlowchartSection() {
  return `<section class="visual-panel" id="flowchart"><h2>流程图</h2><svg class="flow-svg" viewBox="0 0 760 160"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563"/></marker></defs><g class="flow-node"><rect x="20" y="50" width="150" height="56"/><text x="95" y="83">Input</text></g><g class="flow-node"><rect x="220" y="50" width="150" height="56"/><text x="295" y="83">Analyze</text></g><g class="flow-node"><rect x="420" y="50" width="150" height="56"/><text x="495" y="83">Decide</text></g><g class="flow-node"><rect x="620" y="50" width="120" height="56"/><text x="680" y="83">Output</text></g><path class="flow-line" d="M170 78 H220"/><path class="flow-line" d="M370 78 H420"/><path class="flow-line" d="M570 78 H620"/></svg></section>`;
}

export function fallbackGanttSection() {
  return '<section class="visual-panel" id="gantt"><h2>甘特图</h2><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div></section>';
}

export function fallbackBenchmarkSection() {
  return '<section class="visual-panel" id="benchmark"><h2>模型 Benchmark 对比图</h2><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div><div class="gantt-row"><span>source not explicit</span><div class="gantt-bar" style="width:25%"></div></div></section>';
}

export function fallbackRadarSection() {
  return `<section class="visual-panel radar-wrap" id="radar"><h2>雷达图</h2><svg class="chart-svg" viewBox="0 0 320 280"><polygon points="160,30 276,105 232,235 88,235 44,105" fill="#f4f7ff" stroke="#b7c4d9"/><polygon points="160,70 230,115 206,205 106,205 90,120" fill="rgba(47,111,237,.22)" stroke="#2f6fed" stroke-width="2"/><text x="160" y="20" text-anchor="middle">Accuracy</text><text x="292" y="108">Speed</text><text x="236" y="260">Cost</text><text x="44" y="260">Stability</text><text x="5" y="108">Coverage</text></svg></section>`;
}

export function fallbackOwnerCardsSection() {
  return '<section class="visual-panel" id="owners"><h2>任务负责人卡片</h2><div class="owners"><article class="owner-card"><strong>Owner</strong><p>source not explicit</p><span class="tag">open</span></article><article class="owner-card"><strong>Reviewer</strong><p>source not explicit</p><span class="tag">pending</span></article><article class="owner-card"><strong>Support</strong><p>source not explicit</p><span class="tag">watch</span></article></div></section>';
}

export async function convertMarkdownToHtmlWithClawHub(markdown, title, endpoint) {
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

export function normalizeHtmlDocument(html, title) {
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

export function extractHtmlBody(html) {
  const value = String(html || '').trim();
  if (!value) return '';
  const match = value.match(/<body[^>]*>([\s\S]*?)<\/body>/iu);
  return match ? match[1].trim() : value;
}

export function buildSummaryHtml(markdown, title, skillInstructions = [], markdownPath = '', renderedHtml = '') {
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
