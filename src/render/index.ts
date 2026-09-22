import type { RenderContext, Translations } from '../types.js';
import { RESET, SEP } from '../utils/colors.js';
import { stripAnsi, visualWidth, sliceVisible } from '../utils/formatters.js';
import { renderSessionLine } from './session-line.js';
import { renderProjectLine } from './project-line.js';
import { renderToolsLine, renderAgentsLine, renderTodosLine } from './activity-lines.js';
import { renderStatsLine } from './stats-line.js';

export function render(ctx: RenderContext, t: Translations): void {
  const display = ctx.config.display ?? {};
  const termWidth = ctx.termWidth;

  const stats = display.showStats !== false && !ctx.compact ? renderStatsLine(ctx, t) : '';
  const projectLine = renderProjectLine(ctx, t);

  const lines = [
    renderSessionLine(ctx, t),
    stats ? `${projectLine}${SEP}${stats}` : projectLine,
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
