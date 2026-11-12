import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { main, parseArgs } from '../bin/bcp.js';
import { saveConfig } from '../src/config.js';
import { check } from '../src/commands.js';
import { cfgFor, fakeBrowser, fakePackage, freePorts, prefs, tmp, UPSTREAM_ID } from './helpers.js';

const env = { PATH: '' };

test('arguments: flags with and without =, positionals, and everything after --', () => {
  assert.deepEqual(parseArgs(['init', 'Work', '--first-port', '20000', '--copies-dir=~/c', '--force']), {
    flags: { 'first-port': '20000', 'copies-dir': '~/c', force: true }, positionals: ['init', 'Work'], rest: [],
  });
  assert.deepEqual(parseArgs(['run', 'work', '--', 'browser-control', '--json']).rest, ['browser-control', '--json']);
  assert.equal(parseArgs(['-h']).flags.help, true);
  assert.throws(() => parseArgs(['--nope']), /unknown option --nope/);
  assert.throws(() => parseArgs(['-x']), /unknown option -x/);
  assert.throws(() => parseArgs(['--url']), /--url needs a value/);
  assert.throws(() => parseArgs(['--json=1']), /takes no value/);
});

test('help, version and an unknown command', async () => {
  assert.match((await main(['--help'], { env })).text, /^bcp \(Browser Control Profiles\): drive several Chromium profiles at once/);
  assert.match((await main(['--version'], { env })).text, /^\d+\.\d+\.\d+$/);
  await assert.rejects(main(['frobnicate'], { env }), /unknown command "frobnicate"/);
});

test('init writes a config from the browser\'s profiles, with a port and a folder name each', async () => {
  const home = tmp();
  const userDataDir = fakeBrowser(path.join(home, 'browser-data'));
  const config = path.join(home, 'config.json');
  const r = await main(['init', '--user-data-dir', userDataDir, '--config', config], { env, home });
  assert.match(r.text, /Wrote ~\/config\.json for ~\/browser-data:/);
  assert.match(r.text, /work {10}Default, port 19990/);
  assert.match(r.text, /personal {6}Profile 1, port 19991/);
  assert.match(r.text, /side-project {2}Profile 2, port 19992/);
  assert.match(r.text, /Set "browser" in the config/);
  const cfg = JSON.parse(readFileSync(config, 'utf-8'));
  assert.equal(cfg.userDataDir, '~/browser-data');
  assert.deepEqual(cfg.profiles['Profile 2'], { name: 'side-project', port: 19992 });
  await assert.rejects(main(['init', '--user-data-dir', userDataDir, '--config', config], { env, home }), /exists already; add --force/);

  const some = await main(['init', 'Side Project', '1', '--user-data-dir', userDataDir, '--config', config, '--force', '--first-port', '20100'], { env, home });
  assert.match(some.text, /side-project {2}Profile 2, port 20100/);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(config, 'utf-8')).profiles), ['Profile 2', 'Profile 1']);
  await assert.rejects(main(['init', 'Nobody', '--user-data-dir', userDataDir, '--config', config, '--force'], { env, home }), /no profile "Nobody"; profiles: Default \(Work\)/);
});

test('init for a snap browser refuses a copies folder the snap cannot read', async () => {
  const home = tmp();
  const userDataDir = fakeBrowser(path.join(home, 'snap', 'chromium', 'common', 'chromium'));
  const config = path.join(home, 'config.json');
  await assert.rejects(
    main(['init', '--user-data-dir', userDataDir, '--config', config, '--copies-dir', '~/.cache/copies'], { env, home }),
    /cannot read folders in your home whose name starts with a dot; choose another folder with --copies-dir/,
  );
  assert.equal(existsSync(config), false);
  const ok = await main(['init', '--user-data-dir', userDataDir, '--config', config], { env, home });
  assert.match(ok.text, /for Chromium \(snap\)|for ~\/snap/);
});

