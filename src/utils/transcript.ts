import * as fs from 'node:fs';
import * as readline from 'node:readline';
import * as path from 'node:path';
import * as os from 'node:os';
import type { TranscriptData, ToolEntry, AgentEntry, TodoEntry } from '../types.js';
import { debugError } from './errors.js';
import { visualWidth, sliceVisible, stripAnsi } from './formatters.js';
import { MAX_TRANSCRIPT_TOOLS, MAX_TRANSCRIPT_AGENTS } from '../constants.js';

const TRANSCRIPT_CACHE_FILE = path.join(os.homedir(), '.claude', 'cco-hud-transcript-cache.json');
/** Bump when cache shape changes so stale caches are discarded */
const CACHE_VERSION = 2;
const BASH_TARGET_MAX_WIDTH = 40;

// --- Serializable cache types ---

interface SerializedToolEntry {
  name: string;
  target?: string;
  status: 'running' | 'completed' | 'error';
  startTime: string;
  endTime?: string;
}

interface SerializedAgentEntry {
  type: string;
  model?: string;
  description?: string;
  status: 'running' | 'completed';
  startTime: string;
  endTime?: string;
}

interface TranscriptCache {
  version: number;
  filePath: string;
  fileSize: number;
  data: {
    toolCallCount: number;
    agentCallCount: number;
    skillCallCount: number;
    sessionStart?: string;
    isThinking?: boolean;
    lastSkill?: { name: string; timestamp: string };
    tools: [string, SerializedToolEntry][];
    agents: [string, SerializedAgentEntry][];
    /** background agent task-id → Agent tool_use_id (for task-notification matching) */
    taskIds: [string, string][];
    todos: TodoEntry[];
  };
}

// --- Transcript line types ---

interface TranscriptLine {
  type?: string;
  timestamp?: string;
  /** queue-operation lines carry task-notification text here */
  content?: unknown;
  message?: {
    content?: ContentBlock[] | string;
  };
  /** Claude Code attaches structured tool result metadata on tool_result lines */
  toolUseResult?: {
    isAsync?: boolean;
    status?: string;
    agentId?: string;
    agent_id?: string;
  } | unknown;
}

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  text?: string;
  content?: unknown;
}

/** Parser state that must survive across incremental runs */
interface ParseState {
  toolMap: Map<string, ToolEntry>;
  agentMap: Map<string, AgentEntry>;
  /** task-id (agentId from async launch) → Agent tool_use_id */
  taskIds: Map<string, string>;
  todos: TodoEntry[];
}

function isTranscriptLine(obj: unknown): obj is TranscriptLine {
  return typeof obj === 'object' && obj !== null;
}

// --- Cache serialization ---

function serializeToolEntry(entry: ToolEntry): SerializedToolEntry {
  return {
    name: entry.name,
    target: entry.target,
    status: entry.status,
    startTime: entry.startTime.toISOString(),
    endTime: entry.endTime?.toISOString(),
  };
}

function deserializeToolEntry(entry: SerializedToolEntry): ToolEntry {
  return {
    name: entry.name,
    target: entry.target,
    status: entry.status,
    startTime: new Date(entry.startTime),
    endTime: entry.endTime ? new Date(entry.endTime) : undefined,
  };
}

function serializeAgentEntry(entry: AgentEntry): SerializedAgentEntry {
  return {
    type: entry.type,
    model: entry.model,
    description: entry.description,
    status: entry.status,
    startTime: entry.startTime.toISOString(),
    endTime: entry.endTime?.toISOString(),
  };
}

function deserializeAgentEntry(entry: SerializedAgentEntry): AgentEntry {
  return {
    type: entry.type,
    model: entry.model,
    description: entry.description,
    status: entry.status,
    startTime: new Date(entry.startTime),
    endTime: entry.endTime ? new Date(entry.endTime) : undefined,
  };
}

// --- Cache I/O ---

function loadTranscriptCache(filePath: string, currentFileSize: number): TranscriptCache | null {
  try {
    const content = JSON.parse(fs.readFileSync(TRANSCRIPT_CACHE_FILE, 'utf-8')) as TranscriptCache;
    if (
      content.version === CACHE_VERSION &&
      content.filePath === filePath &&
      content.fileSize <= currentFileSize
    ) {
      return content;
    }
    return null;
  } catch {
    return null;
  }
}

