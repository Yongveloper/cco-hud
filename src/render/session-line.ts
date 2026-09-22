import type { RateLimitInfo, RenderContext, Translations } from '../types.js';
import {
  COLORS,
  RESET,
  BOLD,
  SEP,
  SEP_INNER,
  colorize,
  dim,
  getStatusColor,
  getWindowedColor,
  renderProgressBar,
} from '../utils/colors.js';
import {
  formatTokens,
  formatTimeRemaining,
  formatDaysRemaining,
  shortenModelName,
} from '../utils/formatters.js';
import {
  CONTEXT_HIGH_THRESHOLD,
  CONTEXT_WARN_THRESHOLD,
  CONTEXT_DANGER_THRESHOLD,
  CACHE_WARN_THRESHOLD,
  PROGRESS_BAR_WIDTH,
  PROGRESS_BAR_WIDTH_COMPACT,
  WINDOW_5H_MS,
  WINDOW_7D_MS,
} from '../constants.js';

export function renderSessionLine(ctx: RenderContext, t: Translations): string {
  const parts: string[] = [];

  parts.push(renderModelGroup(ctx, t));

  const context = renderContextGroup(ctx, t);
  if (!context) {
    parts.push(dim(t.errors.no_context));
    return parts.join(SEP);
  }
  parts.push(context);

  parts.push(...renderRateLimitGroups(ctx, t));

  const cost = renderCost(ctx);
  if (cost) parts.push(cost);

  return parts.join(SEP);
}

// --- model + badges -------------------------------------------------------

const EFFORT_ABBR: Record<string, string> = {
  low: 'lo',
  medium: 'md',
  high: 'hi',
  xhigh: 'xh',
  max: 'mx',
};

function renderModelGroup(ctx: RenderContext, t: Translations): string {
  const model = colorize(shortenModelName(ctx.stdin.model.display_name), COLORS.cyan);
  const badges = ctx.config.display?.showBadges !== false ? renderBadges(ctx, t) : [];
  return [model, ...badges].join(' ');
}

function renderBadges(ctx: RenderContext, t: Translations): string[] {
  const { stdin, compact } = ctx;
  const badges: string[] = [];

  if (!compact && stdin.effort?.level) {
    const abbr = EFFORT_ABBR[stdin.effort.level] ?? stdin.effort.level.slice(0, 2);
    badges.push(dim(`e:${abbr}`));
  }
  if (stdin.fast_mode) badges.push(dim('fast'));
  if (!compact && stdin.thinking?.enabled) badges.push(dim('θ'));
  if (!compact && stdin.prompt_cache?.hit_ratio != null) {
    const pct = Math.round(stdin.prompt_cache.hit_ratio * 100);
    const color = pct < CACHE_WARN_THRESHOLD ? COLORS.yellow : COLORS.dim;
    badges.push(colorize(`${t.labels.cache} ${pct}%`, color));
  }
  return badges;
}

// --- context --------------------------------------------------------------

function resolveContextPercent(ctx: RenderContext): { percent: number; used: number } | null {
  const cw = ctx.stdin.context_window;
  const usage = cw.current_usage;
  const used = usage
    ? usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
    : 0;

  if (cw.used_percentage != null) {
    return { percent: Math.min(100, Math.round(cw.used_percentage)), used };
  }
  if (usage && cw.context_window_size > 0) {
    return { percent: Math.min(100, Math.round((used / cw.context_window_size) * 100)), used };
  }
  return null;
}

function renderContextGroup(ctx: RenderContext, _t: Translations): string | null {
  const resolved = resolveContextPercent(ctx);
  if (!resolved) return null;
  const { percent, used } = resolved;
  const cw = ctx.stdin.context_window;

  const danger = percent >= CONTEXT_DANGER_THRESHOLD;
  const color = getStatusColor(percent, { warn: CONTEXT_WARN_THRESHOLD, danger: CONTEXT_DANGER_THRESHOLD });
  const textColor = danger ? COLORS.red : COLORS.dim;
  const width = ctx.compact ? PROGRESS_BAR_WIDTH_COMPACT : PROGRESS_BAR_WIDTH;

  const items: string[] = [renderProgressBar(percent, width, color), colorize(`${percent}%`, color)];

  if (!ctx.compact) {
    items.push(colorize(`${formatTokens(used)}/${formatTokens(cw.context_window_size)}`, textColor));

    if (
      percent >= CONTEXT_HIGH_THRESHOLD &&
      cw.current_usage &&
      ctx.config.display?.showTokenBreakdown !== false
    ) {
      const u = cw.current_usage;
      const inTok = formatTokens(u.input_tokens);
      const cacheTok = formatTokens(u.cache_creation_input_tokens + u.cache_read_input_tokens);
      items.push(colorize(`(in ${inTok} · cache ${cacheTok})`, textColor));
    }
  }

  if (percent >= CONTEXT_WARN_THRESHOLD) {
    items.push(colorize('⚠ /compact', danger ? COLORS.red : COLORS.yellow));
  }

  return items.join(' ');
}

