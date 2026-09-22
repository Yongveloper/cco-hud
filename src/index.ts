#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join, isAbsolute, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, statSync } from 'node:fs';

import type { StdinInput, Config, RenderContext } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { COLORS, colorize } from './utils/colors.js';
import { formatSessionDuration, formatSessionDurationMs } from './utils/formatters.js';
import { resolveRateLimits } from './utils/rate-limits.js';
import { countConfigs } from './utils/config-counter.js';
import { parseTranscript } from './utils/transcript.js';
import { getGitInfo } from './utils/git.js';
import { getTranslations } from './utils/i18n.js';
import { render } from './render/index.js';
import { debugError } from './utils/errors.js';
import { STDIN_TIMEOUT_MS } from './constants.js';

const CONFIG_PATH = join(homedir(), '.claude', 'cco-hud.local.json');

function isValidDirectory(p: string): boolean {
  if (!p || !isAbsolute(p)) return false;
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isValidTranscriptPath(p: string): boolean {
  if (!p) return true; // Empty path is allowed
  if (!isAbsolute(p)) return false;
  // Only allow paths within ~/.claude directory
  // Use resolve() to normalize ".." segments and compare with trailing sep to prevent prefix collisions
  const claudeDir = join(homedir(), '.claude');
  try {
    const resolved = resolve(p);
    return (resolved === claudeDir || resolved.startsWith(claudeDir + sep)) && existsSync(resolved);
  } catch {
    return false;
  }
}

// $COLUMNS → process.stdout.columns → 120
function resolveTermWidth(): number {
  const fromEnv = parseInt(process.env.COLUMNS ?? '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const fromTty = process.stdout.columns;
  if (typeof fromTty === 'number' && fromTty > 0) return fromTty;
  return 120;
}

async function readStdin(): Promise<StdinInput | null> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    // Use Bun.stdin for faster reading when available
    const stdinRead = typeof Bun !== 'undefined'
      ? Bun.stdin.text()
      : (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(Buffer.from(chunk));
          }
          return Buffer.concat(chunks).toString('utf-8');
        })();
    const timeout = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error('stdin timeout')), STDIN_TIMEOUT_MS);
    });
    const content = await Promise.race([stdinRead, timeout]);
    clearTimeout(timerId);
    return JSON.parse(content) as StdinInput;
  } catch (e) {
    clearTimeout(timerId);
    debugError('stdin read', e);
    return null;
  }
}

async function loadConfig(): Promise<Config> {
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    const userConfig = JSON.parse(content);
    return { ...DEFAULT_CONFIG, ...userConfig };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function main(): Promise<void> {
  // Phase 1: Load config and read stdin in parallel
  const [config, stdin] = await Promise.all([loadConfig(), readStdin()]);

  if (!stdin) {
    console.log(colorize('⚠️ stdin', COLORS.yellow));
    return;
  }

  if (
    !stdin.model ||
    typeof stdin.model.display_name !== 'string' ||
    !stdin.context_window ||
    typeof stdin.context_window.context_window_size !== 'number' ||
    !stdin.cost
  ) {
    console.log(colorize('⚠️ stdin: missing fields', COLORS.yellow));
    return;
  }

  const transcriptPath = stdin.transcript_path ?? '';
  const validTranscriptPath = isValidTranscriptPath(transcriptPath) ? transcriptPath : '';
  // Prefer workspace.project_dir → workspace.current_dir → cwd
  const cwdCandidates = [stdin.workspace?.project_dir, stdin.workspace?.current_dir, stdin.cwd];
  const validCwd = cwdCandidates.find((p) => isValidDirectory(p ?? ''));

  // Resolve translations synchronously when language is explicit (not 'auto')
  const t = await getTranslations(config);

  // Phase 2: Run independent I/O operations in parallel
  const [transcript, configCounts, gitInfo, rateLimits] = await Promise.all([
    parseTranscript(validTranscriptPath),
    countConfigs(validCwd),
    getGitInfo(validCwd),
    resolveRateLimits(stdin, config),
  ]);

  // Native duration (cost.total_duration_ms) vs transcript-based
  const sessionDuration =
    stdin.cost.total_duration_ms != null
      ? formatSessionDurationMs(stdin.cost.total_duration_ms)
      : formatSessionDuration(transcript.sessionStart);

  const termWidth = resolveTermWidth();
  const compact = termWidth < (config.display?.compactWidth ?? 100);

  const ctx: RenderContext = {
    stdin,
    config,
    transcript,
    configCounts,
    gitInfo,
    sessionDuration,
    rateLimits,
    termWidth,
    compact,
    now: Date.now(),
  };

  render(ctx, t);
}

main().catch((e) => {
  debugError('main', e);
  console.log(colorize('⚠️', COLORS.yellow));
});
