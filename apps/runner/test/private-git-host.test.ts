import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gitHostTokenName, type RunnerConfig } from '@cloud-harness/contracts';

const resolved = vi.hoisted(() => ({ addresses: [] as Array<{ address: string; family: number }> }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => resolved.addresses) }));

const { validateRepositoryUrl } = await import('../src/repository-policy.js');
const { hasGitHostToken, resolveGitHostToken } = await import('../src/git-host-credential.js');

const resolvesTo = (...addresses: string[]) => {
  resolved.addresses = addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

describe('private Git hosts', () => {
  beforeEach(() => resolvesTo('10.0.0.5'));

  it('rejects an internal address unless the host is declared private', async () => {
    const allowed = ['gitlab.corp.example'];
    await expect(validateRepositoryUrl('https://gitlab.corp.example/team/app.git', allowed)).rejects.toThrow('forbidden network');
    await expect(validateRepositoryUrl('https://gitlab.corp.example/team/app.git', allowed, ['gitlab.corp.example'])).resolves.toBeInstanceOf(URL);
  });

  it('accepts every RFC 1918 and unique-local range for a declared private host', async () => {
    for (const address of ['10.1.2.3', '172.20.0.9', '192.168.1.10', 'fd00::5']) {
      resolvesTo(address);
      await expect(validateRepositoryUrl('https://git.lan/a/b.git', ['git.lan'], ['git.lan'])).resolves.toBeInstanceOf(URL);
    }
  });

  it('never admits loopback or link-local targets, even for a declared private host', async () => {
    for (const address of ['127.0.0.1', '169.254.169.254', '::1', 'fe80::1', '0.0.0.0']) {
      resolvesTo(address);
      await expect(validateRepositoryUrl('https://git.lan/a/b.git', ['git.lan'], ['git.lan'])).rejects.toThrow('forbidden network');
    }
  });

  it('still requires the host to be allowlisted', async () => {
    await expect(validateRepositoryUrl('https://git.lan/a/b.git', ['github.com'], ['git.lan'])).rejects.toThrow('not allowlisted');
  });

  it('does not widen other hosts that resolve privately', async () => {
    await expect(validateRepositoryUrl('https://other.lan/a/b.git', ['git.lan', 'other.lan'], ['git.lan'])).rejects.toThrow('forbidden network');
  });
});

describe('Git host credentials', () => {
  const config = (overrides: Partial<RunnerConfig> = {}) => ({
    authMode: 'owner-bearer',
    gitHostTokens: { GIT_TOKEN_GITLAB_CORP_EXAMPLE: 'glpat-host-token' },
    ...overrides
  }) as unknown as RunnerConfig;

  it('derives one credential name per hostname', () => {
    expect(gitHostTokenName('gitlab.corp.example')).toBe('GIT_TOKEN_GITLAB_CORP_EXAMPLE');
    expect(gitHostTokenName('git-01.lan')).toBe('GIT_TOKEN_GIT_01_LAN');
  });

  it('returns only the credential named after the requested host', () => {
    expect(resolveGitHostToken({ config: config(), principalId: 'owner', hostname: 'gitlab.corp.example' })).toBe('glpat-host-token');
    expect(resolveGitHostToken({ config: config(), principalId: 'owner', hostname: 'gitlab.com' })).toBeUndefined();
  });

  it('ignores the runner environment in cloudflare-access mode and reads the principal secret instead', () => {
    const metadata = {
      globalSecretValue: (_principal: string, name: string) => name === 'GIT_TOKEN_GITLAB_CORP_EXAMPLE' ? 'principal-token' : undefined,
      listGlobalSecrets: () => [{ name: 'GIT_TOKEN_GITLAB_CORP_EXAMPLE' }]
    } as never;
    const accessConfig = config({ authMode: 'cloudflare-access' });
    expect(resolveGitHostToken({ config: accessConfig, principalId: 'p', hostname: 'gitlab.corp.example' })).toBeUndefined();
    expect(resolveGitHostToken({ config: accessConfig, principalId: 'p', hostname: 'gitlab.corp.example', metadata })).toBe('principal-token');
    expect(hasGitHostToken(accessConfig, 'p', 'gitlab.corp.example', metadata)).toBe(true);
    expect(hasGitHostToken(accessConfig, 'p', 'gitlab.corp.example', undefined)).toBe(false);
  });
});
