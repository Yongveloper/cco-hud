/**
 * Progressive trimming when a line overflows the terminal. render/index.ts
 * re-renders with increasing `ctx.trim` until the line fits (or MAX).
 * Session line drops: badges → token count → bar shrinks → cost → weekly reset → scoped limits.
 * Project line drops: session name → skill → config counts → stats → duration.
 */
export const TRIM = {
  BADGES: 1,
  SESSION_NAME: 1,
  TOKENS: 2,
  SKILL: 2,
  BAR: 3,
  COUNTS: 3,
  COST: 4,
  STATS: 4,
  WEEKLY_RESET: 5,
  DURATION: 5,
  SCOPED: 6,
  MAX: 6,
} as const;

/** Width of the progress bar in terminal characters */
export const PROGRESS_BAR_WIDTH = 10;

/** Width of the progress bar once TRIM.BAR is reached */
export const PROGRESS_BAR_WIDTH_COMPACT = 6;


/** Progress bar glyphs */
export const BAR_FILLED = '█';
export const BAR_EMPTY = '░';

/** Color threshold: dim → yellow (absolute fallback) */
export const COLOR_THRESHOLD_WARNING = 50;

/** Color threshold: yellow → red (absolute fallback) */
export const COLOR_THRESHOLD_DANGER = 80;

/** Context % threshold for showing token breakdown */
export const CONTEXT_HIGH_THRESHOLD = 85;

/** Context % at which ` ⚠ /compact` hint is appended */
export const CONTEXT_WARN_THRESHOLD = 80;

/** Context % at which the whole context group turns red */
export const CONTEXT_DANGER_THRESHOLD = 90;




/** Prompt cache hit ratio (%) below which the badge turns yellow */
export const CACHE_WARN_THRESHOLD = 70;

/** Max visual width for session_name in the project line */
export const SESSION_NAME_MAX_WIDTH = 30;


/** Max running tools to display */
export const MAX_RUNNING_TOOLS = 2;

/** Max completed tool types to display (sorted by frequency) */
export const MAX_COMPLETED_TOOL_TYPES = 4;

/** Max agents to display at once */
export const MAX_AGENTS_DISPLAY = 3;

/** Max completed agents to show */
export const MAX_COMPLETED_AGENTS = 2;

/** Max description length for agent entries */
export const MAX_AGENT_DESC_LENGTH = 40;

/** Max content length for todo entries */
export const MAX_TODO_CONTENT_LENGTH = 50;

/** Max recent tools kept from transcript */
export const MAX_TRANSCRIPT_TOOLS = 20;

/** Max recent agents kept from transcript */
export const MAX_TRANSCRIPT_AGENTS = 10;

/** Timeout for stdin reading in milliseconds */
export const STDIN_TIMEOUT_MS = 2000;

/** Timeout for external process calls (git, security keychain) in milliseconds */
export const EXEC_TIMEOUT_MS = 3000;

/** Timeout for API requests in milliseconds */
export const API_TIMEOUT_MS = 5000;

/** Max age for stale cache fallback in seconds */
export const STALE_CACHE_MAX_AGE_S = 3600;

/** TTL for negative (error) cache in seconds */
export const NEGATIVE_CACHE_TTL_S = 30;

/** Stale lock auto-cleanup threshold in seconds */
export const LOCK_STALE_S = 30;

/** Max wait time for lock acquisition in milliseconds */
export const LOCK_WAIT_MS = 2000;
