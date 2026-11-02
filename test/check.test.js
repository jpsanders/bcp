import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Runner } from '../src/check.js';
import { findProfile } from '../src/config.js';
import { cfgFor, tmp } from './helpers.js';

// A fake relay and browser: the relay starts on the first command that needs
// one; the extension connects once a window is open (or already was).
function fakeOps({ relayUp = false, windowOpen = false, connectAfter = 1, failing = {} } = {}) {
  const log = [];
  let relay = relayUp;
  let open = windowOpen;
  let polls = 0;
  return {
    log,
    ops: {
      copyState: () => ({ ok: true, text: 'has its copy loaded', warnings: [] }),
      isOpen: () => false,
      status: async () => {
        if (open && relay) polls++;
        return { relay, connected: relay && open && polls >= connectAfter };
      },
      cli: async (port, args) => {
        log.push(['cli', port, ...args]);
        if (args[0] === 'session' && args[1] === 'list') relay = true;
        const fail = failing[args.slice(0, 2).join(' ')];
        return fail ? { ok: false, exitCode: 1, stdout: '', stderr: fail } : { ok: true, exitCode: 0, stdout: '', stderr: '' };
      },
      open: async (p, url) => { log.push(['open', p.dir, url.slice(0, 15)]); open = true; },
      stop: async (port) => { log.push(['stop', port]); relay = false; return { stopped: true }; },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
    },
  };
}

const setup = (opts) => {
  const cfg = cfgFor(tmp());
  const fake = fakeOps(opts);
  return { cfg, ...fake, runner: new Runner({ cfg, ops: fake.ops }), work: findProfile(cfg, 'work') };
};

test('prepare starts the relay, wakes the profile and opens the first tab; cleanup closes it and stops the relay it started', async () => {
  const { runner, work, log } = setup();
  const prep = await runner.prepare(work, { session: 'bcp-1' });
  assert.deepEqual(prep, { ok: true, opened: true, startedRelay: true });
  assert.deepEqual(log, [
    ['cli', 19990, 'session', 'list', '--json'],
    ['open', 'Default', 'data:text/html;'],
    ['cli', 19990, 'session', 'new', 'bcp-1'],
    ['cli', 19990, 'execute', '--session', 'bcp-1', 'return page.url()'],
  ]);
  const done = await runner.cleanup(work, { session: 'bcp-1', stopRelay: prep.startedRelay });
  assert.equal(done.ok, true);
  assert.deepEqual(log.slice(4), [['cli', 19990, 'session', 'delete', 'bcp-1'], ['stop', 19990]]);
});

test('a relay that was already up is used and left running', async () => {
  const { runner, work, log } = setup({ relayUp: true, windowOpen: true });
  const prep = await runner.prepare(work, { session: 'bcp-2' });
  assert.deepEqual(prep, { ok: true, opened: false, startedRelay: false });
  await runner.cleanup(work, { session: 'bcp-2', stopRelay: prep.startedRelay });
  assert.deepEqual(log.map((l) => l.slice(0, 4)), [
    ['cli', 19990, 'session', 'new'], ['cli', 19990, 'execute', '--session'], ['cli', 19990, 'session', 'delete'],
  ]);
});

test('an open profile gets time to reconnect by itself before a window is opened', async () => {
  const { cfg, ops, log } = { cfg: cfgFor(tmp()), ...fakeOps({ windowOpen: true, connectAfter: 3 }) };
  cfg.openGraceSec = 0.2;
  ops.isOpen = () => true;
  const prep = await new Runner({ cfg, ops }).prepare(findProfile(cfg, 'work'), { session: 'bcp-3' });
  assert.equal(prep.ok, true);
  assert.equal(prep.opened, false);
  assert.equal(log.some((l) => l[0] === 'open'), false);

  const asleep = fakeOps({ connectAfter: 1 });
  asleep.ops.isOpen = () => true;
  const late = await new Runner({ cfg, ops: asleep.ops }).prepare(findProfile(cfg, 'work'), { session: 'bcp-4' });
  assert.equal(late.ok, true);
  assert.equal(late.opened, true, 'a window once the grace has passed');
});

test('a connected profile with no window gets one, and the first tab is tried again', async () => {
  const { cfg, ops, log } = { cfg: cfgFor(tmp()), ...fakeOps({ relayUp: true, windowOpen: true }) };
  let windows = 0;
  const cli = ops.cli;
  ops.cli = async (port, args) => {
    if (args[0] === 'execute' && !windows) {
      log.push(['cli', port, ...args]);
      return { ok: false, exitCode: 1, stdout: '', stderr: 'browserContext.newPage: Protocol error (Target.createTarget): No current window' };
    }
    return cli(port, args);
  };
  ops.open = async (p, url) => { log.push(['open', p.dir, url.slice(0, 15)]); windows++; };
  const prep = await new Runner({ cfg, ops }).prepare(findProfile(cfg, 'work'), { session: 'bcp-5' });
  assert.equal(prep.ok, true);
  assert.equal(prep.opened, true);
  assert.deepEqual(log.map((l) => l.slice(0, 3)), [
    ['cli', 19990, 'session'], ['cli', 19990, 'execute'], ['open', 'Default', 'data:text/html;'], ['cli', 19990, 'execute'],
  ]);
});

test('prepare fails clearly, and stops only the relay it started', async () => {
  const missing = setup();
  missing.ops.copyState = () => ({ ok: false, text: 'has not loaded ~/browser-control-profiles/work yet', warnings: [] });
  const a = await new Runner({ cfg: missing.cfg, ops: missing.ops }).prepare(missing.work, { session: 's' });
  assert.equal(a.ok, false);
  assert.equal(a.error, 'Default has not loaded ~/browser-control-profiles/work yet');
  assert.deepEqual(missing.log, [], 'nothing was started');

  const refused = setup({ relayUp: true, windowOpen: true, failing: { 'session new': 'SessionError: Session ids must use lowercase letters, numbers, and dashes\n    at Cli.sessionNew (file:///x/cli.js:1:1)' } });
  const b = await refused.runner.prepare(refused.work, { session: 's' });
  assert.equal(b.ok, false);
  assert.match(b.error, /could not create the session s: SessionError: Session ids must use lowercase/);
  assert.equal(refused.log.some((l) => l[0] === 'stop'), false, 'a relay it found running stays up');

  const silent = setup({ connectAfter: Infinity });
  const c = await silent.runner.prepare(silent.work, { session: 's' });
  assert.equal(c.ok, false);
  assert.match(c.error, /did not connect to port 19990 within 0\.1 s/);
  assert.deepEqual(silent.log.at(-1), ['stop', 19990], 'the relay it started is stopped again');

  const broken = setup({ failing: { 'execute --session': 'Target closed' } });
  const d = await broken.runner.prepare(broken.work, { session: 's' });
  assert.equal(d.ok, false);
  assert.match(d.error, /the first tab of s did not open: Target closed/);
  assert.deepEqual(broken.log.slice(-2), [['cli', 19990, 'session', 'delete', 's'], ['stop', 19990]], 'its session is deleted and its relay stopped');
});