function saveTranscriptCache(
  filePath: string,
  fileSize: number,
  state: ParseState,
  result: TranscriptData,
): void {
  try {
    const { toolMap, agentMap, taskIds, todos } = state;
    const toolEntries = Array.from(toolMap.entries()).slice(-(MAX_TRANSCRIPT_TOOLS * 2));
    const agentEntries = Array.from(agentMap.entries()).slice(-(MAX_TRANSCRIPT_AGENTS * 2));
    const keptAgentIds = new Set(agentEntries.map(([id]) => id));
    const taskEntries = Array.from(taskIds.entries()).filter(([, toolUseId]) => keptAgentIds.has(toolUseId));

    const cache: TranscriptCache = {
      version: CACHE_VERSION,
      filePath,
      fileSize,
      data: {
        toolCallCount: result.toolCallCount,
        agentCallCount: result.agentCallCount,
        skillCallCount: result.skillCallCount,
        sessionStart: result.sessionStart?.toISOString(),
        isThinking: result.isThinking,
        lastSkill: result.lastSkill
          ? { name: result.lastSkill.name, timestamp: result.lastSkill.timestamp.toISOString() }
          : undefined,
        tools: toolEntries.map(([id, entry]) => [id, serializeToolEntry(entry)]),
        agents: agentEntries.map(([id, entry]) => [id, serializeAgentEntry(entry)]),
        taskIds: taskEntries,
        todos,
      },
    };

    fs.writeFileSync(TRANSCRIPT_CACHE_FILE, JSON.stringify(cache), { mode: 0o600 });
  } catch (e) {
    debugError('transcript cache write', e);
  }
}

// --- Status normalization for TaskCreate/TaskUpdate ---

function normalizeStatus(status?: string): 'pending' | 'in_progress' | 'completed' {
  switch (status) {
    case 'not_started':
    case 'pending':
      return 'pending';
    case 'running':
    case 'in_progress':
      return 'in_progress';
    case 'done':
    case 'complete':
    case 'completed':
      return 'completed';
    default:
      return 'pending';
  }
}

// --- Main parser with incremental reading ---

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  const result: TranscriptData = {
    tools: [],
    agents: [],
    todos: [],
    toolCallCount: 0,
    agentCallCount: 0,
    skillCallCount: 0,
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return result;
  }

  const fileStat = fs.statSync(transcriptPath);
  const fileSize = fileStat.size;

  const cache = loadTranscriptCache(transcriptPath, fileSize);

  const state: ParseState = {
    toolMap: new Map(),
    agentMap: new Map(),
    taskIds: new Map(),
    todos: [],
  };
  const { toolMap, agentMap } = state;
  let startOffset = 0;

  if (cache) {
    // Restore cached state
    result.toolCallCount = cache.data.toolCallCount;
    result.agentCallCount = cache.data.agentCallCount;
    result.skillCallCount = cache.data.skillCallCount;
    result.sessionStart = cache.data.sessionStart ? new Date(cache.data.sessionStart) : undefined;
    result.isThinking = cache.data.isThinking;
    if (cache.data.lastSkill) {
      result.lastSkill = {
        name: cache.data.lastSkill.name,
        timestamp: new Date(cache.data.lastSkill.timestamp),
      };
    }
    for (const [id, entry] of cache.data.tools) {
      toolMap.set(id, deserializeToolEntry(entry));
    }
    for (const [id, entry] of cache.data.agents) {
      agentMap.set(id, deserializeAgentEntry(entry));
    }
    for (const [taskId, toolUseId] of cache.data.taskIds ?? []) {
      state.taskIds.set(taskId, toolUseId);
    }
    state.todos = cache.data.todos;
    startOffset = cache.fileSize;

    // File unchanged — return cached data immediately (fastest path)
    if (fileSize === cache.fileSize) {
      result.tools = Array.from(toolMap.values()).slice(-MAX_TRANSCRIPT_TOOLS);
      result.agents = Array.from(agentMap.values()).slice(-MAX_TRANSCRIPT_AGENTS);
      result.todos = state.todos;
      return result;
    }
  }

  // Parse only new content from startOffset (JSONL is append-only)
  try {
    const fileStream = fs.createReadStream(transcriptPath, { start: startOffset });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);
        if (isTranscriptLine(parsed)) {
          processEntry(parsed, state, result);
        }
      } catch {
        // Skip parse errors (including partial lines at offset boundary)
      }
    }
  } catch (e) {
    debugError('transcript read', e);
  }

  result.tools = Array.from(toolMap.values()).slice(-MAX_TRANSCRIPT_TOOLS);
  result.agents = Array.from(agentMap.values()).slice(-MAX_TRANSCRIPT_AGENTS);
  result.todos = state.todos;

  // Save cache for next invocation
  saveTranscriptCache(transcriptPath, fileSize, state, result);

  return result;
}

