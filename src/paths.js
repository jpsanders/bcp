import os from 'node:os';
import path from 'node:path';

// An error the user can act on: printed as its message alone, without a stack.
export class UsageError extends Error {}

export function expandHome(p, home = os.homedir()) {
  if (!p) return p;
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

export function tilde(p, home = os.homedir()) {
  if (!p) return p;
  if (p === home) return '~';
  return p.startsWith(`${home}${path.sep}`) ? `~/${p.slice(home.length + 1)}` : p;
}

// True when child sits somewhere below parent (never parent itself).
export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function defaultConfigPath(env = process.env, home = os.homedir()) {
  if (env.BROWSER_CONTROL_PROFILES_CONFIG) return path.resolve(expandHome(env.BROWSER_CONTROL_PROFILES_CONFIG, home));
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'browser-control-profiles', 'config.json');
}
