/**
 * Safety guards of the demo CLIs. Pure: they take the environment and the arguments as input and either return
 * what to use or throw a GuardError with a plain-English reason. Nothing here touches a database.
 */

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardError';
  }
}

export interface CliArgs {
  apply: boolean;
  confirmHost: string | undefined;
  now: Date | undefined;
  seed: number | undefined;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { apply: false, confirmHost: undefined, now: undefined, seed: undefined };
  const list = [...argv];
  const value = (flag: string, inline: string | undefined): string => {
    if (inline !== undefined) return inline;
    const next = list.shift();
    if (next === undefined || next.startsWith('--')) throw new GuardError(`${flag} needs a value.`);
    return next;
  };
  while (list.length > 0) {
    const raw = list.shift() as string;
    const eq = raw.indexOf('=');
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);
    switch (flag) {
      case '--apply':
        out.apply = true;
        break;
      case '--confirm-host':
        out.confirmHost = value('--confirm-host', inline);
        break;
      case '--now': {
        const text = value('--now', inline);
        const d = new Date(text);
        if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(text))
          throw new GuardError(`--now must be an ISO date-time such as 2026-11-10T09:00:00Z (got "${text}").`);
        out.now = d;
        break;
      }
      case '--seed': {
        const n = Number(value('--seed', inline));
        if (!Number.isInteger(n)) throw new GuardError('--seed must be an integer.');
        out.seed = n;
        break;
      }
      default:
        throw new GuardError(`Unknown option "${raw}". Allowed: --apply, --confirm-host <host>, --now <ISO>, --seed <n>.`);
    }
  }
  return out;
}

export interface DbTarget {
  url: string;
  host: string;
  source: 'DIRECT_URL' | 'DATABASE_URL';
}

type Env = Readonly<Record<string, string | undefined>>;

/** DIRECT_URL first, else DATABASE_URL. */
export function resolveDbTarget(env: Env): DbTarget {
  const source = env.DIRECT_URL ? 'DIRECT_URL' : env.DATABASE_URL ? 'DATABASE_URL' : null;
  if (!source) throw new GuardError('DIRECT_URL or DATABASE_URL must be set (use the non-pooled DIRECT_URL).');
  const url = env[source] as string;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new GuardError(`${source} is not a valid database URL.`);
  }
  if (!host) throw new GuardError(`${source} has no host.`);
  return { url, host, source };
}

/** Neon pooled endpoints carry `-pooler` in the first host label. */
export const isPooledHost = (host: string): boolean => /-pooler(\.|$)/.test(host);

const withoutPooler = (host: string) => host.replace(/-pooler(?=\.)/, '');

/**
 * The write guard: `--confirm-host` must be present and EXACTLY equal the host of the URL we connect to, the host
 * must not be a pooled one, and the repo's EXPECTED_DB_HOST (when set) must match as well.
 */
export function assertApplyAllowed(input: { confirmHost: string | undefined; env: Env }): DbTarget {
  const target = resolveDbTarget(input.env);
  if (!input.confirmHost)
    throw new GuardError(
      `Writing needs --confirm-host ${target.host} (the host of ${target.source}). Re-run with that exact value.`,
    );
  if (isPooledHost(target.host))
    throw new GuardError(
      `${target.source} points at a pooled host (${target.host}). Writes must use the non-pooled DIRECT_URL.`,
    );
  if (input.confirmHost !== target.host)
    throw new GuardError(
      `--confirm-host "${input.confirmHost}" does not match the database host "${target.host}" (${target.source}). Nothing was written.`,
    );
  const expected = input.env.EXPECTED_DB_HOST?.trim();
  if (expected && withoutPooler(expected) !== withoutPooler(target.host))
    throw new GuardError(
      `The database host "${target.host}" does not match EXPECTED_DB_HOST "${expected}". Nothing was written.`,
    );
  return target;
}

export interface OwnerEnv {
  email: string;
  password: string;
  name: string;
}

export const MIN_PASSWORD_LENGTH = 12;

/** The demo owner's login, from the environment only (never from a file). */
export function readOwnerEnv(env: Env): OwnerEnv {
  const email = env.DEMO_OWNER_EMAIL?.trim().toLowerCase();
  const password = env.DEMO_OWNER_PASSWORD;
  if (!email) throw new GuardError('DEMO_OWNER_EMAIL is not set.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GuardError('DEMO_OWNER_EMAIL is not an email address.');
  if (!password) throw new GuardError('DEMO_OWNER_PASSWORD is not set.');
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new GuardError(`DEMO_OWNER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  return { email, password, name: env.DEMO_OWNER_NAME?.trim() || 'Demo Owner' };
}
