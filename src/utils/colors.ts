import {
  PROGRESS_BAR_WIDTH,
  BAR_FILLED,
  BAR_EMPTY,
  COLOR_THRESHOLD_WARNING,
  COLOR_THRESHOLD_DANGER,
} from '../constants.js';

export const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

export const RESET = COLORS.reset;
export const BOLD = COLORS.bold;

/** Between groups */
export const SEP = ` ${COLORS.dim}│${RESET} `;
/** Inside a group */
export const SEP_INNER = ` ${COLORS.dim}·${RESET} `;

export function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

export function dim(text: string): string {
  return colorize(text, COLORS.dim);
}

export function cyan(text: string): string {
  return colorize(text, COLORS.cyan);
}

export function green(text: string): string {
  return colorize(text, COLORS.green);
}

export function yellow(text: string): string {
  return colorize(text, COLORS.yellow);
}

export function red(text: string): string {
  return colorize(text, COLORS.red);
}

export function magenta(text: string): string {
  return colorize(text, COLORS.magenta);
}

export function bold(text: string): string {
  return colorize(text, BOLD);
}

/** Legacy green/yellow/red ramp (kept for callers that want it) */
export function getColorForPercent(percent: number): string {
  if (percent <= COLOR_THRESHOLD_WARNING) return COLORS.green;
  if (percent <= COLOR_THRESHOLD_DANGER) return COLORS.yellow;
  return COLORS.red;
}

/** dim below warn, yellow at/above warn, red at/above danger */
export function getStatusColor(
  pct: number,
  thresholds: { warn: number; danger: number } = {
    warn: COLOR_THRESHOLD_WARNING,
    danger: COLOR_THRESHOLD_DANGER,
  },
): string {
  if (pct >= thresholds.danger) return COLORS.red;
  if (pct >= thresholds.warn) return COLORS.yellow;
  return COLORS.dim;
}

export function renderProgressBar(
  percent: number,
  width = PROGRESS_BAR_WIDTH,
  color = getStatusColor(percent),
): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  const empty = width - filled;
  // Under threshold the fill is plain (default fg) so it still contrasts with the dim empty part
  const fillColor = color === COLORS.dim ? '' : color;
  return `${fillColor}${BAR_FILLED.repeat(filled)}${RESET}${COLORS.dim}${BAR_EMPTY.repeat(empty)}${RESET}`;
}
