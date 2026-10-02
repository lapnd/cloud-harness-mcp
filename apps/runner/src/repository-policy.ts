import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { HarnessError } from '@cloud-harness/contracts';

/** Loopback, unspecified and link-local (cloud metadata) addresses: never a repository host. */
function isHostLocal(address: string): boolean {
  if (address === '::1' || address === '0.0.0.0' || address === '::') return true;
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return a === 127 || (a === 169 && b === 254) || a === 0;
  }
  const normalized = address.toLowerCase();
  return normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
}

/** RFC 1918 and IPv6 unique-local ranges: reachable only for operator-declared private hosts. */
function isPrivateRange(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const normalized = address.toLowerCase();
  return normalized.startsWith('fc') || normalized.startsWith('fd');
}

/**
 * `privateHosts` is the operator's explicit opt-in (`PRIVATE_GIT_HOSTS`) for an
 * allowlisted host such as a self-hosted GitLab that resolves to an internal
 * address. It never admits loopback or link-local targets.
 */
export async function validateRepositoryUrl(raw: string, allowedHosts: string[], privateHosts: readonly string[] = []): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new HarnessError('INVALID_INPUT', 'repositoryUrl must be a valid HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new HarnessError('INVALID_INPUT', 'only credential-free HTTPS repository URLs on port 443 are allowed');
  }
  const hostname = url.hostname.toLowerCase();
  if (!allowedHosts.includes(hostname)) throw new HarnessError('FORBIDDEN', 'repository host is not allowlisted', 403);
  const privateAllowed = privateHosts.includes(hostname);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  const forbidden = ({ address }: { address: string }) => isHostLocal(address) || (!privateAllowed && isPrivateRange(address));
  if (addresses.length === 0 || addresses.some(forbidden)) {
    throw new HarnessError('FORBIDDEN', 'repository host resolves to a forbidden network', 403);
  }
  return url;
}
