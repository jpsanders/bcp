import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DEFAULTS, FIRST_PORT, loadConfig, needProfile, profileList, saveConfig, slugify, validate, withDefaults } from './config.js';
import { copyState, detectBrowsers, isSnapBrowser, knownBrowsers, readProfiles, snapProblem } from './browsers.js';
import { Runner } from './check.js';
import { findSource, readCopy, syncCopies } from './extension.js';
import { UsageError, expandHome, tilde } from './paths.js';
import { relayStatus, startRelay, stopRelay } from './relay.js';
import { openWindow } from './window.js';

function pickBrowser(flags, home) {
  const known = knownBrowsers({ home });
  if (flags.browser && !known.some((b) => b.id === flags.browser)) {
    throw new UsageError(`unknown browser "${flags.browser}"; known here: ${known.map((b) => b.id).join(', ') || 'none'}. For another browser, give --user-data-dir and set "browser" in the config afterwards`);
  }
  if (flags['user-data-dir']) {
    const userDataDir = path.resolve(expandHome(flags['user-data-dir'], home));
    const match = known.find((b) => b.id === flags.browser) || known.find((b) => b.userDataDir === userDataDir);
    return { label: match ? match.label : tilde(userDataDir, home), browser: match ? match.browser : null, userDataDir };
  }
  const found = detectBrowsers({ home }).filter((b) => !flags.browser || b.id === flags.browser);
  if (!found.length) {
    throw new UsageError(flags.browser ? `found no profiles for ${flags.browser}` : 'found no Chromium family browser profiles; name the browser\'s user data folder with --user-data-dir');
  }
  if (found.length > 1) throw new UsageError(`found profiles for ${found.map((b) => `${b.label} (--browser ${b.id})`).join(', ')}; pick one with --browser`);
  return found[0];
}

function pickProfiles(all, refs) {
  if (!refs.length) return all;
  const chosen = [];
  for (const ref of refs) {
    const r = ref.toLowerCase();
    const hit = all.find((p) => p.dir.toLowerCase() === r)
      || (/^\d+$/.test(ref) ? all.find((p) => p.dir === `Profile ${ref}`) : null)
      || all.find((p) => p.displayName.toLowerCase() === r);
    if (!hit) throw new UsageError(`no profile "${ref}"; profiles: ${all.map((p) => `${p.dir} (${p.displayName})`).join(', ')}`);
    if (!chosen.includes(hit)) chosen.push(hit);
  }
  return chosen;
}

function snapWarning(cfg, home) {
  const userDataDir = expandHome(cfg.userDataDir, home);
  if (!isSnapBrowser(userDataDir, home)) return null;
  return snapProblem(expandHome(cfg.copiesDir, home), userDataDir, home);
}

export async function init({ configPath, flags, positionals, home }) {
  if (existsSync(configPath) && !flags.force) throw new UsageError(`${tilde(configPath, home)} exists already; add --force to write it again`);
  const pick = pickBrowser(flags, home);
  if (!existsSync(path.join(pick.userDataDir, 'Local State'))) {
    throw new UsageError(`no "Local State" file in ${tilde(pick.userDataDir, home)}: that is not a browser's user data folder`);
  }
  const chosen = pickProfiles(readProfiles(pick.userDataDir), positionals);
  if (!chosen.length) throw new UsageError(`no profiles in ${tilde(pick.userDataDir, home)}`);
  const firstPort = flags['first-port'] === undefined ? FIRST_PORT : Number(flags['first-port']);
  const taken = new Set();
  const profiles = {};
  chosen.forEach((p, i) => { profiles[p.dir] = { name: slugify(p.displayName, taken), port: firstPort + i }; });
  const cfg = withDefaults({
    browser: pick.browser,
    userDataDir: tilde(pick.userDataDir, home),
    copiesDir: flags['copies-dir'] || DEFAULTS.copiesDir,
    profiles,
  });
  const problems = validate(cfg);
  if (problems.length) throw new UsageError(problems.join('\n'));
  const snap = snapWarning(cfg, home);
  if (snap) throw new UsageError(`${snap}; choose another folder with --copies-dir`);
  saveConfig(configPath, cfg);
  const list = profileList(cfg);
  const w = Math.max(...list.map((p) => p.name.length));
  return [
    `Wrote ${tilde(configPath, home)} for ${pick.label}:`,
    ...list.map((p) => `  ${p.name.padEnd(w)}  ${p.dir}, port ${p.port}`),
    `Copies of the extension will go to ${tilde(path.resolve(expandHome(cfg.copiesDir, home)), home)}.`,
    cfg.browser ? null : 'Set "browser" in the config to the browser\'s executable, so open and check can open windows.',
    '',
    'Next:',
    '  1. bcp sync',
    '  2. In each profile, open chrome://extensions, switch on Developer mode, choose Load unpacked and pick',
    '     that profile\'s folder. "bcp open <name>" opens the page in the right profile.',
    '  3. bcp check',
    'Edit the config to drop profiles you do not need, or to change names and ports.',
  ].filter((l) => l !== null).join('\n');
}

