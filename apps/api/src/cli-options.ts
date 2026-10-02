import { isAbsolute } from 'node:path';

export type CliTransport = 'http' | 'stdio';

export type CliOptions = {
  transport: CliTransport;
  /** First workspace folder (kept for single-folder callers). */
  workspace?: string;
  /** Every `--workspace` folder, in order; each becomes its own workspace. */
  workspaces: string[];
  gitNetwork: boolean;
  gitPush: boolean;
  env: string[];
  help: boolean;
  version: boolean;
};

export type ParseCliResult =
  | { ok: true; options: CliOptions }
  | { ok: false; error: string; help?: boolean };

export function parseCliOptions(argv: string[]): ParseCliResult {
  let transport: CliTransport = 'http';
  let transportExplicit = false;
  const workspaces: string[] = [];
  let gitNetwork = false;
  let gitPush = false;
  const env: string[] = [];
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--version' || arg === '-v') {
      version = true;
      continue;
    }

    if (arg === '--transport') {
      const next = argv[++i];
      if (next === undefined) return { ok: false, error: 'missing argument for --transport' };
      if (next !== 'http' && next !== 'stdio') {
        return { ok: false, error: `invalid transport: "${next}" (must be "http" or "stdio")` };
      }
      transport = next;
      transportExplicit = true;
      continue;
    }

    if (arg.startsWith('--transport=')) {
      const val = arg.slice('--transport='.length);
      if (val !== 'http' && val !== 'stdio') {
        return { ok: false, error: `invalid transport: "${val}" (must be "http" or "stdio")` };
      }
      transport = val;
      transportExplicit = true;
      continue;
    }

    if (arg === '--workspace') {
      const next = argv[++i];
      if (next === undefined) return { ok: false, error: 'missing argument for --workspace' };
      workspaces.push(next);
      continue;
    }

    if (arg.startsWith('--workspace=')) {
      workspaces.push(arg.slice('--workspace='.length));
      continue;
    }

    if (arg === '--git-network') {
      gitNetwork = true;
      continue;
    }

    if (arg === '--git-push') {
      gitPush = true;
      continue;
    }

    if (arg === '--env') {
      const next = argv[++i];
      if (next === undefined) return { ok: false, error: 'missing argument for --env' };
      env.push(next);
      continue;
    }

    if (arg.startsWith('--env=')) {
      env.push(arg.slice('--env='.length));
      continue;
    }

    if (arg.startsWith('-')) {
      return { ok: false, error: `unknown option: "${arg}"` };
    }

    return { ok: false, error: `unexpected argument: "${arg}"` };
  }

  const workspace = workspaces[0];
  const options: CliOptions = {
    transport,
    ...(workspace !== undefined ? { workspace } : {}),
    workspaces,
    gitNetwork,
    gitPush,
    env,
    help,
    version
  };

  if (help || version) {
    return { ok: true, options };
  }

  if (transport === 'stdio' && !workspace) {
    return { ok: false, error: 'stdio transport requires an explicit --workspace <absolute-path>' };
  }
  if (workspace && !transportExplicit) {
    // Serving a local folder over HTTP is a deliberate choice, never a default.
    return { ok: false, error: '--workspace requires an explicit --transport stdio or --transport http' };
  }
  const relative = workspaces.find((path) => !isAbsolute(path));
  if (relative !== undefined) {
    return { ok: false, error: `--workspace path must be absolute (received: "${relative}")` };
  }

  if (gitPush && !gitNetwork) {
    gitNetwork = true;
    options.gitNetwork = true;
  }

  return {
    ok: true,
    options
  };
}

export function getCliHelp(): string {
  return `Cloud Harness MCP - Remote and Local Coding Harness

Usage:
  cloud-harness-mcp [options]

Options:
  --transport <http|stdio>   Transport protocol: http (default) or stdio
  --workspace <path>         Absolute path to a local folder to serve as a workspace (repeatable:
                             each folder, e.g. each project repository, is its own workspace)
                             (required for stdio; with --transport http, serves it over
                             authenticated HTTP instead of using the runner)
  --git-network              Enable network Git operations (fetch, pull, clone) in local mode
  --git-push                 Enable Git push operations in local mode (implies --git-network)
  --env <NAME>               Forward additional host environment variable (repeatable)
  -h, --help                 Show this help message
  -v, --version              Show version information

Examples:
  # Start remote HTTP server (default):
  cloud-harness-mcp --transport http

  # Start local stdio MCP server for a folder:
  cloud-harness-mcp --transport stdio --workspace /path/to/my-project

  # Start local stdio with network Git and custom environment variable:
  cloud-harness-mcp --transport stdio --workspace /path/to/my-project --git-network --env GITHUB_TOKEN
`;
}
