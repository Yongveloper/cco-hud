import type { RenderContext, AgentEntry, Translations } from '../types.js';
import { COLORS, RESET, colorize } from '../utils/colors.js';
import { visualWidth, sliceVisible, stripAnsi } from '../utils/formatters.js';
import {
  MAX_RUNNING_TOOLS,
  MAX_COMPLETED_TOOL_TYPES,
  MAX_AGENTS_DISPLAY,
  MAX_COMPLETED_AGENTS,
  MAX_AGENT_DESC_LENGTH,
  MAX_TODO_CONTENT_LENGTH,
} from '../constants.js';

// --- Icons (no emoji) ---
const ICON_RUNNING = '◐';
const ICON_DONE = '✓';
const ICON_ERROR = '✗';
const ICON_TODO_ACTIVE = '▸';

const MAX_TARGET_WIDTH = 40;

const dim = (s: string): string => colorize(s, COLORS.dim);
const cyan = (s: string): string => colorize(s, COLORS.cyan);
const green = (s: string): string => colorize(s, COLORS.green);
const yellow = (s: string): string => colorize(s, COLORS.yellow);
const red = (s: string): string => colorize(s, COLORS.red);
const magenta = (s: string): string => colorize(s, COLORS.magenta);

const SEP_ITEM = dim(' · ');
const SEP_GROUP = dim(' │ ');

// --- Truncation helpers (visual width; CJK = 2 cols) ---

/** Head-preserving: `설명 텍스트…` */
function truncateHead(text: string, maxWidth: number): string {
  if (visualWidth(text) <= maxWidth) return text;
  // sliceVisible appends a reset code; inputs here are plain text
  return stripAnsi(sliceVisible(text, maxWidth - 1)) + '…';
}

/** Tail-preserving for paths: `…/name.ts` */
function truncateTail(text: string, maxWidth: number): string {
  if (visualWidth(text) <= maxWidth) return text;
  const chars = Array.from(text);
  let width = 0;
  let i = chars.length;
  while (i > 0 && width + visualWidth(chars[i - 1]) <= maxWidth - 1) {
    width += visualWidth(chars[i - 1]);
    i--;
  }
  return '…' + chars.slice(i).join('');
}

function formatTarget(target: string, maxWidth = MAX_TARGET_WIDTH): string {
  if (visualWidth(target) <= maxWidth) return target;
  if (target.includes('/')) {
    const base = target.slice(target.lastIndexOf('/') + 1);
    return truncateTail(base ? `…/${base}` : target, maxWidth);
  }
  return truncateHead(target, maxWidth);
}

// --- Tools line ---

export function renderToolsLine(ctx: RenderContext): string | null {
  const { tools } = ctx.transcript;
  if (tools.length === 0) return null;

  const groups: string[] = [];

  const running = tools.filter((t) => t.status === 'running').slice(-MAX_RUNNING_TOOLS);
  for (const tool of running) {
    const target = tool.target ? dim(`: ${formatTarget(tool.target)}`) : '';
    groups.push(`${yellow(ICON_RUNNING)} ${cyan(tool.name)}${target}`);
  }

  const doneCounts = new Map<string, number>();
  const errorCounts = new Map<string, number>();
  for (const tool of tools) {
    if (tool.status === 'completed') {
      doneCounts.set(tool.name, (doneCounts.get(tool.name) ?? 0) + 1);
    } else if (tool.status === 'error') {
      errorCounts.set(tool.name, (errorCounts.get(tool.name) ?? 0) + 1);
    }
  }

  const summaryItems: string[] = [];
  const topDone = Array.from(doneCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_COMPLETED_TOOL_TYPES);
  if (topDone.length > 0) {
    summaryItems.push(
      `${green(ICON_DONE)} ${topDone.map(([name, n]) => `${name}${dim(`×${n}`)}`).join(SEP_ITEM)}`,
    );
  }
  if (errorCounts.size > 0) {
    const items = Array.from(errorCounts.entries()).map(([name, n]) => `${name}${dim(`×${n}`)}`);
    summaryItems.push(`${red(ICON_ERROR)} ${items.join(SEP_ITEM)}`);
  }
  if (summaryItems.length > 0) {
    groups.push(summaryItems.join(SEP_ITEM));
  }

  return groups.length > 0 ? groups.join(SEP_GROUP) : null;
}

// --- Agents line ---

export function renderAgentsLine(ctx: RenderContext): string | null {
  const { agents } = ctx.transcript;

  // Running agents take priority; fill remaining slots with most recent completed.
  const runningAgents = agents.filter((a) => a.status === 'running').slice(-MAX_AGENTS_DISPLAY);
  const remaining = Math.max(0, Math.min(MAX_COMPLETED_AGENTS, MAX_AGENTS_DISPLAY - runningAgents.length));
  const recentCompleted = remaining > 0 ? agents.filter((a) => a.status === 'completed').slice(-remaining) : [];

  const toShow = [...runningAgents, ...recentCompleted];
  if (toShow.length === 0) return null;

  return toShow.map((agent) => formatAgent(agent, ctx.now)).join('\n');
}

function formatAgent(agent: AgentEntry, now: number): string {
  const icon = agent.status === 'running' ? yellow(ICON_RUNNING) : green(ICON_DONE);
  const name = magenta(agent.type) + (agent.model ? dim(`·${agent.model}`) : '');
  const desc = agent.description
    ? ` ${dim(`“${truncateHead(agent.description, MAX_AGENT_DESC_LENGTH)}”`)}`
    : '';
  const elapsed = formatElapsed(agent, now);

  return `${icon} ${name}${desc} ${dim(elapsed)}${RESET}`;
}

function formatElapsed(agent: AgentEntry, now: number): string {
  const start = agent.startTime.getTime();
  const end = agent.endTime?.getTime() ?? now;
  const ms = Math.max(0, end - start);

  if (ms < 1000) return '<1s';
  const totalSecs = Math.round(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;

  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}m${String(secs).padStart(2, '0')}s`;
}

// --- Todos line ---

export function renderTodosLine(ctx: RenderContext, t: Translations): string | null {
  const { todos } = ctx.transcript;
  if (!todos || todos.length === 0) return null;

  const total = todos.length;
  const completed = todos.filter((td) => td.status === 'completed').length;
  const inProgress = todos.find((td) => td.status === 'in_progress');
  const progress = dim(`${completed}/${total}`);

  if (!inProgress) {
    if (completed === total) {
      return `${green(ICON_DONE)} ${progress} ${t.todos.allComplete}`;
    }
    return null;
  }

  const content = truncateHead(inProgress.content, MAX_TODO_CONTENT_LENGTH);
  return `${yellow(ICON_TODO_ACTIVE)} ${progress} ${content}`;
}
