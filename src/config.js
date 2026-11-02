import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError, expandHome, tilde } from './paths.js';

// Browser Control's own port. Profiles get their own ports from FIRST_PORT up,
// so a plain browser-control command keeps working as it did.
export const UPSTREAM_PORT = 19989;
export const FIRST_PORT = 19990;

export const DEFAULTS = Object.freeze({
  browser: null,
  userDataDir: null,
  cli: 'browser-control',
  mcp: 'browser-control-mcp',
  extensionSource: null,
  copiesDir: '~/browser-control-profiles',
  connectTimeoutSec: 60,
  openGraceSec: 35,
  wakeCloseSec: 120,
  profiles: {},
});

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function withDefaults(raw = {}) {
  return { ...DEFAULTS, ...raw, profiles: { ...(raw.profiles || {}) } };
}

export function validate(cfg) {
  const problems = [];
  if (!cfg.userDataDir) problems.push('userDataDir is not set: it is the folder that holds the browser\'s "Local State" file');
  for (const key of ['connectTimeoutSec', 'openGraceSec', 'wakeCloseSec']) {
    if (typeof cfg[key] !== 'number' || !(cfg[key] >= 0)) problems.push(`${key} must be a number of seconds`);
  }
  const ports = new Map();
  const names = new Map();
  for (const [dir, p] of Object.entries(cfg.profiles || {})) {
    if (!dir || /[\\/]/.test(dir) || dir === '.' || dir === '..') {
      problems.push(`"${dir}" is not a profile folder name such as "Default" or "Profile 1"`);
      continue;
    }
    if (!p || typeof p !== 'object') {
      problems.push(`${dir}: expected an object with a name and a port`);
      continue;
    }
    if (!Number.isInteger(p.port) || p.port < 1024 || p.port > 65535) problems.push(`${dir}: port must be a whole number from 1024 to 65535`);
    else if (ports.has(p.port)) problems.push(`${dir}: port ${p.port} is also used by ${ports.get(p.port)}`);
    else ports.set(p.port, dir);
    if (typeof p.name !== 'string' || !NAME.test(p.name)) problems.push(`${dir}: name must be up to 40 lowercase letters, digits and dashes, as it names the folder of the copy`);
    else if (names.has(p.name)) problems.push(`${dir}: name "${p.name}" is also used by ${names.get(p.name)}`);
    else names.set(p.name, dir);
  }
  return problems;
}

export function loadConfig(file) {
  if (!existsSync(file)) throw new UsageError(`no config at ${tilde(file)}: run "bcp init" first`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (e) {
    throw new UsageError(`cannot read ${tilde(file)}: ${e.message}`);
  }
  const cfg = withDefaults(raw);
  const problems = validate(cfg);
  if (problems.length) throw new UsageError(`${tilde(file)} needs fixing:\n  ${problems.join('\n  ')}`);
  return cfg;
}

export function saveConfig(file, cfg) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
}

export function profileList(cfg) {
  const copiesDir = path.resolve(expandHome(cfg.copiesDir));
  return Object.entries(cfg.profiles || {})
    .map(([dir, p]) => ({ dir, name: p.name, port: p.port, copyDir: path.join(copiesDir, p.name) }))
    .sort((a, b) => a.port - b.port);
}

// A profile by its folder ("Profile 3"), its name ("work") or its number ("3").
export function findProfile(cfg, ref) {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  const lower = r.toLowerCase();
  const list = profileList(cfg);
  return list.find((p) => p.dir.toLowerCase() === lower)
    || list.find((p) => p.name === lower)
    || (/^\d+$/.test(r) ? list.find((p) => p.dir === `Profile ${r}`) : null)
    || null;
}

export function needProfile(cfg, ref) {
  const p = findProfile(cfg, ref);
  if (p) return p;
  const known = profileList(cfg).map((x) => `${x.name} (${x.dir})`).join(', ') || 'none yet';
  throw new UsageError(ref ? `no profile "${ref}" in the config; profiles: ${known}` : `name a profile; profiles: ${known}`);
}

// A folder name from a profile's display name: "Work Stuff" becomes "work-stuff".
export function slugify(text, taken = new Set(), fallback = 'profile') {
  const base = String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36).replace(/-+$/, '') || fallback;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  taken.add(name);
  return name;
}
