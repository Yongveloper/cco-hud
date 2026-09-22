import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  StdinInput,
  StdinRateLimit,
  Config,
  UsageLimits,
  RateLimitInfo,
  BurnEstimate,
} from '../types.js';
import { fetchUsageLimits } from './api-client.js';
import { debugError } from './errors.js';

const HISTORY_FILE = path.join(os.homedir(), '.claude', 'cco-hud-usage-history.json');
const SAMPLE_MIN_INTERVAL_MS = 60_000;
const HISTORY_RETENTION_MS = 6 * 60 * 60_000;
const BURN_MIN_SPAN_MS = 5 * 60_000;
export const FIVE_HOUR_MS = 5 * 60 * 60_000;
export const SEVEN_DAY_MS = 7 * 24 * 60 * 60_000;

export interface UsageSample {
  /** epoch ms */
  t: number;
  five_hour?: number;
  seven_day?: number;
}

type BurnKey = 'five_hour' | 'seven_day';

export async function resolveRateLimits(
  stdin: StdinInput,
  config: Config,
): Promise<UsageLimits | null> {
  try {
    const native = fromNative(stdin.rate_limits);

    let api: UsageLimits | null = null;
    if (config.plan !== 'pro') {
      try {
        api = await fetchUsageLimits(config.cache.ttlSeconds);
      } catch (e) {
        debugError('rate-limits api', e);
      }
    }

    if (!native && !api) return null;

    const merged = merge(native, api);
    merged.burn = computeBurnAll(merged, Date.now());
    return merged;
  } catch (e) {
    debugError('rate-limits', e);
    return null;
  }
}

// --- Native ---

function fromNative(rl: StdinInput['rate_limits']): UsageLimits | null {
  if (!rl) return null;
  const five_hour = mapNative(rl.five_hour);
  const seven_day = mapNative(rl.seven_day);
  if (!five_hour && !seven_day) return null;
  return { five_hour, seven_day, source: 'native' };
}

function mapNative(l: StdinRateLimit | undefined): RateLimitInfo | undefined {
  if (!l || typeof l.used_percentage !== 'number') return undefined;
  const info: RateLimitInfo = { utilization: l.used_percentage };
  if (typeof l.resets_at === 'number' && Number.isFinite(l.resets_at)) {
    info.resets_at = new Date(l.resets_at * 1000).toISOString();
  }
  return info;
}

// --- Merge ---

function merge(native: UsageLimits | null, api: UsageLimits | null): UsageLimits {
  if (native && !api) return native;
  if (!native && api) return { ...api, source: 'api' };
  const n = native as UsageLimits;
  const a = api as UsageLimits;
  return {
    five_hour: mergeInfo(n.five_hour, a.five_hour),
    seven_day: mergeInfo(n.seven_day, a.seven_day),
    seven_day_sonnet: a.seven_day_sonnet,
    seven_day_scoped: a.seven_day_scoped,
    source: 'merged',
  };
}

/** Native wins for utilization/resets_at; API supplies is_active/severity. */
function mergeInfo(
  native: RateLimitInfo | undefined,
  api: RateLimitInfo | undefined,
): RateLimitInfo | undefined {
  if (!native) return api;
  const out: RateLimitInfo = { ...native };
  if (api?.is_active !== undefined) out.is_active = api.is_active;
  if (api?.severity !== undefined) out.severity = api.severity;
  if (out.resets_at === undefined && api?.resets_at !== undefined) out.resets_at = api.resets_at;
  return out;
}

// --- Burn rate ---

function computeBurnAll(limits: UsageLimits, nowMs: number): UsageLimits['burn'] {
  const samples = updateHistory(limits, nowMs);
  const burn: NonNullable<UsageLimits['burn']> = {};
  const fh = limits.five_hour;
  if (fh) {
    const est = computeBurn(samples, 'five_hour', fh.utilization, fh.resets_at, FIVE_HOUR_MS, nowMs);
    if (est) burn.five_hour = est;
  }
  const sd = limits.seven_day;
  if (sd) {
    const est = computeBurn(samples, 'seven_day', sd.utilization, sd.resets_at, SEVEN_DAY_MS, nowMs);
    if (est) burn.seven_day = est;
  }
  return Object.keys(burn).length > 0 ? burn : undefined;
}

/**
 * Pure linear burn estimate.
 * Only samples inside the current window (t >= resets_at - windowMs) count.
 * Needs >= 2 samples spanning >= 5 minutes. hitsLimitAt only set when before resets_at.
 */
export function computeBurn(
  samples: UsageSample[],
  key: BurnKey,
  current: number,
  resetsAtIso: string | undefined,
  windowMs: number,
  nowMs: number,
): BurnEstimate | undefined {
  const resetsAtMs = resetsAtIso ? Date.parse(resetsAtIso) : NaN;
  const windowStart = Number.isFinite(resetsAtMs) ? resetsAtMs - windowMs : nowMs - windowMs;

  const pts = samples
    .filter((s) => typeof s[key] === 'number' && s.t >= windowStart && s.t <= nowMs)
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return undefined;

  const first = pts[0];
  const last = pts[pts.length - 1];
  const spanMs = last.t - first.t;
  if (spanMs < BURN_MIN_SPAN_MS) return undefined;

  const hours = spanMs / 3_600_000;
  const ratePerHour = ((last[key] as number) - (first[key] as number)) / hours;
  const est: BurnEstimate = { ratePerHour };

  if (ratePerHour > 0 && current < 100) {
    const hitMs = nowMs + ((100 - current) / ratePerHour) * 3_600_000;
    if (!Number.isFinite(resetsAtMs) || hitMs < resetsAtMs) {
      est.hitsLimitAt = new Date(hitMs).toISOString();
    }
  }
  return est;
}

// --- Sample history (~/.claude/cco-hud-usage-history.json) ---

function updateHistory(limits: UsageLimits, nowMs: number): UsageSample[] {
  let samples = loadHistory();
  samples = samples.filter((s) => nowMs - s.t <= HISTORY_RETENTION_MS);

  const last = samples[samples.length - 1];
  const hasData = limits.five_hour !== undefined || limits.seven_day !== undefined;
  if (hasData && (!last || nowMs - last.t >= SAMPLE_MIN_INTERVAL_MS)) {
    const sample: UsageSample = { t: nowMs };
    if (limits.five_hour) sample.five_hour = limits.five_hour.utilization;
    if (limits.seven_day) sample.seven_day = limits.seven_day.utilization;
    samples.push(sample);
    saveHistory(samples);
  }
  return samples;
}

function loadHistory(): UsageSample[] {
  try {
    const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (s): s is UsageSample => s && typeof s.t === 'number' && Number.isFinite(s.t),
    );
  } catch {
    return [];
  }
}

function saveHistory(samples: UsageSample[]): void {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${HISTORY_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(samples), { mode: 0o600 });
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (e) {
    debugError('usage history write', e);
  }
}
