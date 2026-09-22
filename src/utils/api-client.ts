import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { UsageLimits, RateLimitInfo } from '../types.js';
import { getCredentials } from './credentials.js';
import { debugError, debugTrace } from './errors.js';
import {
  API_TIMEOUT_MS,
  STALE_CACHE_MAX_AGE_S,
  NEGATIVE_CACHE_TTL_S,
  LOCK_STALE_S,
  LOCK_WAIT_MS,
} from '../constants.js';

const CACHE_DIR = path.join(os.homedir(), '.claude');
const CACHE_FILE = path.join(CACHE_DIR, 'cco-hud-cache.json');
const NEGATIVE_CACHE_FILE = path.join(CACHE_DIR, 'cco-hud-ncache.json');
const LOCK_FILE = path.join(CACHE_DIR, 'cco-hud-usage.lock');
const ANTHROPIC_BETA_HEADER = 'oauth-2025-04-20';

const API_HEADERS_BASE = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'claude-code/2.1',
  'anthropic-beta': ANTHROPIC_BETA_HEADER,
};

export async function fetchUsageLimits(ttlSeconds = 60): Promise<UsageLimits | null> {
  // 1. Negative cache — suppress retries during error storms
  if (isNegativeCached()) {
    debugTrace('api', 'negative cache hit');
    return loadFileCache(STALE_CACHE_MAX_AGE_S);
  }

  // 2. Fresh cache hit
  const freshCache = loadFileCache(ttlSeconds);
  if (freshCache) {
    debugTrace('api', 'file cache hit');
    return freshCache;
  }

  // 3. Stampede prevention — acquire exclusive lock
  let lockFd: number | null = null;
  try {
    cleanStaleLock();
    lockFd = fs.openSync(LOCK_FILE, 'wx');
  } catch {
    debugTrace('api', 'lock contention, waiting');
    await waitForLock();
    const stale = loadFileCache(STALE_CACHE_MAX_AGE_S);
    if (stale) {
      debugTrace('api', 'stale fallback after lock wait');
      return stale;
    }
    return null;
  }

  try {
    return await doFetch();
  } finally {
    releaseLock(lockFd);
  }
}

async function doFetch(): Promise<UsageLimits | null> {
  debugTrace('api', 'cache expired, fetching');
  let token: string | null = await getCredentials();
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: { ...API_HEADERS_BASE, Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // 429 retry-after handling
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') ?? '', 10);
      if (retryAfter > 0 && retryAfter <= 10) {
        debugTrace('api', `429 retry after ${retryAfter}s`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));

        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), API_TIMEOUT_MS);
        const retryResponse = await fetch('https://api.anthropic.com/api/oauth/usage', {
          method: 'GET',
          headers: { ...API_HEADERS_BASE, Authorization: `Bearer ${token}` },
          signal: retryController.signal,
        });
        clearTimeout(retryTimeout);
        token = null;

        if (retryResponse.ok) {
          const data = await retryResponse.json();
          const limits = extractLimits(data);
          saveFileCache(limits);
          clearNegativeCache();
          debugTrace('api', '429 retry ok');
          return limits;
        }
      }

      token = null;
      debugTrace('api', '429 failed');
      saveNegativeCache();
      return loadFileCache(STALE_CACHE_MAX_AGE_S);
    }

    token = null;

    if (!response.ok) {
      saveNegativeCache();
      const stale = loadFileCache(STALE_CACHE_MAX_AGE_S);
      if (stale) debugTrace('api', 'stale fallback');
      return stale;
    }

    const data = await response.json();
    const limits = extractLimits(data);
    saveFileCache(limits);
    clearNegativeCache();
    debugTrace('api', 'fetch ok');
    return limits;
  } catch (e) {
    token = null;
    debugError('API fetch', e);
    saveNegativeCache();
    const stale = loadFileCache(STALE_CACHE_MAX_AGE_S);
    if (stale) debugTrace('api', 'stale fallback on error');
    return stale;
  }
}

