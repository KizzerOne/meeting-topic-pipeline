import { escapeHtml } from './paths.js';

export function stripMarkdownFence(value) {
  return String(value || '')
    .replace(/^```(?:markdown|md)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
}

export function hasRequiredLlmModelConfigSections(markdown) {
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

export function buildFallbackLlmModelConfig(sources) {
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

export function maskSensitiveContent(value) {
  return String(value || '')
    .replace(/(api[_-]?key|token|password|passwd|secret|cookie|authorization)(\s*[:=]\s*)(["']?)[^\s"'`]+/giu, '$1$2$3<REDACTED>')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|sess-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/gu, '<REDACTED>')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, '<REDACTED>');
}

export function parseSummaryResponse(raw) {
  const value = String(raw || '').trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/iu);
  const cleaned = fenced ? fenced[1].trim() : value.replace(/^```(?:json)?/i, '').replace(/```$/u, '').trim();
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

export function parseJsonObject(raw) {
  try {
    const parsed = JSON.parse(String(raw || '').trim());
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function extractFencedCodeBlocks(markdown, language) {
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

export function parseImportantInfo(markdown) {
  const section = extractMarkdownSection(markdown, '重要信息提取');
  return {
    raw: section || '原文未明确',
    tasks: parseTableRows(section, ['任务', '负责人', '截止时间', '优先级', '状态']),
    issues: parseTableRows(section, ['问题', '影响', '建议']),
    codeRecords: parseCodeLikeLines(section)
  };
}

export function extractMarkdownSection(markdown, title) {
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

export function parseTableRows(markdown, expectedColumns) {
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

export function parseCodeLikeLines(markdown) {
  return String(markdown || '')
    .split('\n')
    .filter((line) => /`[^`]+`|OPENAI_|CLAWHUB_|npm\s+|git\s+|\.ya?ml|\.json|\.js/iu.test(line))
    .map((line) => line.trim())
    .filter(Boolean);
}

export function validateMermaid(code) {
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

export function validatePlantUml(code) {
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

export function cleanOcrText(text) {
  return String(text || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\ue000-\uf8ff]/g, '')
    .replace(/[\u25a0-\u25ff\ufffd]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanGeneratedMarkdown(markdown) {
  return String(markdown || '')
    .replace(/[\u25a0-\u25ff\ufffd]+/g, '')
    .replace(/[\ue000-\uf8ff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function cleanPdfText(text) {
  return String(text || '')
    .replace(/[\u25a0-\u25ff\ufffd]+/g, '')
    .replace(/[\ue000-\uf8ff]/g, '')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .trim();
}

export function isMarkdownTableSeparator(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(line);
}

export function splitMarkdownTableRow(line) {
  return line
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function formatInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdownToHtml(markdown) {
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
