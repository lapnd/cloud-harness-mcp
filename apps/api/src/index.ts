#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { realpath, stat } from 'node:fs/promises';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createApiApp } from './app.js';
import { createLocalHttpApp } from './local-http-app.js';
import { loadApiConfig } from './config.js';
import { parseCliOptions, getCliHelp } from './cli-options.js';
import { LocalWorkspaceBackend } from './local/local-workspace-backend.js';
import { MultiLocalWorkspaceBackend } from './local/multi-local-workspace-backend.js';
import { apiLogger } from './logging.js';
import { createCloudHarnessServer } from './mcp-server.js';
import { serverVersion } from './version.js';

const parsed = parseCliOptions(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`Error: ${parsed.error}\n\n${getCliHelp()}\n`);
  process.exit(1);
}

const { options } = parsed;

/** One folder: the folder backend itself. Several: one workspace per folder behind a router. */
async function createLocalBackend(): Promise<LocalWorkspaceBackend | MultiLocalWorkspaceBackend> {
  const roots: string[] = [];
  for (const path of options.workspaces) roots.push(await resolveWorkspaceRoot(path));
  const backends = roots.map((root) => new LocalWorkspaceBackend(root, options));
  return backends.length === 1 ? backends[0]! : new MultiLocalWorkspaceBackend(backends);
}

async function resolveWorkspaceRoot(workspacePath: string): Promise<string> {
  try {
    const stats = await stat(workspacePath);
    if (!stats.isDirectory()) {
      process.stderr.write(`Error: --workspace path "${workspacePath}" is not a directory.\n`);
      process.exit(1);
    }
    return await realpath(workspacePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: failed to resolve workspace path "${workspacePath}": ${msg}\n`);
    process.exit(1);
  }
}

if (options.help) {
  process.stdout.write(getCliHelp() + '\n');
  process.exit(0);
}

if (options.version) {
  process.stdout.write(`${serverVersion}\n`);
  process.exit(0);
}

if (options.transport === 'stdio') {
  if (process.platform === 'win32' && process.env.HARNESS_ALLOW_WIN32_STDIO !== '1') {
    process.stderr.write(
      'Error: Cloud Harness MCP local stdio mode currently supports POSIX platforms (Linux and macOS).\n' +
      'On Windows, please run within WSL (Windows Subsystem for Linux) or use Cloud Harness in cloud HTTP mode.\n'
    );
    process.exit(1);
  }

  const backend = await createLocalBackend();
  const handle = serveStdio(() => createCloudHarnessServer(backend), {
    legacy: 'serve',
    onerror: (error) => {
      process.stderr.write(`MCP server error: ${error.message}\n`);
    }
  });

  let shuttingDown = false;
  async function shutdown(signal?: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (signal) {
      process.stderr.write(`Received ${signal}, shutting down stdio server...\n`);
    }
    try {
      await handle.close();
      await backend.close();
    } catch {
      // ignore
    }
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.stdin.on('close', () => void shutdown('EOF'));
  process.stdin.on('end', () => void shutdown('EOF'));
} else {
  // A local folder served over HTTP has no runner; the runner token only
  // satisfies the shared configuration schema and is never sent anywhere.
  if (options.workspace && !process.env.RUNNER_TOKEN && !process.env.RUNNER_TOKEN_FILE) {
    process.env.RUNNER_TOKEN = randomBytes(32).toString('hex');
  }
  const config = loadApiConfig();
  const runtime = options.workspace
    ? createLocalHttpApp(config, await createLocalBackend())
    : createApiApp(config);
  const server = createServer(runtime.app);
  server.listen(config.port, config.host, () =>
    apiLogger.info({ host: config.host, port: config.port, localWorkspaces: options.workspaces }, 'API listening')
  );

  async function shutdown(signal: string) {
    apiLogger.info({ signal }, 'API shutting down');
    server.close();
    // A rejected close (for example a downstream socket that refuses to shut down)
    // must never skip process.exit and leave the API running after SIGTERM.
    try {
      await runtime.close();
    } catch (error) {
      apiLogger.error({ err: error }, 'API shutdown encountered an error');
    }
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
