import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  extensionIdFromKey, findSource, packageRootFromCli, patchBackground, patchManifest, portOf, readCopy, syncCopies,
} from '../src/extension.js';
import { cfgFor, fakePackage, tmp, UPSTREAM_ID, UPSTREAM_KEY } from './helpers.js';

test('the port patch changes exactly one line and refuses a build that changed', () => {
  assert.equal(patchBackground('a\nvar relayPort = 19989;\nb', 19993), 'a\nvar relayPort = 19993;\nb');
  assert.throws(() => patchBackground('const relayPort = 19989', 19993), /0 times where the patch expects exactly once/);
  assert.throws(() => patchBackground('var relayPort = 19989;var relayPort = 19989;', 19993), /2 times/);
  assert.equal(portOf('x\nvar relayPort = 19993;\n'), 19993);
  assert.equal(portOf('nothing here'), null);
});

test('the manifest gets a name that says where it belongs and keeps its key', () => {
  const m = JSON.parse(patchManifest(JSON.stringify({ name: 'Browser Control', version: '0.0.25', key: 'K' }), { dir: 'Profile 3', port: 19993 }));
  assert.equal(m.name, 'Browser Control (Profile 3, port 19993)');
  assert.equal(m.key, 'K');
  assert.equal(m.version, '0.0.25');
});

test('the extension id comes from the manifest key the way Chromium derives it', () => {
  assert.equal(extensionIdFromKey(UPSTREAM_KEY), UPSTREAM_ID);
});

test('sync writes one patched copy per profile and replaces the whole copy next time', () => {
  const dir = tmp();
  const { ext } = fakePackage(dir);
  const cfg = cfgFor(dir);
  const out = syncCopies(cfg, { dir: ext, extensionVersion: '0.0.25' }, { home: dir });
  assert.deepEqual(out.map((r) => [r.profile.name, r.version]), [['work', '0.0.25'], ['personal', '0.0.25']]);
  const copy = (name, f) => path.join(dir, 'copies', name, f);
  assert.match(readFileSync(copy('work', 'background.js'), 'utf-8'), /var relayPort = 19990;/);
  assert.match(readFileSync(copy('personal', 'background.js'), 'utf-8'), /var relayPort = 19991;/);
  assert.equal(JSON.parse(readFileSync(copy('personal', 'manifest.json'), 'utf-8')).name, 'Browser Control (Profile 1, port 19991)');
  assert.ok(existsSync(copy('work', 'icons/icon-16.png')));
  assert.match(readFileSync(path.join(ext, 'background.js'), 'utf-8'), /var relayPort = 19989;/, 'the package itself is untouched');
  writeFileSync(copy('work', 'stale.txt'), 'x');
  syncCopies(cfg, { dir: ext, extensionVersion: '0.0.25' }, { home: dir });
  assert.equal(existsSync(copy('work', 'stale.txt')), false);
  assert.deepEqual(readCopy({ copyDir: path.join(dir, 'copies', 'work') }), { exists: true, port: 19990, version: '0.0.25' });
  assert.deepEqual(readCopy({ copyDir: path.join(dir, 'copies', 'none') }), { exists: false, port: null, version: null });
});

test('sync writes nothing when the build cannot be patched', () => {
  const dir = tmp();
  const { ext } = fakePackage(dir, { background: 'const relayPort = 19989\n' });
  assert.throws(() => syncCopies(cfgFor(dir), { dir: ext, extensionVersion: '0.0.25' }, { home: dir }), /patch needs updating/);
  assert.equal(existsSync(path.join(dir, 'copies')), false);
});

test('sync never replaces a folder that is not a copy, and refuses a copies folder that is too wide', () => {
  const dir = tmp();
  const { ext } = fakePackage(dir);
  mkdirSync(path.join(dir, 'copies', 'work'), { recursive: true });
  writeFileSync(path.join(dir, 'copies', 'work', 'notes.txt'), 'mine');
  assert.throws(() => syncCopies(cfgFor(dir), { dir: ext }, { home: dir }), /refusing to replace .*work: it is not a copy of Browser Control/);
  assert.equal(readFileSync(path.join(dir, 'copies', 'work', 'notes.txt'), 'utf-8'), 'mine');
  assert.throws(() => syncCopies(cfgFor(dir, { copiesDir: dir }), { dir: ext }, { home: dir }), /too wide/);
  assert.throws(() => syncCopies(cfgFor(dir, { copiesDir: path.dirname(dir) }), { dir: ext }, { home: dir }), /too wide/);
});

test('the package is found from the config, a symlinked command, a wrapper script or npm', () => {
  const dir = tmp();
  const { root, ext } = fakePackage(dir);
  const nothing = { which: () => null, npmRoot: () => null };

  const fromConfig = findSource(cfgFor(dir, { extensionSource: ext }), nothing);
  assert.equal(fromConfig.dir, ext);
  assert.equal(fromConfig.how, 'extensionSource in the config');
  assert.equal(fromConfig.extensionVersion, '0.0.25');
  assert.equal(fromConfig.packageVersion, '0.8.4');
  assert.equal(fromConfig.extensionId, UPSTREAM_ID);

  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  symlinkSync(path.join(root, 'dist', 'cli.js'), path.join(bin, 'browser-control'));
  assert.equal(packageRootFromCli(path.join(bin, 'browser-control')), root);
  const viaLink = findSource(cfgFor(dir), { which: () => path.join(bin, 'browser-control'), npmRoot: () => null });
  assert.equal(viaLink.dir, ext);
  assert.equal(viaLink.how, 'the browser-control command');

  const wrapper = path.join(bin, 'bc-wrapper');
  writeFileSync(wrapper, `#!/bin/sh\nexec "/usr/bin/node" "${root}/dist/cli.js" "$@"\n`, { mode: 0o755 });
  assert.equal(packageRootFromCli(wrapper), root);

  const viaNpm = findSource(cfgFor(dir), { which: () => null, npmRoot: () => path.join(dir, 'lib', 'node_modules') });
  assert.equal(viaNpm.how, 'npm root -g');

  assert.throws(() => findSource(cfgFor(dir), { which: () => null, npmRoot: () => '/nowhere' }), /cannot find the Browser Control extension build; tried \/nowhere\/@opencode-ai\/browser-control\/extension\/dist \(npm root -g\)/);
  assert.throws(() => findSource(cfgFor(dir), nothing), /tried nothing to try/);
});
