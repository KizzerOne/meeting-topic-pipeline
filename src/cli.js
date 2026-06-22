import { Command } from 'commander';

export function parseCli() {
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
  .option('--ontology-path <file>', 'Topic ontology JSON file.', process.env.ONTOLOGY_PATH || 'topic-ontology/ontology.json')
  .option('--expand-external-knowledge-only', 'Expand Tavily external knowledge for emerging ontology topics and exit.', false)
  .option('--disable-external-knowledge-expand', 'Skip Tavily external knowledge expansion after meeting knowledge update.', false)
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

return program.opts();
}
