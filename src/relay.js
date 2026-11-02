import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expandHome } from './paths.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The relay's own report: is it up, and is an extension connected to it.
export async function relayStatus(port, { timeoutMs = 2000, fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/extension/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { relay: true, connected: false, error: `HTTP ${res.status}` };
    const j = await res.json();
    return { relay: true, connected: Boolean(j.connected), version: j.version || null, rejected: j.rejectedConnections || 0 };
  } catch (e) {
    return { relay: false, connected: false, error: (e.cause && e.cause.code) || e.name || e.message };
  }
}

// Runs a command and collects its output. A detached child that keeps the
// pipes open (a relay started on the side) must not hold the result back, so
// the result comes shortly after the process exits even if its pipes do not close.
export function runProcess(cmd, args, { env = process.env, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    let afterExit = null;
    let child;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(afterExit);
      if (child) {
        child.stdout.destroy();
        child.stderr.destroy();
      }
      resolve({ stdout, stderr, ...r });
    };
    try {
      child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, exitCode: null, stdout: '', stderr: e.message });
      return;
    }
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ ok: false, exitCode: null, stderr: `${stderr}timed out after ${Math.round(timeoutMs / 1000)} s` });
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish({ ok: false, exitCode: null, stderr: `${stderr}${e.message}` }));
    child.on('exit', (code) => { afterExit = setTimeout(() => finish({ ok: code === 0, exitCode: code }), 500); });
    child.on('close', (code) => finish({ ok: code === 0, exitCode: code }));
  });
}

export function runCli(cfg, port, args, { timeoutMs = 60_000, env = process.env } = {}) {
  return runProcess(expandHome(cfg.cli), args, { env: { ...env, BROWSER_CONTROL_PORT: String(port) }, timeoutMs });
}

// The error's message, not the last frame of its stack trace.
export function lastLine(r) {
  const lines = String(r.stderr || r.stdout || '').trim().split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.filter((l) => !/^at /.test(l)).pop() || lines.pop() || `exit ${r.exitCode}`;
}

// Browser Control starts its relay on the first command that needs one;
// status never starts it, and session list does.
export async function startRelay(cfg, port, { status = relayStatus, cli = runCli, sleepFn = sleep, waitMs = 15_000 } = {}) {
  let st = await status(port);
  if (st.relay) return { ok: true, started: false };
  const r = await cli(cfg, port, ['session', 'list', '--json'], { timeoutMs: 30_000 });
  const until = Date.now() + waitMs;
  for (st = await status(port); !st.relay && Date.now() < until; st = await status(port)) await sleepFn(250);
  return st.relay ? { ok: true, started: true } : { ok: false, started: false, error: `the relay on port ${port} did not start${r.ok ? '' : `: ${lastLine(r)}`}` };
}

function listeningPid(port) {
  try {
    const out = execFileSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /pid=(\d+)/.exec(out);
    if (m) return Number(m[1]);
  } catch {
    // no ss here; try lsof
  }
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pid = Number(out.trim().split('\n')[0]);
    if (pid) return pid;
  } catch {
    // nothing listening, or no lsof
  }
  return null;
}

function commandLine(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replace(/\0/g, ' ').trim();
  } catch {
    // not Linux
  }
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// The pid listening on a port, and only when it is a Browser Control relay.
export function relayPid(port) {
  const pid = listeningPid(port);
  if (!pid) return null;
  const cmd = commandLine(pid);
  return /browser-control/.test(cmd) && /cli\.js/.test(cmd) ? pid : null;
}

export async function stopRelay(port, { waitMs = 5000 } = {}) {
  const pid = relayPid(port);
  if (!pid) return { stopped: false, why: 'no Browser Control relay is listening there' };
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    return { stopped: false, why: e.code || e.message };
  }
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    try {
      process.kill(pid, 0);
    } catch {
      return { stopped: true, pid };
    }
    await sleep(200);
  }
  return { stopped: false, why: `pid ${pid} still running after ${waitMs / 1000} s` };
}
