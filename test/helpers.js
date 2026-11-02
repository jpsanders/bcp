import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { withDefaults } from '../src/config.js';

// Resolved, because macOS reaches its temp folder through a symlink (/var to
// /private/var) and the code under test resolves symlinks.
export const tmp = (prefix = 'bcp-') => realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));

// The public key in Browser Control's extension manifest, and the extension id
// Chromium derives from it (the relay's "stable unpacked" origin).
export const UPSTREAM_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzTg+VNnMmpavX6z5WKu4FYh9xa2J+jjxTS/EmxYdgbzh33amUxawAVWV3p5NF58Y9yZxBEv11M1BUPWVVdAYyTsHYj70+xpCXGCnljQF6igo8hKBPoNNvg/+/IyI+FPbj34Mv2P1u+ZUCR9cAhFcqmD5mSvMbB8zFVSa+Rgknwwz5Uegu1bKzpI5Z9nO2EI6KOgjeJV/YEjl6NecC743FlCVztFZ1NIiJKl7DFmTSUa1/Piu7WHucBNfNDnoc6A9tmLTTLYnOH+KinXV3MsakWGNhGQTPCBRGLlGQ3SAa6HN7SPzZIkqHABBdMbf/1nO9Vj7dWAKIhX3Zud3GHxObwIDAQAB';
export const UPSTREAM_ID = 'eibhgjafffkigblngnhafgbcipofaeon';

const BACKGROUND = 'var relayHost = "127.0.0.1";\nvar relayPort = 19989;\nconnect();\n';

// A stand in for the installed Browser Control package and its extension build.
export function fakePackage(dir, { version = '0.0.25', packageVersion = '0.8.4', background = BACKGROUND } = {}) {
  const root = path.join(dir, 'lib', 'node_modules', '@opencode-ai', 'browser-control');
  const ext = path.join(root, 'extension', 'dist');
  mkdirSync(path.join(ext, 'icons'), { recursive: true });
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@opencode-ai/browser-control', version: packageVersion }));
  writeFileSync(path.join(root, 'dist', 'cli.js'), '#!/usr/bin/env node\n', { mode: 0o755 });
  writeFileSync(path.join(ext, 'background.js'), background);
  writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Browser Control', version, key: UPSTREAM_KEY }));
  writeFileSync(path.join(ext, 'icons', 'icon-16.png'), 'png');
  return { root, ext };
}

// A browser user data folder: Local State with the profiles' display names.
export function fakeBrowser(userDataDir, profiles = { Default: 'Work', 'Profile 2': 'Side Project', 'Profile 1': 'Personal' }, { open = [] } = {}) {
  mkdirSync(userDataDir, { recursive: true });
  const cache = Object.fromEntries(Object.entries(profiles).map(([d, name]) => [d, { name }]));
  writeFileSync(path.join(userDataDir, 'Local State'), JSON.stringify({ profile: { info_cache: cache, last_active_profiles: open } }));
  return userDataDir;
}

export function prefs(userDataDir, profileDir, settings, file = 'Preferences') {
  mkdirSync(path.join(userDataDir, profileDir), { recursive: true });
  writeFileSync(path.join(userDataDir, profileDir, file), JSON.stringify({ extensions: { settings } }));
}

export function cfgFor(dir, extra = {}) {
  return withDefaults({
    browser: '/bin/true',
    userDataDir: path.join(dir, 'chromium'),
    copiesDir: path.join(dir, 'copies'),
    profiles: { Default: { name: 'work', port: 19990 }, 'Profile 1': { name: 'personal', port: 19991 } },
    connectTimeoutSec: 0.1,
    openGraceSec: 0.1,
    ...extra,
  });
}

// Ports nothing listens on, distinct and in order: taken from servers that are
// all open at once and then closed again.
export async function freePorts(n) {
  const servers = [];
  for (let i = 0; i < n; i++) {
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
  }
  const ports = servers.map((s) => s.address().port).sort((a, b) => a - b);
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  return ports;
}