test('sync, list and mcp against a fake package and browser', async () => {
  const dir = tmp();
  const { ext } = fakePackage(dir);
  fakeBrowser(path.join(dir, 'chromium'), { Default: 'Work', 'Profile 1': 'Personal' });
  const [p1, p2] = await freePorts(2);
  const config = path.join(dir, 'config.json');
  const cfg = cfgFor(dir, { extensionSource: ext, mcp: '/opt/bin/browser-control-mcp' });
  cfg.profiles = { Default: { name: 'work', port: p1 }, 'Profile 1': { name: 'personal', port: p2 } };
  saveConfig(config, cfg);

  const before = await main(['list', '--config', config], { env, home: dir });
  assert.match(before.text, /^Browser Control 0\.8\.4, extension 0\.0\.25, found through extensionSource in the config/);
  assert.match(before.text, new RegExp(`work \\(Default\\), port ${p1}\\n  copy     no copy yet: run sync\\n  profile  cannot read Default/Preferences`));
  assert.match(before.text, /relay {4}down/);

  const synced = await main(['sync', '--config', config], { env, home: dir });
  assert.match(synced.text, /Copied Browser Control extension 0\.0\.25 \(package 0\.8\.4\)/);
  assert.match(synced.text, new RegExp(`personal  ~/copies/personal, port ${p2}`));

  prefs(path.join(dir, 'chromium'), 'Default', { [UPSTREAM_ID]: { path: path.join(dir, 'copies', 'work') } });
  const after = JSON.parse((await main(['--config', config, '--json'], { env, home: dir })).text);
  assert.equal(after.profiles[0].copy.port, p1);
  assert.equal(after.profiles[0].loaded.ok, true);
  assert.equal(after.profiles[1].loaded.ok, false);
  assert.equal(after.profiles[0].relay.relay, false);

  const mcp = await main(['mcp', 'work', '--config', config], { env, home: dir });
  assert.match(mcp.text, new RegExp(`claude mcp add browser-control-work -e BROWSER_CONTROL_PORT=${p1} -- /opt/bin/browser-control-mcp`));
  const json = JSON.parse((await main(['mcp', 'personal', '--json', '--config', config], { env, home: dir })).text);
  assert.deepEqual(json, { 'browser-control-personal': { command: '/opt/bin/browser-control-mcp', args: [], env: { BROWSER_CONTROL_PORT: String(p2) } } });
  await assert.rejects(main(['mcp', '--config', config], { env, home: dir }), /name a profile; profiles: work \(Default\), personal \(Profile 1\)/);

  const all = JSON.parse((await main(['mcp', '--all', '--json', '--config', config], { env, home: dir })).text);
  assert.deepEqual(Object.keys(all.mcpServers), ['browser-control-work', 'browser-control-personal']);
  assert.equal(all.mcpServers['browser-control-personal'].env.BROWSER_CONTROL_PORT, String(p2));
  const allText = (await main(['mcp', '--all', '--config', config], { env, home: dir })).text;
  assert.match(allText, new RegExp(`claude mcp add browser-control-work -e BROWSER_CONTROL_PORT=${p1} -- /opt/bin/browser-control-mcp`));
});

test('run hands the profile\'s port to the command and passes its exit code back', async () => {
  const dir = tmp();
  const config = path.join(dir, 'config.json');
  saveConfig(config, cfgFor(dir));
  const script = 'process.exit(process.env.BROWSER_CONTROL_PORT === "19991" ? 7 : 1)';
  const r = await main(['run', 'personal', '--config', config, '--', process.execPath, '-e', script], { env: process.env, home: dir });
  assert.deepEqual(r, { text: null, code: 7 });
  await assert.rejects(main(['run', 'personal', '--config', config], { env, home: dir }), /give the command after --/);
});

test('check reports each profile and fails when one is not ready', async () => {
  const dir = tmp();
  const config = path.join(dir, 'config.json');
  saveConfig(config, cfgFor(dir));
  const ops = {
    copyState: (p) => (p.name === 'work' ? { ok: true, text: 'ok', warnings: [] } : { ok: false, text: 'has not loaded ~/copies/personal yet', warnings: [] }),
    isOpen: () => true,
    status: async () => ({ relay: true, connected: true }),
    cli: async () => ({ ok: true, stdout: '', stderr: '' }),
    open: async () => {},
    stop: async () => ({ stopped: true }),
  };
  const r = await check({ configPath: config, positionals: [], env, ops });
  assert.equal(r.code, 1);
  assert.match(r.text, /^work \(Default\): works, opened and closed a tab through port 19990$/m);
  assert.match(r.text, /^personal \(Profile 1\): not ready, Profile 1 has not loaded ~\/copies\/personal yet$/m);
  const one = await check({ configPath: config, positionals: ['work'], env, ops });
  assert.equal(one.code, 0);
});

test('guide prints the manual, man prints or installs the man page, and the man page is up to date', async () => {
  const dir = tmp();
  const guide = await main(['guide'], { env, home: dir });
  assert.match(guide.text, /^# bcp\n/);
  assert.match(guide.text, /## FOR AGENTS/);
  const raw = await main(['man', '--raw'], { env, home: dir });
  assert.match(raw.text, /^\.TH BCP 1/);
  const installed = await main(['man', '--install'], { env: { ...env, XDG_DATA_HOME: path.join(dir, 'data') }, home: dir });
  assert.match(installed.text, /installed .*man1\/bcp\.1/);
  assert.ok(existsSync(path.join(dir, 'data', 'man', 'man1', 'bcp.1')));
  const { toRoff } = await import('../scripts/build-man.mjs');
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  assert.equal(readFileSync(path.join(root, 'man', 'bcp.1'), 'utf-8'), toRoff(readFileSync(path.join(root, 'docs', 'MANUAL.md'), 'utf-8')), 'man/bcp.1 is stale: npm run man');
});
