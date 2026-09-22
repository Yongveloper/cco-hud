import path from 'node:path';
import type { RenderContext, Translations } from '../types.js';
import { COLORS, SEP, SEP_INNER, colorize, dim, cyan, yellow } from '../utils/colors.js';
import { truncateVisual } from '../utils/formatters.js';
import { SESSION_NAME_MAX_WIDTH, TRIM } from '../constants.js';

export function renderProjectLine(ctx: RenderContext, t: Translations): string {
  const parts: string[] = [];

  const head = renderProjectHead(ctx, t);
  if (head) parts.push(head);

  if (ctx.trim < TRIM.COUNTS) {
    const counts = renderConfigCounts(ctx);
    if (counts) parts.push(counts);
  }

  if (ctx.sessionDuration && ctx.trim < TRIM.DURATION) {
    parts.push(dim(`⏱ ${ctx.sessionDuration}`));
  }

  return parts.join(SEP);
}

function resolveProjectName(ctx: RenderContext): string {
  const repoName = ctx.stdin.workspace?.repo?.name;
  if (repoName) return repoName;
  const dir = ctx.stdin.workspace?.project_dir || ctx.stdin.cwd;
  if (!dir) return '';
  return path.basename(dir) || dir;
}

function renderProjectHead(ctx: RenderContext, t: Translations): string | null {
  const name = resolveProjectName(ctx);
  if (!name) return null;

  const items: string[] = [`${dim('▸')} ${yellow(name)}`];

  if (ctx.stdin.session_name && ctx.trim < TRIM.SESSION_NAME) {
    items.push(dim(truncateVisual(ctx.stdin.session_name, SESSION_NAME_MAX_WIDTH)));
  }

  if (ctx.gitInfo) {
    items.push(`${dim('⎇')} ${cyan(formatGit(ctx))}`);
  }

  const worktree = ctx.stdin.workspace?.git_worktree || ctx.stdin.worktree?.name;
  if (worktree) items.push(dim(`⌂ ${worktree}`));

  const pr = renderPr(ctx, t);
  if (pr) items.push(pr);

  return items.join(' ');
}

function formatGit(ctx: RenderContext): string {
  const git = ctx.gitInfo!;
  let str = git.branch;
  if (git.dirty) str += '*';
  if (git.ahead > 0) str += ` ↑${git.ahead}`;
  if (git.behind > 0) str += ` ↓${git.behind}`;
  return str;
}

function renderPr(ctx: RenderContext, t: Translations): string | null {
  const pr = ctx.stdin.pr;
  if (!pr || pr.number == null) return null;
  const state = pr.review_state ?? '';
  let mark: string;
  if (state === 'approved') mark = colorize('✓', COLORS.green);
  else if (state === 'changes_requested') mark = colorize('✗', COLORS.red);
  else mark = dim('○');
  return `${dim(`${t.labels.pr} #${pr.number}`)} ${mark}`;
}

function renderConfigCounts(ctx: RenderContext): string | null {
  const { claudeMdCount, rulesCount, mcpCount, hooksCount } = ctx.configCounts;
  const items: [number, string][] = [
    [claudeMdCount, 'CLAUDE.md'],
    [rulesCount, 'rules'],
    [mcpCount, 'MCPs'],
    [hooksCount, 'hooks'],
  ];
  const shown = items.filter(([count]) => count > 0).map(([count, label]) => dim(`${count} ${label}`));
  return shown.length > 0 ? shown.join(SEP_INNER) : null;
}