// --- Entry processor ---

function processEntry(entry: TranscriptLine, state: ParseState, result: TranscriptData): void {
  const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();

  if (!result.sessionStart && entry.timestamp) {
    result.sessionStart = timestamp;
  }

  // Background agent completion arrives as a task-notification, either as a
  // top-level queue-operation line (content string) or inside a user-turn text block.
  if (typeof entry.content === 'string') {
    applyTaskNotification(entry.content, timestamp, state);
    applyTeammateIdle(entry.content, timestamp, state);
  }

  const content = entry.message?.content;
  // User turns may carry plain-string content (e.g. teammate messages / notifications)
  if (typeof content === 'string') {
    applyTaskNotification(content, timestamp, state);
    applyTeammateIdle(content, timestamp, state);
    return;
  }
  if (!content || !Array.isArray(content)) return;

  for (const block of content) {
    if (block.type === 'thinking') {
      result.isThinking = true;
    }

    if (block.type === 'text') {
      result.isThinking = false;
      if (block.text) applyTaskNotification(block.text, timestamp, state);
      if (block.text) applyTeammateIdle(block.text, timestamp, state);
    }

    if (block.type === 'tool_use' && block.id && block.name) {
      handleToolUse(block as ContentBlock & { id: string; name: string }, timestamp, state, result);
    }

    if (block.type === 'tool_result' && block.tool_use_id) {
      handleToolResult(block, entry, timestamp, state);
    }
  }
}

function handleToolUse(
  block: ContentBlock & { id: string; name: string },
  timestamp: Date,
  state: ParseState,
  result: TranscriptData,
): void {
  const { toolMap, agentMap, todos } = state;
  const input = block.input;

  if (block.name === 'Task' || block.name === 'Agent') {
    agentMap.set(block.id, {
      type: (input?.subagent_type as string) ?? 'unknown',
      model: (input?.model as string) ?? undefined,
      description: (input?.description as string) ?? undefined,
      status: 'running',
      startTime: timestamp,
    });
    result.agentCallCount++;
  } else if (block.name === 'Skill') {
    result.lastSkill = { name: (input?.skill as string) ?? 'unknown', timestamp };
    result.skillCallCount++;
  } else if (block.name === 'TodoWrite') {
    const list = (input as { todos?: TodoEntry[] } | undefined)?.todos;
    if (Array.isArray(list)) {
      todos.length = 0;
      todos.push(...list);
    }
  } else if (block.name === 'TaskCreate') {
    const t = input as { id?: string; content?: string; status?: string } | undefined;
    if (t?.id && t?.content) {
      const todo: TodoEntry = { id: t.id, content: t.content, status: normalizeStatus(t.status) };
      const existingIdx = todos.findIndex((x) => x.id === t.id);
      if (existingIdx >= 0) {
        todos[existingIdx] = todo;
      } else {
        todos.push(todo);
      }
    }
  } else if (block.name === 'TaskUpdate') {
    const t = input as { id?: string; status?: string } | undefined;
    if (t?.id && t.status) {
      const existing = todos.find((x) => x.id === t.id);
      if (existing) existing.status = normalizeStatus(t.status);
    }
  } else {
    toolMap.set(block.id, {
      name: block.name,
      target: extractTarget(block.name, input),
      status: 'running',
      startTime: timestamp,
    });
    result.toolCallCount++;
  }
}

function handleToolResult(block: ContentBlock, entry: TranscriptLine, timestamp: Date, state: ParseState): void {
  const toolUseId = block.tool_use_id!;

  const tool = state.toolMap.get(toolUseId);
  if (tool) {
    tool.status = block.is_error ? 'error' : 'completed';
    tool.endTime = timestamp;
  }

  const agent = state.agentMap.get(toolUseId);
  if (!agent) return;

  const asyncLaunch = detectAsyncLaunch(block, entry);
  if (asyncLaunch) {
    // Background agent: immediate result is only the launch ack. Stay running
    // until the matching task-notification arrives.
    if (asyncLaunch.taskId) state.taskIds.set(asyncLaunch.taskId, toolUseId);
    return;
  }

  agent.status = 'completed';
  agent.endTime = timestamp;
}

