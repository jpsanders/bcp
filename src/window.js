import { spawn } from 'node:child_process';
import { UsageError, expandHome } from './paths.js';
import { runProcess } from './relay.js';

// Cron and other services start without the desktop session's variables,
// which the browser needs to open a window; on Linux the user manager has them.
export async function guiEnv(env = process.env) {
  const out = { ...env };
  if (process.platform !== 'linux' || out.DISPLAY || out.WAYLAND_DISPLAY) return out;
  const r = await runProcess('systemctl', ['--user', 'show-environment'], { env: out, timeoutMs: 5000 });
  for (const line of String(r.stdout || '').split('\n')) {
    const m = /^(DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|XDG_RUNTIME_DIR|XDG_SESSION_TYPE|XDG_CURRENT_DESKTOP|DBUS_SESSION_BUS_ADDRESS)=(.*)$/.exec(line);
    if (m && !out[m[1]]) out[m[1]] = m[2];
  }
  return out;
}

// A running browser hands the command over to itself and opens a window in
// that profile; a closed one starts with it.
export async function openWindow(cfg, profile, url) {
  if (!cfg.browser) throw new UsageError('the config has no "browser" command to open windows with; set it to the browser\'s executable');
  const env = await guiEnv();
  const child = spawn(expandHome(cfg.browser), [`--profile-directory=${profile.dir}`, url], { env, detached: true, stdio: 'ignore' });
  child.on('error', () => { /* reported by the connection wait instead */ });
  child.unref();
}

// A page with a single history entry may close itself, so the window it opens
// goes away once the check's own tab is done with it.
export function wakeUrl(profile, closeSec) {
  const html = '<!doctype html><meta charset="utf-8"><title>Browser Control</title>'
    + `<body style="font:16px system-ui;padding:2em">Waking Browser Control in ${profile.dir} (port ${profile.port}). This tab closes itself.</body>`
    + `<script>setTimeout(() => window.close(), ${Math.round(closeSec * 1000)})</script>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
