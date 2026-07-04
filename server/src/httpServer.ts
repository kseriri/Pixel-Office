import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { AssetCache, SetHooksEnabledSideEffect } from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import { HOOK_API_PREFIX, MAX_HOOK_BODY_SIZE } from './constants.js';
import type { AgentState } from './types.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[?[0-9a-f:]+\]?)$/i;

/**
 * Guard for the standalone server against hostile websites and DNS rebinding.
 * A malicious page the user visits while the server runs can otherwise open
 * ws://127.0.0.1/ws or fetch /api/* cross-origin. We accept a request only when:
 *  - the Host header is localhost/loopback or a bare IP literal (a rebinding
 *    attack puts its own *domain name* in Host, so names other than localhost
 *    are rejected), AND
 *  - the Origin header is absent (same-origin GETs omit it), points at
 *    localhost/loopback, or matches the request's own Host (same-origin).
 * Embedded (VS Code) mode keeps its bearer-token check instead.
 */
function isLocalSameOrigin(request: FastifyRequest): boolean {
  const hostHeader = (request.headers.host ?? '').toLowerCase();
  const hostName = hostHeader.replace(/:\d+$/, '');
  const hostOk = LOCAL_HOSTS.has(hostName) || IP_LITERAL.test(hostName);
  if (!hostOk) return false;

  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).hostname.toLowerCase();
    return LOCAL_HOSTS.has(originHost) || originHost === hostName;
  } catch {
    return false;
  }
}

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    logger: !options.embedded,
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  registerHealthRoute(app);
  registerProjectsRoute(app);
  registerHookRoute(app, options);
  registerWebSocketRoute(app, options);

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
}

// ── Projects (for the character-assignment settings UI) ─────────

/** Reduce a Claude project dir name to the short folder label the runtime shows
 *  on characters. Claude encodes the workspace path with separators → '-', which
 *  is lossy, so we take the trailing segment — kept identical to
 *  folderNameFromProjectDir in fileWatcher.ts so per-project pins line up.
 *  Caveat: a hyphenated leaf ("web-app") collapses to its last part ("app") and
 *  can collide; Codex / VS Code projects (which keep the full basename) still
 *  match because the settings UI merges in live project names too. */
function folderLabelFromDir(dirName: string): string {
  const parts = dirName.replace(/^-+/, '').split('-');
  return parts[parts.length - 1] || dirName;
}

/** List the distinct project labels seen in the local session logs, so the
 *  settings UI can offer them for per-project × model character assignment. */
function registerProjectsRoute(app: FastifyInstance): void {
  app.get('/api/projects', async (request, reply) => {
    // Only the local SPA may read this (it discloses local project folder names).
    if (!isLocalSameOrigin(request)) {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }
    const labels = new Set<string>();
    const claudeProjects = path.join(os.homedir(), '.claude', 'projects');
    try {
      for (const entry of fs.readdirSync(claudeProjects, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const label = folderLabelFromDir(entry.name);
          if (label) labels.add(label);
        }
      }
    } catch {
      // ~/.claude/projects missing or unreadable -> return whatever we have
    }
    return { projects: [...labels].sort((a, b) => a.localeCompare(b)) };
  });
}

// ── Hook Events ────────────────────────────────────────────────

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const event = request.body;

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
      }

      reply.send('ok');
    },
  );
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    // In embedded mode (VS Code) require the bearer token. In standalone mode
    // the token isn't shared with the browser, so instead require the handshake
    // to be same-origin/local — otherwise any website the user visits could open
    // this socket and drive the server (read activity, toggle hooks, mutate files).
    if (options.embedded) {
      const auth = request.headers.authorization ?? '';
      const expected = `Bearer ${options.token}`;
      const authBuf = Buffer.from(auth);
      const expectedBuf = Buffer.from(expected);
      if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
        socket.close(4001, 'unauthorized');
        return;
      }
    } else if (!isLocalSameOrigin(request)) {
      socket.close(4003, 'forbidden origin');
      return;
    }

    const { store } = options;

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      safeSend(socket, {
        type: 'agentCreated',
        id,
        folderName: agent.folderName,
        isExternal: agent.isExternal || undefined,
        isTeammate: agent.leadAgentId !== undefined || undefined,
        teammateName: agent.agentName,
        parentAgentId: agent.leadAgentId,
        teamName: agent.teamName,
        hooksOnly: agent.hooksOnly || undefined,
      });
    };

    const onAgentRemoved = (id: number) => {
      safeSend(socket, { type: 'agentClosed', id });
    };

    const onBroadcast = (message: Record<string, unknown>) => {
      safeSend(socket, message);
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (!options.embedded && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
    });
  });
}

// ── Auth Helper ────────────────────────────────────────────────

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization ?? '';
    const expected = `Bearer ${expectedToken}`;
    const authBuf = Buffer.from(auth);
    const expectedBuf = Buffer.from(expected);
    if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
