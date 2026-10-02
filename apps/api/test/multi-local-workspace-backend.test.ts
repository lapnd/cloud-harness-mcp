import { describe, expect, it, vi } from 'vitest';
import type { LocalWorkspaceBackend } from '../src/local/local-workspace-backend.js';
import { MultiLocalWorkspaceBackend } from '../src/local/multi-local-workspace-backend.js';
import { parseCliOptions } from '../src/cli-options.js';

function fakeBackend(workspaceId: string, root: string) {
  return {
    workspaceId,
    canonicalRoot: root,
    call: vi.fn(async (operation: string) => operation === 'workspace_list'
      ? { ok: true, message: 'Listed 1 workspace', data: { workspaces: [{ workspaceId }] }, truncated: false }
      : { ok: true, message: `${operation} in ${root}`, data: {}, truncated: false }),
    close: vi.fn(async () => {})
  } as unknown as LocalWorkspaceBackend;
}

describe('one MCP endpoint, one workspace per project folder', () => {
  const a = fakeBackend('ws_a', '/code/app-a');
  const b = fakeBackend('ws_b', '/clients/b');
  const multi = new MultiLocalWorkspaceBackend([a, b]);

  it('lists every project', async () => {
    const listed = await multi.call('workspace_list', {});
    expect((listed.data as { workspaces: unknown[] }).workspaces).toEqual([{ workspaceId: 'ws_a' }, { workspaceId: 'ws_b' }]);
  });

  it('routes each call, including Git tools, to the project named by workspaceId', async () => {
    expect((await multi.call('git_status', { workspaceId: 'ws_b' })).message).toBe('git_status in /clients/b');
    expect((await multi.call('exec_run', { workspaceId: 'ws_a', command: 'ls' })).message).toBe('exec_run in /code/app-a');
  });

  it('rejects unknown or missing workspace ids instead of guessing a project', async () => {
    expect((await multi.call('git_status', { workspaceId: 'ws_x' })).error?.code).toBe('NOT_FOUND');
    expect((await multi.call('git_status', { workspaceId: undefined })).error?.code).toBe('INVALID_INPUT');
  });

  it('names every project and id in the server instructions', () => {
    expect(multi.getInstructions()).toContain('app-a (/code/app-a): workspaceId "ws_a"');
    expect(multi.getInstructions()).toContain('b (/clients/b): workspaceId "ws_b"');
  });

  it('accepts a repeated --workspace flag', () => {
    const result = parseCliOptions(['--transport', 'http', '--workspace', '/code/app-a', '--workspace=/clients/b']);
    expect(result.ok && result.options.workspaces).toEqual(['/code/app-a', '/clients/b']);
    expect(result.ok && result.options.workspace).toBe('/code/app-a');
  });
});
