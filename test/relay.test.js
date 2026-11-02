import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { lastLine, relayStatus, runProcess, startRelay } from '../src/relay.js';

test('relay status reads the extension endpoint and calls a closed port down', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/extension/status' ? { connected: true, version: '0.0.25', rejectedConnections: 1 } : {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  assert.deepEqual(await relayStatus(port), { relay: true, connected: true, version: '0.0.25', rejected: 1 });
  await new Promise((resolve) => server.close(resolve));
  const down = await relayStatus(port);
  assert.equal(down.relay, false);
  assert.equal(down.connected, false);
});

test('a command runs with its output and exit code', async () => {
  const r = await runProcess(process.execPath, ['-e', 'console.log("out"); console.error("err"); process.exit(3)']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 3);
  assert.equal(r.stdout.trim(), 'out');
  assert.equal(r.stderr.trim(), 'err');
  const missing = await runProcess('/nonexistent/browser-control', []);
  assert.equal(missing.ok, false);
  assert.match(missing.stderr, /ENOENT/);
});

test('a command that leaves a child holding its output open still returns once it exits', async () => {
  const started = Date.now();
  const r = await runProcess('sh', ['-c', 'sleep 5 & echo started']);
  assert.equal(r.ok, true);
  assert.equal(r.stdout.trim(), 'started');
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

test('a command that runs too long is stopped', async () => {
  const r = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.match(r.stderr, /timed out after 0 s/);
});

test('an error report keeps the message, not the stack frame', () => {
  assert.equal(lastLine({ stderr: 'SessionError: bad id\n    at Cli.sessionNew (file:///x/cli.js:1:1)\n' }), 'SessionError: bad id');
  assert.equal(lastLine({ stderr: '', stdout: '', exitCode: 4 }), 'exit 4');
});

test('start leaves a running relay alone and waits for a new one to come up', async () => {
  const calls = [];
  const up = await startRelay({}, 19990, { status: async () => ({ relay: true }), cli: async () => calls.push('cli') });
  assert.deepEqual(up, { ok: true, started: false });
  assert.deepEqual(calls, []);

  let polls = 0;
  const started = await startRelay({}, 19990, {
    status: async () => ({ relay: calls.length > 0 && ++polls > 2 }),
    cli: async (cfg, port, args) => { calls.push(args.join(' ')); return { ok: true }; },
    sleepFn: async () => {},
  });
  assert.deepEqual(started, { ok: true, started: true });
  assert.deepEqual(calls, ['session list --json']);

  const never = await startRelay({}, 19990, {
    status: async () => ({ relay: false }),
    cli: async () => ({ ok: false, stderr: 'Error: node is too old\n    at main' }),
    sleepFn: async () => {},
    waitMs: 10,
  });
  assert.equal(never.ok, false);
  assert.equal(never.error, 'the relay on port 19990 did not start: Error: node is too old');
});
