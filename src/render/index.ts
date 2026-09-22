import type { RenderContext, Translations } from '../types.js';
import { RESET, SEP } from '../utils/colors.js';
import { stripAnsi, visualWidth, sliceVisible } from '../utils/formatters.js';
import { renderSessionLine } from './session-line.js';
import { renderProjectLine } from './project-line.js';
import { renderToolsLine, renderAgentsLine, renderTodosLine } from './activity-lines.js';
import { renderStatsLine } from './stats-line.js';
import { TRIM } from '../constants.js';

/** Re-render with increasing trim level until the line fits the terminal */
function fitLine(ctx: RenderContext, renderFn: (c: RenderContext) => string): string {
  let level = 0;
  let line = renderFn({ ...ctx, trim: level });
  while (level < TRIM.MAX && visualWidth(line) > ctx.termWidth) {
    level++;
    line = renderFn({ ...ctx, trim: level });
  }
  return line;
}

export function render(ctx: RenderContext, t: Translations): void {
  const display = ctx.config.display ?? {};
  const termWidth = ctx.termWidth;

  const renderProject = (c: RenderContext): string => {
    const stats = display.showStats !== false && c.trim < TRIM.STATS ? renderStatsLine(c, t) : '';
    const projectLine = renderProjectLine(c, t);
    return stats ? `${projectLine}${SEP}${stats}` : projectLine;
  };

  const lines = [
    fitLine(ctx, (c) => renderSessionLine(c, t)),
    fitLine(ctx, renderProject),
    display.showTools !== false ? renderToolsLine(ctx) : null,
    display.showAgents !== false ? renderAgentsLine(ctx) : null,
    display.showTodos !== false ? renderTodosLine(ctx, t) : null,
  ].filter(Boolean);

  const output: string[] = [];
  for (const line of lines) {
    let outputLine = `${RESET}${line!.replace(/ /g, ' ')}`;
    // Fast path: if plain text length < half terminal width, no CJK char can overflow
    const plain = stripAnsi(outputLine);
    if (plain.length > termWidth / 2 && visualWidth(outputLine) > termWidth) {
      outputLine = sliceVisible(outputLine, termWidth);
    }
    output.push(outputLine);
  }
  process.stdout.write(output.join('\n') + '\n');
}