function extractLimits(data: Record<string, unknown>): UsageLimits {
  const limits = Array.isArray(data.limits) ? (data.limits as LimitEntry[]) : [];
  return {
    five_hour: withMeta(data.five_hour as RateLimitInfo | undefined, findLimit(limits, 'session')),
    seven_day: withMeta(data.seven_day as RateLimitInfo | undefined, findLimit(limits, 'weekly_all')),
    seven_day_sonnet: (data.seven_day_sonnet as UsageLimits['seven_day_sonnet']) ?? undefined,
    seven_day_scoped: extractScopedLimit(limits),
    source: 'api',
  };
}

interface LimitEntry {
  kind?: string;
  percent?: number;
  resets_at?: string | null;
  severity?: string;
  is_active?: boolean;
  scope?: { model?: { display_name?: string } };
}

function findLimit(limits: LimitEntry[], kind: string): LimitEntry | undefined {
  return limits.find((l) => l?.kind === kind);
}

// Copy severity/is_active from limits[] entry onto the top-level info object
function withMeta(
  info: RateLimitInfo | undefined,
  entry: LimitEntry | undefined,
): RateLimitInfo | undefined {
  if (!info || !entry) return info;
  const out: RateLimitInfo = { ...info };
  if (typeof entry.severity === 'string') out.severity = entry.severity;
  if (typeof entry.is_active === 'boolean') out.is_active = entry.is_active;
  return out;
}

// Model-scoped weekly limit (e.g. Fable) — only exposed via limits[] array, not a top-level key
function extractScopedLimit(limits: LimitEntry[]): UsageLimits['seven_day_scoped'] {
  for (const l of limits) {
    if (l?.kind !== 'weekly_scoped') continue;
    const model = l?.scope?.model?.display_name;
    if (typeof model !== 'string' || typeof l.percent !== 'number') continue;
    const scoped: UsageLimits['seven_day_scoped'] = {
      model,
      utilization: l.percent,
      resets_at: l.resets_at ?? undefined,
    };
    if (typeof l.severity === 'string') scoped.severity = l.severity;
    if (typeof l.is_active === 'boolean') scoped.is_active = l.is_active;
    return scoped;
  }
  return undefined;
}

// --- File cache ---

function loadFileCache(maxAgeSeconds: number): UsageLimits | null {
  try {
    const content = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    const ageSeconds = (Date.now() - content.timestamp) / 1000;
    if (ageSeconds < maxAgeSeconds) return { ...(content.data as UsageLimits), source: 'api' };
    return null;
  } catch {
    return null;
  }
}

function saveFileCache(data: UsageLimits): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    }
    const tmpFile = CACHE_FILE + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify({ data, timestamp: Date.now() }), { mode: 0o600 });
    fs.renameSync(tmpFile, CACHE_FILE);
  } catch (e) {
    debugError('cache write', e);
  }
}

// --- Negative cache (separate file so stale fallback is preserved) ---

function isNegativeCached(): boolean {
  try {
    const content = JSON.parse(fs.readFileSync(NEGATIVE_CACHE_FILE, 'utf-8'));
    return (Date.now() - content.timestamp) / 1000 < NEGATIVE_CACHE_TTL_S;
  } catch {
    return false;
  }
}

function saveNegativeCache(): void {
  try {
    const tmpFile = NEGATIVE_CACHE_FILE + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify({ timestamp: Date.now() }), { mode: 0o600 });
    fs.renameSync(tmpFile, NEGATIVE_CACHE_FILE);
  } catch (e) {
    debugError('negative cache write', e);
  }
}

function clearNegativeCache(): void {
  try {
    fs.unlinkSync(NEGATIVE_CACHE_FILE);
  } catch {
    /* file may not exist */
  }
}

// --- Stampede lock ---

function cleanStaleLock(): void {
  try {
    const stat = fs.statSync(LOCK_FILE);
    if (Date.now() - stat.mtimeMs > LOCK_STALE_S * 1000) {
      fs.unlinkSync(LOCK_FILE);
      debugTrace('api', 'removed stale lock');
    }
  } catch {
    /* lock doesn't exist */
  }
}

async function waitForLock(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < LOCK_WAIT_MS) {
    try {
      fs.statSync(LOCK_FILE);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function releaseLock(fd: number | null): void {
  if (fd !== null) {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      /* ignore */
    }
  }
}
