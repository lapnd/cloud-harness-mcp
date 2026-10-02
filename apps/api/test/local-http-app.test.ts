import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '@cloud-harness/contracts';
import { createLocalHttpApp } from '../src/local-http-app.js';
import type { OperationBackend } from '../src/operation-backend.js';

const token = 'local-http-test-token-that-is-longer-than-32-chars';
const config = {
  host: '127.0.0.1', port: 0, ownerId: 'owner', authMode: 'owner-bearer', bearerToken: token,
  runnerUrl: 'http://unused', runnerToken: 'x'.repeat(32), publicHosts: ['127.0.0.1', 'localhost'],
  allowedOrigins: [], requestTimeoutMs: 30_000, maxBodyBytes: 1_048_576
} as unknown as ApiConfig;

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function start(backend: OperationBackend): Promise<string> {
  server = createServer(createLocalHttpApp(config, backend).app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('local folder workspace over HTTP', () => {
  it('requires the bearer token and forwards authenticated calls to the local backend', async () => {
    const call = vi.fn(async () => ({ ok: true, message: 'ok', data: { workspaces: [] }, truncated: false }));
    const base = await start({ call } as unknown as OperationBackend);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workspace_list', arguments: {} } });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    expect((await fetch(`${base}/mcp`, { method: 'POST', headers, body })).status).toBe(401);
    expect(call).not.toHaveBeenCalled();

    const authorized = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${token}` }, body });
    expect(authorized.status).toBe(200);
    expect(call).toHaveBeenCalledWith('workspace_list', expect.anything(), expect.anything());
  });

  it('exposes no runner-backed dashboard or gateway routes', async () => {
    const base = await start({ call: vi.fn() } as unknown as OperationBackend);
    expect((await fetch(`${base}/mcp-gateway`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${base}/dashboard`)).status).toBe(404);
  });
});