// --- rate limits ----------------------------------------------------------

function renderPct(limit: RateLimitInfo, color: string): string {
  const pct = Math.round(limit.utilization);
  const prefix = limit.is_active === true ? BOLD : '';
  return `${prefix}${color}${pct}%${RESET}`;
}

function renderBurnWarning(hitsLimitAt: string | undefined, ctx: RenderContext, t: Translations): string {
  if (!hitsLimitAt) return '';
  const eta = formatTimeRemaining(hitsLimitAt, t, ctx.now);
  return ` ${colorize(`⚠ ${t.labels.limitIn} ${eta}`, COLORS.yellow)}`;
}

function renderFiveHour(limit: RateLimitInfo, ctx: RenderContext, t: Translations): string {
  const color = getWindowedColor(limit.utilization, limit.resets_at, WINDOW_5H_MS, ctx.now);
  let text = `${dim(t.labels['5h'])} ${renderPct(limit, color)}`;
  if (limit.resets_at) text += ` ${dim(`↺${formatTimeRemaining(limit.resets_at, t, ctx.now)}`)}`;
  text += renderBurnWarning(ctx.rateLimits?.burn?.five_hour?.hitsLimitAt, ctx, t);
  return text;
}

function renderSevenDay(ctx: RenderContext, t: Translations): string | null {
  const limits = ctx.rateLimits!;
  const { seven_day, seven_day_sonnet, seven_day_scoped } = limits;
  if (!seven_day && !seven_day_sonnet && !seven_day_scoped) return null;

  const items: string[] = [];
  const windowColor = (l: RateLimitInfo) =>
    getWindowedColor(l.utilization, l.resets_at ?? seven_day?.resets_at, WINDOW_7D_MS, ctx.now);

  if (seven_day) {
    let text = `${dim(t.labels['7d'])} ${renderPct(seven_day, windowColor(seven_day))}`;
    if (!ctx.compact && seven_day.resets_at) {
      text += ` ${dim(`↺${formatDaysRemaining(seven_day.resets_at, t, ctx.now)}`)}`;
    }
    items.push(text);
  }

  if (!ctx.compact) {
    if (seven_day_sonnet) {
      items.push(`${dim(t.labels['7d_sonnet'])} ${renderPct(seven_day_sonnet, windowColor(seven_day_sonnet))}`);
    }
    if (seven_day_scoped) {
      items.push(`${dim(seven_day_scoped.model)} ${renderPct(seven_day_scoped, windowColor(seven_day_scoped))}`);
    }
  }

  if (items.length === 0) return null;
  return items.join(SEP_INNER) + renderBurnWarning(limits.burn?.seven_day?.hitsLimitAt, ctx, t);
}

function renderRateLimitGroups(ctx: RenderContext, t: Translations): string[] {
  const limits = ctx.rateLimits;
  const isEnterprise = ctx.config.plan === 'enterprise';
  const groups: string[] = [];

  if (isEnterprise) {
    groups.push(`${dim(t.labels.cost)} ${colorize(formatCostUsd(ctx.stdin.cost.total_cost_usd), COLORS.cyan)}`);
    if (limits?.five_hour) groups.push(renderFiveHour(limits.five_hour, ctx, t));
    return groups;
  }

  if (!limits) return [colorize('? limits', COLORS.yellow)];

  if (limits.five_hour) groups.push(renderFiveHour(limits.five_hour, ctx, t));

  const isMaxPlan = ctx.config.plan === 'max100' || ctx.config.plan === 'max200';
  if (isMaxPlan) {
    const weekly = renderSevenDay(ctx, t);
    if (weekly) groups.push(weekly);
  }

  return groups;
}

// --- cost -----------------------------------------------------------------

function formatCostUsd(cost: number): string {
  if (cost >= 100) return `$${Math.round(cost)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  return `$${cost.toFixed(2)}`;
}

function renderCost(ctx: RenderContext): string | null {
  if (ctx.config.plan === 'enterprise') return null; // already shown in place of limits
  if (ctx.config.display?.showCost === false) return null;
  return dim(formatCostUsd(ctx.stdin.cost.total_cost_usd));
}
