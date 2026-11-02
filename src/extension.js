import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { profileList } from './config.js';
import { UsageError, expandHome, isInside, tilde } from './paths.js';

export const PACKAGE = '@opencode-ai/browser-control';
const PORT_LINE = /var relayPort = 19989;/g;
const ANY_PORT_LINE = /var relayPort = (\d+);/;

// The extension's service worker connects to a port written into its code. The
// patch changes that one line and refuses a build where it is not exactly once.
export function patchBackground(text, port) {
  const hits = (text.match(PORT_LINE) || []).length;
  if (hits !== 1) {
    throw new UsageError(`background.js sets "var relayPort = 19989;" ${hits} times where the patch expects exactly once: this Browser Control version picks its port differently, so the patch needs updating`);
  }
  return text.replace(PORT_LINE, `var relayPort = ${port};`);
}

export function portOf(backgroundText) {
  const m = ANY_PORT_LINE.exec(backgroundText);
  return m ? Number(m[1]) : null;
}

// The name shows at chrome://extensions, so you can see which copy a profile
// has. The key stays, and with it the extension id the relay accepts.
export function patchManifest(text, profile) {
  const m = JSON.parse(text);
  m.name = `Browser Control (${profile.dir}, port ${profile.port})`;
  return `${JSON.stringify(m, null, 2)}\n`;
}

// Chromium's extension id for a manifest key: the first 16 bytes of the key's
// SHA-256, each half byte written as a letter from a to p.
export function extensionIdFromKey(key) {
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest();
  let id = '';
  for (const byte of digest.subarray(0, 16)) id += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15));
  return id;
}

export function whichSync(cmd, env = process.env) {
  if (!cmd) return null;
  const executable = (f) => {
    try {
      accessSync(f, constants.X_OK);
      return statSync(f).isFile();
    } catch {
      return false;
    }
  };
  if (cmd.includes('/')) return executable(cmd) ? path.resolve(cmd) : null;
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (dir && executable(path.join(dir, cmd))) return path.join(dir, cmd);
  }
  return null;
}

function isBrowserControlRoot(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8')).name === PACKAGE;
  } catch {
    return false;
  }
}

// The package folder behind the browser-control command: through a symlink to
// dist/cli.js, or a small wrapper script that names that file.
export function packageRootFromCli(file) {
  let real;
  try {
    real = realpathSync(file);
  } catch {
    return null;
  }
  if (path.basename(real) === 'cli.js' && path.basename(path.dirname(real)) === 'dist') {
    const root = path.dirname(path.dirname(real));
    if (isBrowserControlRoot(root)) return root;
  }
  try {
    if (statSync(real).size > 64 * 1024) return null;
    const m = /([^\s"'`]*@opencode-ai\/browser-control)\/dist\/cli\.js/.exec(readFileSync(real, 'utf-8'));
    if (m && isBrowserControlRoot(expandHome(m[1]))) return expandHome(m[1]);
  } catch {
    // not readable as text
  }
  return null;
}

export function npmGlobalRoot() {
  try {
    return execFileSync('npm', ['root', '-g'], { encoding: 'utf-8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function describeSource(dir) {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
  const root = path.dirname(path.dirname(dir));
  let packageVersion = null;
  if (isBrowserControlRoot(root)) packageVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8')).version;
  return {
    dir,
    extensionVersion: manifest.version || null,
    extensionId: manifest.key ? extensionIdFromKey(manifest.key) : null,
    packageVersion,
  };
}

// The extension build inside the installed Browser Control package.
export function findSource(cfg, { env = process.env, which = whichSync, npmRoot = npmGlobalRoot } = {}) {
  const candidates = [];
  if (cfg.extensionSource) {
    candidates.push({ dir: path.resolve(expandHome(cfg.extensionSource)), how: 'extensionSource in the config' });
  } else {
    const cli = which(expandHome(cfg.cli), env);
    const root = cli && packageRootFromCli(cli);
    if (root) candidates.push({ dir: path.join(root, 'extension', 'dist'), how: `the ${cfg.cli} command` });
    const npm = npmRoot(env);
    if (npm) candidates.push({ dir: path.join(npm, PACKAGE, 'extension', 'dist'), how: 'npm root -g' });
  }
  for (const c of candidates) {
    if (existsSync(path.join(c.dir, 'background.js')) && existsSync(path.join(c.dir, 'manifest.json'))) {
      return { ...describeSource(c.dir), how: c.how };
    }
  }
  const tried = candidates.map((c) => `${tilde(c.dir)} (${c.how})`).join(', ') || 'nothing to try';
  throw new UsageError(`cannot find the Browser Control extension build; tried ${tried}. Install it with "npm install -g ${PACKAGE}", or set extensionSource in the config to its extension/dist folder`);
}

// A folder sync may replace: missing, or an earlier copy of Browser Control.
function replaceable(dir) {
  if (!existsSync(dir)) return true;
  try {
    const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
    return typeof m.name === 'string' && m.name.startsWith('Browser Control') && existsSync(path.join(dir, 'background.js'));
  } catch {
    return false;
  }
}

// Writes each profile's copy of the extension with its own port. Run again
// after every Browser Control upgrade, then reload the copies.
export function syncCopies(cfg, source, { home = os.homedir() } = {}) {
  const copiesDir = path.resolve(expandHome(cfg.copiesDir, home));
  if (copiesDir === path.parse(copiesDir).root || copiesDir === home || isInside(home, copiesDir)) {
    throw new UsageError(`copiesDir ${tilde(copiesDir, home)} is too wide: give the copies a folder of their own, such as ~/browser-control-profiles`);
  }
  const background = readFileSync(path.join(source.dir, 'background.js'), 'utf-8');
  const manifest = readFileSync(path.join(source.dir, 'manifest.json'), 'utf-8');
  patchBackground(background, 0);
  const list = profileList(cfg);
  for (const p of list) {
    if (!isInside(p.copyDir, copiesDir)) throw new UsageError(`refusing to write ${p.copyDir}: it is not inside ${copiesDir}`);
    if (!replaceable(p.copyDir)) throw new UsageError(`refusing to replace ${tilde(p.copyDir, home)}: it is not a copy of Browser Control`);
  }
  mkdirSync(copiesDir, { recursive: true });
  return list.map((p) => {
    const tmp = `${p.copyDir}.new`;
    rmSync(tmp, { recursive: true, force: true });
    cpSync(source.dir, tmp, { recursive: true });
    writeFileSync(path.join(tmp, 'background.js'), patchBackground(background, p.port));
    writeFileSync(path.join(tmp, 'manifest.json'), patchManifest(manifest, p));
    rmSync(p.copyDir, { recursive: true, force: true });
    renameSync(tmp, p.copyDir);
    return { profile: p, version: source.extensionVersion };
  });
}

// What is in a profile's copy folder now: its port and extension version.
export function readCopy(profile) {
  try {
    const port = portOf(readFileSync(path.join(profile.copyDir, 'background.js'), 'utf-8'));
    const version = JSON.parse(readFileSync(path.join(profile.copyDir, 'manifest.json'), 'utf-8')).version || null;
    return { exists: true, port, version };
  } catch {
    return { exists: false, port: null, version: null };
  }
}