// --- Background agent detection ---

const ASYNC_LAUNCH_RE = /^\s*(Async agent launched|Spawned successfully)/;
const ASYNC_AGENT_ID_RE = /\bagent(?:Id|_id):\s*([^\s(]+)/;

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .join('\n');
  }
  return '';
}

/** Returns non-null when the tool_result is only a background-launch acknowledgement */
function detectAsyncLaunch(block: ContentBlock, entry: TranscriptLine): { taskId?: string } | null {
  const meta = entry.toolUseResult as { isAsync?: boolean; status?: string; agentId?: string; agent_id?: string } | undefined;
  const text = resultText(block.content);

  const metaAsync =
    meta && typeof meta === 'object' &&
    (meta.isAsync === true || meta.status === 'async_launched' || meta.status === 'teammate_spawned');
  const textAsync = ASYNC_LAUNCH_RE.test(text);
  if (!metaAsync && !textAsync) return null;

  const taskId = meta?.agentId ?? meta?.agent_id ?? ASYNC_AGENT_ID_RE.exec(text)?.[1];
  return { taskId };
}

const NOTIFICATION_RE = /<task-notification>([\s\S]*?)<\/task-notification>/g;

function tagValue(xml: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1]?.trim();
}

function applyTaskNotification(text: string, timestamp: Date, state: ParseState): void {
  if (!text.includes('<task-notification>')) return;

  NOTIFICATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NOTIFICATION_RE.exec(text)) !== null) {
    const body = match[1];
    const toolUseId = tagValue(body, 'tool-use-id');
    const taskId = tagValue(body, 'task-id');

    const agentKey = (toolUseId && state.agentMap.has(toolUseId) ? toolUseId : undefined) ??
      (taskId ? state.taskIds.get(taskId) : undefined);
    if (!agentKey) continue;

    const agent = state.agentMap.get(agentKey);
    if (!agent) continue;

    // Any notification means the agent stopped (completed / failed / killed).
    agent.status = 'completed';
    agent.endTime = timestamp;
  }
}

const TEAMMATE_IDLE_RE = /<teammate-message[^>]*\bteammate_id="([^"]+)"[^>]*>([\s\S]*?)<\/teammate-message>/g;

/** Teammate agents (Spawned successfully → agent_id: name@session) never get a
 *  task-notification; their shutdown shows up as an idle_notification message. */
function applyTeammateIdle(text: string, timestamp: Date, state: ParseState): void {
  if (!text.includes('<teammate-message') || !text.includes('idle_notification')) return;

  TEAMMATE_IDLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEAMMATE_IDLE_RE.exec(text)) !== null) {
    const [, teammateId, body] = match;
    if (!body.includes('"idle_notification"')) continue;

    for (const [taskId, toolUseId] of state.taskIds) {
      if (taskId !== teammateId && !taskId.startsWith(`${teammateId}@`)) continue;
      const agent = state.agentMap.get(toolUseId);
      if (agent && agent.status === 'running') {
        agent.status = 'completed';
        agent.endTime = timestamp;
      }
    }
  }
}

// --- Tool target extraction ---

/** Head-preserving truncation by visual width (CJK = 2 cols) */
function truncateVisual(text: string, maxWidth: number): string {
  if (visualWidth(text) <= maxWidth) return text;
  // sliceVisible appends a reset code; targets are plain text so strip it
  return stripAnsi(sliceVisible(text, maxWidth - 1)) + '…';
}

function extractTarget(toolName: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const p = (input.file_path ?? input.notebook_path ?? input.path) as string | undefined;
      return p ? path.basename(p) : undefined;
    }
    case 'Glob':
    case 'Grep':
      return input.pattern as string | undefined;
    case 'Agent':
    case 'Task':
      return input.description as string | undefined;
    case 'Bash': {
      const desc = input.description as string | undefined;
      if (desc?.trim()) return truncateVisual(desc.trim(), BASH_TARGET_MAX_WIDTH);
      const cmd = input.command as string | undefined;
      return cmd?.trim().split(/\s+/)[0] || undefined;
    }
  }
  return undefined;
}
