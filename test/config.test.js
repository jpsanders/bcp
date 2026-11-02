import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { findProfile, loadConfig, needProfile, profileList, slugify, validate, withDefaults } from '../src/config.js';
import { cfgFor, tmp } from './helpers.js';

test('profiles come out sorted by port, each with its own copy folder', () => {
  const dir = tmp();
  const cfg = cfgFor(dir, { profiles: { 'Profile 1': { name: 'personal', port: 19992 }, Default: { name: 'work', port: 19990 } } });
  assert.deepEqual(profileList(cfg).map((p) => [p.dir, p.name, p.port, p.copyDir]), [
    ['Default', 'work', 19990, path.join(dir, 'copies', 'work')],
    ['Profile 1', 'personal', 19992, path.join(dir, 'copies', 'personal')],
  ]);
});

test('a profile is found by its folder, its name or its number', () => {
  const cfg = cfgFor(tmp());
  assert.equal(findProfile(cfg, 'profile 1').name, 'personal');
  assert.equal(findProfile(cfg, 'work').dir, 'Default');
  assert.equal(findProfile(cfg, '1').dir, 'Profile 1');
  assert.equal(findProfile(cfg, '7'), null);
  assert.equal(findProfile(cfg, ''), null);
  assert.throws(() => needProfile(cfg, 'nope'), /no profile "nope" in the config; profiles: work \(Default\), personal \(Profile 1\)/);
  assert.throws(() => needProfile(cfg, undefined), /name a profile/);
});

test('validation names every problem: ports, names, folders and the user data folder', () => {
  const problems = validate(withDefaults({
    profiles: {
      Default: { name: 'work', port: 19990 },
      'Profile 1': { name: 'work', port: 19990 },
      'Profile 2': { name: 'Bad Name', port: 80 },
      '../x': { name: 'x', port: 19999 },
    },
  }));
  assert.ok(problems.some((p) => /userDataDir is not set/.test(p)));
  assert.ok(problems.some((p) => /Profile 1: port 19990 is also used by Default/.test(p)));
  assert.ok(problems.some((p) => /Profile 1: name "work" is also used by Default/.test(p)));
  assert.ok(problems.some((p) => /Profile 2: port must be a whole number/.test(p)));
  assert.ok(problems.some((p) => /Profile 2: name must be/.test(p)));
  assert.ok(problems.some((p) => /"\.\.\/x" is not a profile folder name/.test(p)));
  assert.deepEqual(validate(cfgFor(tmp())), []);
});

test('loading a config explains a missing file, bad JSON and bad entries', () => {
  const dir = tmp();
  const file = path.join(dir, 'config.json');
  assert.throws(() => loadConfig(file), /no config at .*config\.json: run "bcp init" first/);
  writeFileSync(file, '{ nope');
  assert.throws(() => loadConfig(file), /cannot read/);
  writeFileSync(file, JSON.stringify({ userDataDir: '/x', profiles: { Default: { name: 'a', port: 1 } } }));
  assert.throws(() => loadConfig(file), /needs fixing:\n {2}Default: port must be/);
  writeFileSync(file, JSON.stringify({ userDataDir: '/x', profiles: { Default: { name: 'a', port: 19990 } } }));
  const cfg = loadConfig(file);
  assert.equal(cfg.cli, 'browser-control', 'defaults fill what the file leaves out');
  assert.equal(cfg.copiesDir, '~/browser-control-profiles');
});

test('folder names come from display names, plain and unique', () => {
  const taken = new Set();
  assert.equal(slugify('Work Stuff', taken), 'work-stuff');
  assert.equal(slugify('São João', taken), 'sao-joao');
  assert.equal(slugify('Work Stuff', taken), 'work-stuff-2');
  assert.equal(slugify('!!!', taken), 'profile');
  assert.equal(slugify('hello@example.com', taken), 'hello-example-com');
  assert.ok(slugify('x'.repeat(80), taken).length <= 40);
});
