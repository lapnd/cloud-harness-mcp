import express, { type Express, type Request, type Response } from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { ApiConfig } from '@cloud-harness/contracts';
import { bearerAuth } from './auth.js';
import { createCloudHarnessServer } from './mcp-server.js';
import type { OperationBackend } from './operation-backend.js';
import { preAuthRequestLimits, principalRequestLimits, requestSecurity } from './request-security.js';

export type LocalHttpRuntime = { app: Express; close: () => Promise<void> };

/**
 * Local folder workspace over authenticated HTTP (`--transport http --workspace`).
 *
 * The same host/origin checks, bearer or Cloudflare Access authentication and
 * request limits as the runner-backed `/mcp` lane guard the endpoint; there is
 * no runner, dashboard, MCP gateway or API-key lane. Commands run as the API
 * process user inside the workspace folder, so the surrounding machine (for
 * example a dedicated VM) is the isolation boundary.
 */
export function createLocalHttpApp(config: ApiConfig, backend: OperationBackend): LocalHttpRuntime {
  const app = express();
  const handler = createMcpHandler(() => createCloudHarnessServer(backend), { legacy: 'stateless', responseMode: 'auto' });
  const nodeHandler = toNodeHandler(handler);
  app.disable('x-powered-by');
  app.get('/healthz', (_request, response) => response.json({ status: 'ok' }));
  app.get('/readyz', (_request, response) => response.json({ status: 'ready' }));
  app.use('/mcp', requestSecurity(config), preAuthRequestLimits(), bearerAuth(config), principalRequestLimits());
  app.use('/mcp', express.json({ limit: config.maxBodyBytes, strict: true }));
  app.all('/mcp', async (request: Request, response: Response) => {
    if (request.method === 'POST' && !request.is('application/json')) {
      response.status(415).json({ error: 'unsupported_media_type' });
      return;
    }
    await nodeHandler(request, response, request.body);
  });
  return {
    app,
    close: async () => {
      await handler.close();
      await backend.close?.();
    }
  };
}
