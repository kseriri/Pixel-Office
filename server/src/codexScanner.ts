/**
 * Codex session scanner (standalone, observation-based).
 *
 * Codex CLI writes session transcripts to
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
 * with a different record shape than Claude's JSONL. Rather than entangle the
 * Claude-specific fileWatcher/transcriptParser, this is a small self-contained
 * scanner: it discovers recently-active rollout files, adopts them as agents in
 * the shared AgentStateStore (so characters appear, grouped by cwd → room), and
 * translates Codex records into the same ServerMessages the webview already
 * understands (agentToolStart/Done, agentStatus, agentTokenUsage).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';

import type { AgentStateStore } from './agentStateStore.js';
import { projectLabelFromPath } from './fileWatcher.js';
import type { AgentState } from './types.js';

const CODEX_ROOT = path.join(os.homedir(), '.codex', 'sessions');
const SCAN_INTERVAL_MS = 3000;
// A session is "active" (and stays adopted) while its file was written within
// this window. Adoption and stale-removal use the SAME threshold so a removed
// session is, by definition, already outside the window and won't be re-adopted
// on the next tick (which would otherwise churn: despawn → respawn forever).
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;
const MIN_SIZE = 512;

interface CodexState {
  agentId: number;
  file: string;
  offset: number;
  decoder: StringDecoder; // carries partial multi-byte UTF-8 across reads
  buffer: string;
  activeTools: Set<string>;
  toolSeq: number; // stable fallback ids for tool calls lacking a call_id
  model?: string;
}

/** Build a minimal, valid AgentState for an adopted Codex session. */
function makeAgent(id: number, file: string, cwd: string, sessionId: string, model?: string): AgentState {
  return {
    id,
    sessionId: `codex-${sessionId}`,
    isExternal: true,
    projectDir: path.dirname(file),
    jsonlFile: file,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    folderName: cwd ? projectLabelFromPath(cwd) : 'codex',
    lastDataAt: Date.now(),
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    providerId: 'codex',
    inputTokens: 0,
    outputTokens: 0,
    model,
  };
}

/** Map a Codex tool call to a short human status label. */
function codexToolStatus(name: string, args: unknown): string {
  if (name === 'exec_command' || name === 'local_shell') {
    let cmd = '';
    try {
      const a = typeof args === 'string' ? JSON.parse(args) : args;
      cmd = (a && typeof a === 'object' && 'cmd' in a ? String((a as { cmd: unknown }).cmd) : '') || '';
    } catch {
      /* ignore */
    }
    return cmd ? `$ ${cmd.slice(0, 40)}` : 'Running command';
  }
  if (name.includes('search')) return 'Searching';
  if (name.includes('apply') || name.includes('patch') || name.includes('write')) return 'Editing files';
  return name;
}

