// ---------------------------------------------------------------------------
// Claude Code statusLine stdin (Claude Code 2.1.278, captured 2026-09-22)
// ---------------------------------------------------------------------------

export interface StdinRateLimit {
  used_percentage: number;
  /** Unix epoch seconds */
  resets_at: number;
}

export interface StdinInput {
  session_id?: string;
  session_name?: string;
  prompt_id?: string;
  transcript_path?: string;
  cwd?: string;
  scratchpad_dir?: string;
  version?: string;
  model: {
    id?: string;
    display_name: string;
  };
  workspace?: {
    current_dir?: string;
    project_dir?: string;
    added_dirs?: string[];
    git_worktree?: string;
    repo?: { host?: string; owner?: string; name?: string };
  };
  cost: {
    total_cost_usd: number;
    total_duration_ms?: number;
    total_api_duration_ms?: number;
    total_lines_added?: number;
    total_lines_removed?: number;
  };
  context_window: {
    context_window_size: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
    current_usage?: {
      input_tokens: number;
      output_tokens?: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
    used_percentage?: number;
    remaining_percentage?: number;
  };
  exceeds_200k_tokens?: boolean;
  effort?: { level: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | string };
  fast_mode?: boolean;
  thinking?: { enabled: boolean };
  prompt_cache?: {
    warm?: boolean;
    caching_observed?: boolean;
    ttl?: string;
    expires_at?: number;
    requests?: number;
    misses?: number;
    hit_ratio?: number;
  };
  rate_limits?: {
    five_hour?: StdinRateLimit;
    seven_day?: StdinRateLimit;
    spend_limit?: StdinRateLimit;
  };
  output_style?: { name: string };
  vim?: { mode: string };
  agent?: { name: string };
  pr?: { number?: number; url?: string; review_state?: string; kind?: string };
  worktree?: { name?: string; path?: string; branch?: string };
}

// ---------------------------------------------------------------------------
// Config (~/.claude/cco-hud.local.json)
// ---------------------------------------------------------------------------

export interface Config {
  language: 'en' | 'ko' | 'auto';
  plan: 'pro' | 'max100' | 'max200' | 'enterprise';
  cache: {
    ttlSeconds: number;
  };
  display?: {
    showTools?: boolean;
    showAgents?: boolean;
    showTodos?: boolean;
    showStats?: boolean;
    showTokenBreakdown?: boolean;
    /** Show session cost ($) for every plan. Default true. */
    showCost?: boolean;
    /** Show effort / fast / thinking / cache badges. Default true. */
    showBadges?: boolean;
    /** Terminal width below which compact layout is used. Default 100. */
    compactWidth?: number;
  };
}

export const DEFAULT_CONFIG: Config = {
  language: 'ko',
  plan: 'max100',
  cache: {
    ttlSeconds: 300,
  },
};

// ---------------------------------------------------------------------------
// Rate limits (merged: native stdin.rate_limits first, OAuth usage API second)
// ---------------------------------------------------------------------------

export interface RateLimitInfo {
  /** 0-100 */
  utilization: number;
  /** ISO-8601 string (native epoch is converted) */
  resets_at?: string;
  /** From usage API limits[]: whether this limit is the currently binding one */
  is_active?: boolean;
  /** From usage API limits[]: 'normal' | 'warning' | 'critical' | ... */
  severity?: string;
}

/** Linear burn estimate over recent samples inside the current window */
export interface BurnEstimate {
  /** utilization points per hour (may be 0) */
  ratePerHour: number;
  /** ISO time when utilization reaches 100 at this rate; undefined if never / after reset */
  hitsLimitAt?: string;
}

export interface UsageLimits {
  five_hour?: RateLimitInfo;
  seven_day?: RateLimitInfo;
  seven_day_sonnet?: RateLimitInfo;
  /** Model-scoped weekly limit from usage API limits[] (e.g. Fable) */
  seven_day_scoped?: RateLimitInfo & { model: string };
  burn?: {
    five_hour?: BurnEstimate;
    seven_day?: BurnEstimate;
  };
  /** 'native' = stdin.rate_limits, 'api' = usage API, 'merged' = both */
  source: 'native' | 'api' | 'merged';
}

// ---------------------------------------------------------------------------
// Misc data
// ---------------------------------------------------------------------------

export interface GitInfo {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
}

export interface ConfigCounts {
  claudeMdCount: number;
  rulesCount: number;
  mcpCount: number;
  hooksCount: number;
}

export interface ToolEntry {
  name: string;
  target?: string;
  status: 'running' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
}

export interface AgentEntry {
  type: string;
  model?: string;
  description?: string;
  status: 'running' | 'completed';
  startTime: Date;
  endTime?: Date;
}

export interface TodoEntry {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TranscriptData {
  sessionStart?: Date;
  tools: ToolEntry[];
  agents: AgentEntry[];
  todos: TodoEntry[];
  lastSkill?: { name: string; timestamp: Date };
  isThinking?: boolean;
  toolCallCount: number;
  agentCallCount: number;
  skillCallCount: number;
}

export interface RenderContext {
  stdin: StdinInput;
  config: Config;
  transcript: TranscriptData;
  configCounts: ConfigCounts;
  gitInfo?: GitInfo;
  sessionDuration: string;
  rateLimits: UsageLimits | null;
  /** Terminal columns ($COLUMNS → process.stdout.columns → 120) */
  termWidth: number;
  /** termWidth < config.display.compactWidth (default 100) */
  compact: boolean;
  /** Date.now() captured once per render */
  now: number;
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

export interface Translations {
  labels: {
    '5h': string;
    '7d': string;
    '7d_all': string;
    '7d_sonnet': string;
    cost: string;
    /** e.g. "한도까지" / "limit in" — prefix for burn ETA */
    limitIn: string;
    /** e.g. "리셋" / "reset" */
    reset: string;
    pr: string;
    cache: string;
  };
  time: {
    hours: string;
    minutes: string;
    shortHours: string;
    shortMinutes: string;
    shortDays: string;
  };
  errors: {
    no_context: string;
  };
  contextWarning?: {
    warning: string;
    critical: string;
  };
  todos: {
    allComplete: string;
  };
  stats: {
    thinking: string;
  };
}
