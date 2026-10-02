import { basename } from 'node:path';
import type { RunnerOperation, RunnerResponse } from '@cloud-harness/contracts';
import type { OperationBackend } from '../operation-backend.js';
import type { LocalWorkspaceBackend } from './local-workspace-backend.js';

function failure(code: 'NOT_FOUND' | 'INVALID_INPUT', message: string): RunnerResponse {
  return { ok: false, message, error: { code, message, retryable: false }, truncated: false };
}

/**
 * Several local folders (typically one Git repository per project) served by
 * one MCP endpoint. Each folder keeps its own LocalWorkspaceBackend, so path
 * confinement, Git tools, sessions and tasks stay per project; this class only
 * lists them together and routes each call by its `workspaceId`.
 */
export class MultiLocalWorkspaceBackend implements OperationBackend {
  constructor(private readonly backends: readonly LocalWorkspaceBackend[]) {
    if (backends.length === 0) throw new Error('at least one local workspace is required');
  }

  getInstructions(): string {
    const projects = this.backends
      .map((backend) => `- ${basename(backend.canonicalRoot)} (${backend.canonicalRoot}): workspaceId "${backend.workspaceId}"`)
      .join('\n');
    return 'This is a Cloud Harness local multi-project server. Every project folder below is its own workspace with its own ' +
      'Git repository; pass the matching workspaceId to every tool (call workspace_list to see them again). ' +
      'Commands run with the host user\'s permissions inside that folder.\n' + projects;
  }

  async call(operation: RunnerOperation, input: Record<string, unknown>, signal?: AbortSignal): Promise<RunnerResponse> {
    if (operation === 'workspace_list') {
      const workspaces: unknown[] = [];
      for (const backend of this.backends) {
        const listed = await backend.call('workspace_list', input, signal);
        const data = listed.data as { workspaces?: unknown[] } | undefined;
        workspaces.push(...(data?.workspaces ?? []));
      }
      return { ok: true, message: `Listed ${workspaces.length} workspaces`, data: { workspaces }, truncated: false };
    }
    const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : undefined;
    if (workspaceId === undefined) {
      // Operations without a workspace (unsupported in local mode anyway) answer from the first project.
      if (operation === 'workspace_open' || !('workspaceId' in input)) return this.backends[0]!.call(operation, input, signal);
      return failure('INVALID_INPUT', 'workspaceId is required; call workspace_list to see the projects');
    }
    const backend = this.backends.find((candidate) => candidate.workspaceId === workspaceId);
    if (!backend) return failure('NOT_FOUND', 'workspace not found; call workspace_list to see the projects');
    return backend.call(operation, input, signal);
  }

  async close(): Promise<void> {
    await Promise.all(this.backends.map((backend) => backend.close()));
  }
}
