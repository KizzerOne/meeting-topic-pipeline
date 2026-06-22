import {
  buildDualTrackQueryPlan,
  getSearchDefaults,
  loadTavilyDomainConfig
} from './tavily-domains.js';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';

function getTavilyApiKey() {
  return process.env.TAVILY_API_KEY || '';
}

async function postTavily(url, body, apiKey) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Tavily HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  return JSON.parse(raw);
}

function normalizeResults(results = [], minScore = 0) {
  return results
    .map((item) => ({
      title: item.title || '',
      url: item.url || '',
      score: Number(item.score || 0),
      content: item.content || '',
      raw_content: item.raw_content || ''
    }))
    .filter((item) => item.url && item.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

export async function searchTavily(query, searchOptions = {}, config = {}) {
  const apiKey = getTavilyApiKey();
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is missing. Add it to .env or GitHub Actions secrets.');
  }

  const defaults = getSearchDefaults(config);
  const body = {
    query,
    search_depth: searchOptions.search_depth || defaults.search_depth,
    chunks_per_source: searchOptions.chunks_per_source ?? defaults.chunks_per_source,
    max_results: searchOptions.max_results ?? defaults.max_results,
    include_raw_content: searchOptions.include_raw_content || defaults.include_raw_content,
    include_answer: searchOptions.include_answer || defaults.include_answer
  };

  if (searchOptions.include_domains?.length) {
    body.include_domains = searchOptions.include_domains;
  }
  if (searchOptions.exclude_domains?.length) {
    body.exclude_domains = searchOptions.exclude_domains;
  }
  if (searchOptions.time_range) {
    body.time_range = searchOptions.time_range;
  }

  const response = await postTavily(TAVILY_SEARCH_URL, body, apiKey);
  const minScore = searchOptions.min_score ?? defaults.min_score;
  return {
    query,
    track: searchOptions.track || 'custom',
    answer: response.answer || '',
    results: normalizeResults(response.results, minScore)
  };
}

export async function extractTavilyUrls(urls, config = {}) {
  const apiKey = getTavilyApiKey();
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is missing. Add it to .env or GitHub Actions secrets.');
  }
  if (!urls.length) return [];

  const response = await postTavily(
    TAVILY_EXTRACT_URL,
    {
      urls,
      extract_depth: 'advanced',
      format: 'markdown'
    },
    apiKey
  );

  return (response.results || []).map((item) => ({
    url: item.url || '',
    raw_content: item.raw_content || ''
  }));
}

export async function expandTopicExternalKnowledge(topic = {}, options = {}) {
  const config = options.config || await loadTavilyDomainConfig(options.configPath);
  const defaults = getSearchDefaults(config);
  const plan = buildDualTrackQueryPlan(topic, config, options.queries || []);
  const searchBatches = [];
  const seenUrls = new Set();

  for (const item of plan.queries) {
    const batch = await searchTavily(item.query, {
      track: item.track,
      include_domains: item.include_domains,
      exclude_domains: item.exclude_domains,
      time_range: item.time_range,
      min_score: defaults.min_score
    }, config);
    searchBatches.push(batch);
  }

  const mergedResults = [];
  for (const batch of searchBatches) {
    for (const result of batch.results) {
      if (seenUrls.has(result.url)) continue;
      seenUrls.add(result.url);
      mergedResults.push({ ...result, source_track: batch.track, source_query: batch.query });
    }
  }

  mergedResults.sort((a, b) => b.score - a.score);
  const extractCandidates = mergedResults
    .filter((item) => item.score >= defaults.extract_min_score)
    .slice(0, defaults.extract_top_urls)
    .map((item) => item.url);

  const extracted = await extractTavilyUrls(extractCandidates, config);

  return {
    topic: {
      label: topic.label,
      path: topic.path || topic.proposed_path || []
    },
    matched_profile_ids: plan.matched_profile_ids,
    include_domains: plan.include_domains,
    exclude_domains: plan.exclude_domains,
    query_plan: plan.queries,
    search_batches: searchBatches,
    merged_results: mergedResults,
    extracted_pages: extracted
  };
}