function copyText(p, copy, source) {
  if (!copy.exists) return 'no copy yet: run sync';
  if (copy.port !== p.port) return `the copy connects to port ${copy.port}: run sync`;
  if (source && copy.version !== source.extensionVersion) return `extension ${copy.version}, the package has ${source.extensionVersion}: run sync, then reload it`;
  return `extension ${copy.version}`;
}

function relayText(r) {
  if (!r.relay) return 'down';
  return r.connected ? 'up, extension connected' : 'up, extension not connected';
}

export async function list({ configPath, flags, env, home }) {
  const cfg = loadConfig(configPath);
  let source = null;
  let sourceError = null;
  try {
    source = findSource(cfg, { env });
  } catch (e) {
    sourceError = e.message;
  }
  const warnings = [];
  const snap = snapWarning(cfg, home);
  if (snap) warnings.push(`${snap}; set copiesDir in the config to a folder it can read`);
  const rows = [];
  for (const p of profileList(cfg)) {
    const state = copyState(cfg, p, { extensionId: source && source.extensionId });
    warnings.push(...state.warnings);
    rows.push({ profile: p, copy: readCopy(p), loaded: state, relay: await relayStatus(p.port) });
  }
  if (flags.json) return JSON.stringify({ config: configPath, source, sourceError, warnings, profiles: rows }, null, 2);
  const lines = [
    source
      ? `Browser Control ${source.packageVersion || ''}${source.packageVersion ? ', ' : ''}extension ${source.extensionVersion}, found through ${source.how}`
      : `Browser Control: ${sourceError}`,
    `Copies in ${tilde(path.resolve(expandHome(cfg.copiesDir, home)), home)}`,
    '',
  ];
  for (const r of rows) {
    lines.push(`${r.profile.name} (${r.profile.dir}), port ${r.profile.port}`);
    lines.push(`  copy     ${copyText(r.profile, r.copy, source)}`);
    lines.push(`  profile  ${r.loaded.text}`);
    lines.push(`  relay    ${relayText(r.relay)}`);
  }
  if (!rows.length) lines.push('No profiles in the config.');
  if (warnings.length) lines.push('', ...warnings.map((w) => `Warning: ${w}`));
  return lines.join('\n');
}

export async function sync({ configPath, flags, env, home }) {
  const cfg = loadConfig(configPath);
  if (flags.source) cfg.extensionSource = flags.source;
  const source = findSource(cfg, { env });
  const out = syncCopies(cfg, source, { home });
  const w = Math.max(0, ...out.map((r) => r.profile.name.length));
  const snap = snapWarning(cfg, home);
  return [
    `Copied Browser Control extension ${source.extensionVersion}${source.packageVersion ? ` (package ${source.packageVersion})` : ''} from ${tilde(source.dir, home)}:`,
    ...out.map((r) => `  ${r.profile.name.padEnd(w)}  ${tilde(r.profile.copyDir, home)}, port ${r.profile.port}`),
    out.length ? 'Load each copy unpacked in its profile the first time; after that, reload it at chrome://extensions.' : 'No profiles in the config.',
    snap ? `Warning: ${snap}` : null,
  ].filter((l) => l !== null).join('\n');
}

export async function open({ configPath, flags, positionals, home }) {
  const cfg = loadConfig(configPath);
  const p = needProfile(cfg, positionals[0]);
  const url = flags.url || 'chrome://extensions';
  await openWindow(cfg, p, url);
  const hint = url === 'chrome://extensions' ? ` To load its copy, switch on Developer mode, choose Load unpacked and pick ${tilde(p.copyDir, home)}.` : '';
  return `Opened ${p.dir} at ${url}.${hint}`;
}