export class CodexScanner {
  private byFile = new Map<string, CodexState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: AgentStateStore,
    private nextId: { current: number },
  ) {}

  start(): void {
    if (this.timer) return;
    if (!fs.existsSync(CODEX_ROOT)) {
      console.log('[Pixel Agents] Codex scanner: no ~/.codex/sessions, skipping');
      return;
    }
    this.timer = setInterval(() => this.tick(), SCAN_INTERVAL_MS);
    console.log(`[Pixel Agents] Codex scanner watching ${CODEX_ROOT}`);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The last couple of YYYY/MM/DD day-dirs (avoids stat-ing thousands of old files). */
  private recentDayDirs(): string[] {
    const days: string[] = [];
    let years: string[];
    try {
      years = fs.readdirSync(CODEX_ROOT).filter((d) => /^\d{4}$/.test(d)).sort();
    } catch {
      return [];
    }
    for (const y of years.slice(-2)) {
      const yp = path.join(CODEX_ROOT, y);
      let months: string[];
      try {
        months = fs.readdirSync(yp).filter((d) => /^\d{2}$/.test(d)).sort();
      } catch {
        continue;
      }
      for (const m of months.slice(-2)) {
        const mp = path.join(yp, m);
        try {
          for (const d of fs.readdirSync(mp).filter((x) => /^\d{2}$/.test(x))) {
            days.push(path.join(mp, d));
          }
        } catch {
          /* ignore */
        }
      }
    }
    days.sort();
    return days.slice(-3);
  }

  private tick(): void {
    const now = Date.now();
    // 1. discover recently-active rollout files and adopt new ones
    for (const dir of this.recentDayDirs()) {
      let files: string[];
      try {
        files = fs.readdirSync(dir).filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        const full = path.join(dir, f);
        if (this.byFile.has(full)) continue;
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.size < MIN_SIZE) continue;
        if (now - st.mtimeMs > ACTIVE_WINDOW_MS) continue;
        this.adopt(full, st);
      }
    }
    // 2. poll adopted files + despawn stale ones
    const toRemove: string[] = [];
    for (const [file, s] of this.byFile) {
      this.poll(s);
      let st: fs.Stats | null = null;
      try {
        st = fs.statSync(file);
      } catch {
        st = null;
      }
      // Remove only once the file leaves the active window (or is gone). Using
      // the same threshold as adoption prevents a despawn→re-adopt loop.
      if (!st || now - st.mtimeMs > ACTIVE_WINDOW_MS) toRemove.push(file);
    }
    for (const file of toRemove) this.remove(file);
  }

  private adopt(file: string, st: fs.Stats): void {
    let cwd = '';
    let model: string | undefined;
    let sessionId = path.basename(file, '.jsonl');
    try {
      const head = fs.readFileSync(file, 'utf-8');
      for (const line of head.split('\n')) {
        if (!line.trim()) continue;
        let r: { type?: string; payload?: Record<string, unknown> };
        try {
          r = JSON.parse(line);
        } catch {
          continue;
        }
        const p = r.payload ?? {};
        if (r.type === 'session_meta') {
          if (typeof p.cwd === 'string') cwd = p.cwd;
          if (typeof p.id === 'string') sessionId = p.id;
        } else if (r.type === 'turn_context' && typeof p.model === 'string') {
          model = p.model;
        }
      }
    } catch {
      return;
    }
    const id = this.nextId.current++;
    const agent = makeAgent(id, file, cwd, sessionId, model);
    this.byFile.set(file, {
      agentId: id,
      file,
      offset: st.size, // skip history — only react to new activity
      decoder: new StringDecoder('utf8'),
      buffer: '',
      activeTools: new Set(),
      toolSeq: 0,
      model,
    });
    this.store.set(id, agent); // → agentAdded → agentCreated broadcast (folderName → room)
    console.log(
      `[Pixel Agents] Codex: detected session ${agent.folderName} (${model ?? 'unknown model'})`,
    );
  }

  private remove(file: string): void {
    const s = this.byFile.get(file);
    if (!s) return;
    this.byFile.delete(file);
    this.store.delete(s.agentId); // → agentRemoved → agentClosed broadcast
    console.log(`[Pixel Agents] Codex: session ended (agent ${s.agentId})`);
  }

  private poll(s: CodexState): void {
    let st: fs.Stats;
    try {
      st = fs.statSync(s.file);
    } catch {
      return;
    }
    if (st.size <= s.offset) return;
    const len = st.size - s.offset;
    const buf = Buffer.alloc(len);
    let fd: number;
    try {
      fd = fs.openSync(s.file, 'r');
    } catch {
      return;
    }
    try {
      fs.readSync(fd, buf, 0, len, s.offset);
    } finally {
      fs.closeSync(fd);
    }
    s.offset = st.size;
    s.buffer += s.decoder.write(buf); // decoder holds any partial multi-byte char
    const lines = s.buffer.split('\n');
    s.buffer = lines.pop() ?? '';
    for (const line of lines) this.handleLine(s, line);
  }

  private handleLine(s: CodexState, line: string): void {
    if (!line.trim()) return;
    let r: { type?: string; payload?: Record<string, unknown> };
    try {
      r = JSON.parse(line);
    } catch {
      return;
    }
    const id = s.agentId;
    const p = r.payload ?? {};

    if (r.type === 'response_item') {
      const sub = p.type as string | undefined;
      if (
        sub === 'function_call' ||
        sub === 'tool_search_call' ||
        sub === 'custom_tool_call' ||
        sub === 'local_shell_call'
      ) {
        const callId = (p.call_id as string) || (p.id as string) || `codex-tool-${s.toolSeq++}`;
        const name = (p.name as string) || (sub === 'tool_search_call' ? 'search' : 'tool');
        s.activeTools.add(callId);
        this.store.broadcast({
          type: 'agentToolStart',
          id,
          toolId: callId,
          status: codexToolStatus(name, p.arguments),
          toolName: name,
        });
      } else if (sub === 'function_call_output' || sub === 'tool_search_output') {
        const callId = (p.call_id as string) || (p.id as string);
        if (callId && s.activeTools.has(callId)) {
          s.activeTools.delete(callId);
          this.store.broadcast({ type: 'agentToolDone', id, toolId: callId });
        }
      }
      return;
    }

    if (r.type === 'event_msg') {
      const sub = p.type as string | undefined;
      if (sub === 'token_count') {
        const info = p.info as { total_token_usage?: Record<string, number> } | undefined;
        const u = info?.total_token_usage;
        if (u) {
          this.store.broadcast({
            type: 'agentTokenUsage',
            id,
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cacheReadTokens: u.cached_input_tokens ?? 0,
            cacheWriteTokens: 0,
            model: s.model,
          });
        }
      } else if (sub === 'task_started' || sub === 'user_message') {
        this.store.broadcast({ type: 'agentStatus', id, status: 'active' });
      } else if (sub === 'task_complete' || sub === 'turn_aborted' || sub === 'turn_complete') {
        for (const t of s.activeTools) this.store.broadcast({ type: 'agentToolDone', id, toolId: t });
        s.activeTools.clear();
        this.store.broadcast({ type: 'agentToolsClear', id });
        this.store.broadcast({ type: 'agentStatus', id, status: 'waiting', awaitingInput: false });
      }
      return;
    }

    if (r.type === 'turn_context' && typeof p.model === 'string') {
      s.model = p.model;
      const a = this.store.get(id);
      if (a) a.model = p.model;
    }
  }
}
