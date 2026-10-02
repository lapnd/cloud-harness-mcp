import { gitHostTokenName, type RunnerConfig } from '@cloud-harness/contracts';
import type { MetadataStore } from './metadata-store.js';

/**
 * Credentials for Git hosts other than github.com (self-hosted GitLab, Gitea…).
 *
 * A host credential is sent only to the host it is named after, and a GitHub
 * credential is never sent to any other host. The runner environment form
 * (`GIT_TOKEN_<HOST>`) follows the same rule as `GH_TOKEN`: it is honoured only
 * in `owner-bearer` mode; `cloudflare-access` deployments use the principal's
 * own global secret of the same name.
 */
export function isGitHubHost(hostname: string): boolean {
  return hostname.toLowerCase() === 'github.com';
}

export function resolveGitHostToken(input: {
  config: RunnerConfig;
  principalId: string;
  hostname: string;
  metadata?: MetadataStore | undefined;
}): string | undefined {
  const name = gitHostTokenName(input.hostname);
  if ((input.config.authMode ?? 'owner-bearer') !== 'cloudflare-access') {
    const environmentToken = input.config.gitHostTokens?.[name];
    if (environmentToken) return environmentToken;
  }
  if (!input.metadata) return undefined;
  try {
    const value = input.metadata.globalSecretValue(input.principalId, name)?.trim();
    return value && !/[\s\0]/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Presence check without decrypting, for capability reporting. */
export function hasGitHostToken(config: RunnerConfig, principalId: string, hostname: string, metadata: MetadataStore | undefined): boolean {
  const name = gitHostTokenName(hostname);
  if ((config.authMode ?? 'owner-bearer') !== 'cloudflare-access' && config.gitHostTokens?.[name]) return true;
  if (!metadata) return false;
  try {
    return metadata.listGlobalSecrets(principalId).some((secret) => secret.name.toUpperCase() === name);
  } catch {
    return false;
  }
}