export async function start({ configPath, positionals }) {
  const cfg = loadConfig(configPath);
  const p = needProfile(cfg, positionals[0]);
  const r = await startRelay(cfg, p.port);
  if (!r.ok) throw new UsageError(r.error);
  return r.started ? `Started the relay for ${p.name} on port ${p.port}.` : `The relay for ${p.name} was already up on port ${p.port}.`;
}

export async function stop({ configPath, flags, positionals }) {
  const cfg = loadConfig(configPath);
  const chosen = flags.all ? profileList(cfg) : [needProfile(cfg, positionals[0])];
  const lines = [];
  for (const p of chosen) {
    const r = await stopRelay(p.port);
    lines.push(`${p.name} (port ${p.port}): ${r.stopped ? 'stopped' : r.why}`);
  }
  return lines.join('\n');
}

export async function check({ configPath, positionals, env, ops = null }) {
  const cfg = loadConfig(configPath);
  const chosen = positionals.length ? positionals.map((ref) => needProfile(cfg, ref)) : profileList(cfg);
  let extensionId = null;
  try {
    extensionId = findSource(cfg, { env }).extensionId;
  } catch {
    // the loaded copy is still found by its folder
  }
  const runner = new Runner({ cfg, extensionId, ops: ops || {} });
  const lines = [];
  let failed = 0;
  for (const p of chosen) {
    const session = `bcp-check-${Date.now().toString(36)}`;
    const prep = await runner.prepare(p, { session });
    if (!prep.ok) {
      failed++;
      lines.push(`${p.name} (${p.dir}): not ready, ${prep.error}`);
      continue;
    }
    const done = await runner.cleanup(p, { session, stopRelay: prep.startedRelay });
    const notes = [prep.opened ? 'opened a window for it' : null, done.ok ? null : `cleanup: ${done.error}`].filter(Boolean);
    lines.push(`${p.name} (${p.dir}): works, opened and closed a tab through port ${p.port}${notes.length ? ` (${notes.join('; ')})` : ''}`);
  }
  if (!chosen.length) lines.push('No profiles in the config.');
  return { text: lines.join('\n'), code: failed ? 1 : 0 };
}

export async function mcp({ configPath, flags, positionals }) {
  const cfg = loadConfig(configPath);
  if (flags.all) {
    const servers = {};
    for (const one of profileList(cfg)) {
      servers[`browser-control-${one.name}`] = { command: expandHome(cfg.mcp), args: [], env: { BROWSER_CONTROL_PORT: String(one.port) } };
    }
    const block = JSON.stringify({ mcpServers: servers }, null, 2);
    if (flags.json) return block;
    const adds = Object.entries(servers).map(([name, e]) => `  claude mcp add ${name} -e BROWSER_CONTROL_PORT=${e.env.BROWSER_CONTROL_PORT} -- ${e.command}`);
    return ['Claude Code:', ...adds, '', 'Any client that takes JSON:', `  ${block.split('\n').join('\n  ')}`].join('\n');
  }
  const p = needProfile(cfg, positionals[0]);
  const name = `browser-control-${p.name}`;
  const command = expandHome(cfg.mcp);
  const entry = { command, args: [], env: { BROWSER_CONTROL_PORT: String(p.port) } };
  if (flags.json) return JSON.stringify({ [name]: entry }, null, 2);
  return [
    `MCP server for ${p.name} (${p.dir}), port ${p.port}.`,
    '',
    'Claude Code:',
    `  claude mcp add ${name} -e BROWSER_CONTROL_PORT=${p.port} -- ${command}`,
    '',
    'Any client that takes JSON:',
    `  ${JSON.stringify({ [name]: entry }, null, 2).split('\n').join('\n  ')}`,
  ].join('\n');
}

export async function run({ configPath, positionals, rest, env }) {
  const cfg = loadConfig(configPath);
  const p = needProfile(cfg, positionals[0]);
  if (!rest.length) throw new UsageError('give the command after --, as in: bcp run work -- browser-control status');
  const code = await new Promise((resolve, reject) => {
    const child = spawn(rest[0], rest.slice(1), { stdio: 'inherit', env: { ...env, BROWSER_CONTROL_PORT: String(p.port) } });
    child.on('error', (e) => reject(new UsageError(`cannot run ${rest[0]}: ${e.message}`)));
    child.on('exit', (c, signal) => resolve(c === null ? (signal ? 1 : 0) : c));
  });
  return { text: null, code };
}
