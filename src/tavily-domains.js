import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = path.resolve(moduleDir, '../config/tavily_domain_profiles.json');

let cachedConfig = null;
let cachedConfigPath = null;

export async function loadTavilyDomainConfig(configPath = defaultConfigPath) {
  if (cachedConfig && cachedConfigPath === configPath) return cachedConfig;
  const text = await fs.readFile(configPath, 'utf8');
  cachedConfig = JSON.parse(text);
  cachedConfigPath = configPath;
  return cachedConfig;
}

function uniqueDomains(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function collectTopicText(topic = {}) {
  return [
    topic.label,
    topic.definition,
    topic.scope,
    ...(topic.aliases || []),
    ...(topic.tags || []),
    ...(topic.path || []),
    ...(topic.proposed_path || []),
    ...(topic.entities || [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function tagMatchesTopicText(tag, topicText) {
  const normalized = String(tag).toLowerCase();
  if (!normalized) return false;
  if (normalized.length <= 4) {
    const pattern = new RegExp(`(?:^|[\\s_/-])${escapeRegExp(normalized)}(?:$|[\\s_/-])`, 'iu');
    return pattern.test(topicText) || topicText === normalized;
  }
  return topicText.includes(normalized);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scoreProfile(profile, topicText) {
  let score = 0;
  for (const tag of profile.topic_tags || []) {
    if (tagMatchesTopicText(tag, topicText)) score += 1;
  }
  return score;
}

export function matchDomainProfiles(topic = {}, config = {}) {
  const topicText = collectTopicText(topic);
  const profiles = (config.domain_profiles || [])
    .map((profile) => ({ profile, score: scoreProfile(profile, topicText) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return profiles.map((item) => item.profile);
}

export function resolvePmDimensionDomains(pmDimension, config = {}) {
  const entry = config.pm_dimension_domains?.[pmDimension];
  return entry?.include_domains || [];
}

export function buildIncludeDomainsForTopic(topic = {}, config = {}, options = {}) {
  const maxDomains = options.maxDomains ?? 12;
  const matchedProfiles = matchDomainProfiles(topic, config);
  const pmDomains = resolvePmDimensionDomains(topic.pm_dimension, config);

  const merged = uniqueDomains([
    ...(config.global_baseline_include_domains || []),
    ...pmDomains,
    ...matchedProfiles.flatMap((profile) => profile.include_domains || [])
  ]);

  if (merged.length <= maxDomains) return merged;
  return merged.slice(0, maxDomains);
}

export function buildExcludeDomains(config = {}) {
  return uniqueDomains(config.global_exclude_domains || []);
}

export function getSearchDefaults(config = {}) {
  return {
    search_depth: 'advanced',
    chunks_per_source: 3,
    max_results: 10,
    include_raw_content: 'markdown',
    include_answer: 'advanced',
    min_score: 0.55,
    extract_min_score: 0.65,
    extract_top_urls: 5,
    ...(config.search_defaults || {})
  };
}

export function getSearchStrategy(config = {}) {
  return {
    open_queries_per_topic: 2,
    domain_queries_per_topic: 2,
    optional_news_query: true,
    news_time_range: 'month',
    ...(config.search_strategy || {})
  };
}

export function getTopicPromoteThreshold(config = {}) {
  const value = Number(config.topic_promote_threshold);
  return Number.isFinite(value) ? value : 0.9;
}

/**
 * Build dual-track Tavily query plan:
 * - open web queries (no include_domains)
 * - domain-qualified queries (include_domains from matched profiles)
 */
export function buildDualTrackQueryPlan(topic = {}, config = {}, baseQueries = []) {
  const strategy = getSearchStrategy(config);
  const includeDomains = buildIncludeDomainsForTopic(topic, config);
  const excludeDomains = buildExcludeDomains(config);
  const queries = baseQueries.length > 0 ? baseQueries : buildDefaultQueries(topic);

  const openCount = Math.min(strategy.open_queries_per_topic, queries.length);
  const openQueries = queries.slice(0, openCount).map((query) => ({
    track: 'open',
    query,
    include_domains: undefined,
    exclude_domains: excludeDomains
  }));

  const domainQueries = queries
    .slice(0, strategy.domain_queries_per_topic)
    .map((query) => ({
      track: 'domain-qualified',
      query,
      include_domains: includeDomains,
      exclude_domains: excludeDomains
    }));

  const plan = [...openQueries, ...domainQueries];

  if (strategy.optional_news_query && queries[0]) {
    plan.push({
      track: 'news',
      query: queries[0],
      include_domains: includeDomains,
      exclude_domains: excludeDomains,
      time_range: strategy.news_time_range
    });
  }

  return {
    matched_profile_ids: matchDomainProfiles(topic, config).map((profile) => profile.id),
    include_domains: includeDomains,
    exclude_domains: excludeDomains,
    queries: plan
  };
}

function buildDefaultQueries(topic = {}) {
  const label = topic.label || (topic.path || []).slice(-1)[0] || 'project topic';
  const parent = (topic.path || []).slice(-2, -1)[0] || 'robotics automation';
  return [
    `${label} definition architecture best practices`,
    `${label} open source commercial comparison`,
    `${parent} ${label} implementation pitfalls risks`,
    `${label} industry benchmark evaluation`
  ];
}
