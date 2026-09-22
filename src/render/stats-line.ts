import type { RenderContext, Translations } from '../types.js';
import { COLORS, SEP, colorize, dim } from '../utils/colors.js';

export function renderStatsLine(ctx: RenderContext, t: Translations): string {
  const parts: string[] = [];
  const tr = ctx.transcript;

  if (tr.isThinking) {
    parts.push(colorize(`∴ ${t.stats.thinking}`, COLORS.magenta));
  }

  if (tr.lastSkill) {
    parts.push(colorize(`◇ skill:${tr.lastSkill.name}`, COLORS.cyan));
  }

  const lines = renderLinesChanged(ctx.stdin.cost.total_lines_added, ctx.stdin.cost.total_lines_removed);
  if (lines) parts.push(lines);

  return parts.join(SEP);
}

function renderLinesChanged(added?: number, removed?: number): string | null {
  if (added == null && removed == null) return null;
  const a = added ?? 0;
  const r = removed ?? 0;
  const addedStr = a > 0 ? colorize(`+${a}`, COLORS.green) : dim(`+${a}`);
  const removedStr = r > 0 ? colorize(`−${r}`, COLORS.red) : dim(`−${r}`);
  return `${addedStr} ${removedStr}`;
}
