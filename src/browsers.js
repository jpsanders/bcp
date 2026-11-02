import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandHome, isInside, tilde } from './paths.js';

// Where Chromium family browsers keep their profiles. Linux is tested (snap
// Chromium on Ubuntu); the macOS entries follow each vendor's documented paths.
const KNOWN = {
  linux: [
    { id: 'chromium-snap', label: 'Chromium (snap)', userDataDir: '~/snap/chromium/common/chromium', browser: '/snap/bin/chromium' },
    { id: 'chromium', label: 'Chromium', userDataDir: '~/.config/chromium', browser: 'chromium' },
    { id: 'chrome', label: 'Google Chrome', userDataDir: '~/.config/google-chrome', browser: 'google-chrome' },
    { id: 'brave', label: 'Brave', userDataDir: '~/.config/BraveSoftware/Brave-Browser', browser: 'brave-browser' },
    { id: 'edge', label: 'Microsoft Edge', userDataDir: '~/.config/microsoft-edge', browser: 'microsoft-edge' },
    { id: 'vivaldi', label: 'Vivaldi', userDataDir: '~/.config/vivaldi', browser: 'vivaldi' },
  ],
  darwin: [
    { id: 'chrome', label: 'Google Chrome', userDataDir: '~/Library/Application Support/Google/Chrome', browser: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    { id: 'chromium', label: 'Chromium', userDataDir: '~/Library/Application Support/Chromium', browser: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
    { id: 'brave', label: 'Brave', userDataDir: '~/Library/Application Support/BraveSoftware/Brave-Browser', browser: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
    { id: 'edge', label: 'Microsoft Edge', userDataDir: '~/Library/Application Support/Microsoft Edge', browser: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
  ],
};

// The id of the Chrome Web Store build of Browser Control. That build always
// connects to port 19989 and cannot be patched.
export const WEB_STORE_ID = 'gmjpoplfomnnjipeiojccjbpjlodkjhn';

export function knownBrowsers({ home = os.homedir(), platform = process.platform } = {}) {
  return (KNOWN[platform] || []).map((b) => ({ ...b, userDataDir: expandHome(b.userDataDir, home) }));
}

export function detectBrowsers(opts = {}) {
  return knownBrowsers(opts).filter((b) => existsSync(path.join(b.userDataDir, 'Local State')));
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function profileNumber(dir) {
  if (dir === 'Default') return -1;
  const m = /^Profile (\d+)$/.exec(dir);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

// Profile folders with their display names, from the browser's Local State.
export function readProfiles(userDataDir) {
  const state = readJson(path.join(userDataDir, 'Local State'));
  const cache = (state.profile && state.profile.info_cache) || {};
  return Object.entries(cache)
    .map(([dir, info]) => ({ dir, displayName: (info && info.name) || dir }))
    .sort((a, b) => profileNumber(a.dir) - profileNumber(b.dir) || a.dir.localeCompare(b.dir));
}

// Whether a profile has a window open. Chromium writes this list a few seconds
// after a change, so a stale answer costs one wait or one window, never a run.
export function profileOpen(userDataDir, profileDir) {
  try {
    const state = readJson(path.join(userDataDir, 'Local State'));
    return ((state.profile && state.profile.last_active_profiles) || []).includes(profileDir);
  } catch {
    return false;
  }
}

// A profile's extension entries, merged from Preferences and Secure Preferences.
export function extensionEntries(userDataDir, profileDir) {
  const merged = new Map();
  const errors = [];
  let read = 0;
  for (const file of ['Preferences', 'Secure Preferences']) {
    let prefs;
    try {
      prefs = readJson(path.join(userDataDir, profileDir, file));
      read++;
    } catch (e) {
      errors.push(e.code || e.message);
      continue;
    }
    const settings = (prefs.extensions && prefs.extensions.settings) || {};
    for (const [id, s] of Object.entries(settings)) {
      if (s && typeof s === 'object') merged.set(id, { ...(merged.get(id) || {}), ...s, id });
    }
  }
  if (!read) return { error: `cannot read ${profileDir}/Preferences (${errors[0]})`, entries: [] };
  return { entries: [...merged.values()] };
}

export function isEnabled(entry) {
  const reasons = Array.isArray(entry.disable_reasons) ? entry.disable_reasons.length : Number(entry.disable_reasons || 0);
  return reasons === 0 && entry.state !== 0;
}

// Whether a profile has loaded its own copy and no other Browser Control build.
// Every copy keeps the manifest key, so all copies share one extension id and a
// profile can hold only one of them: the entry's path says which.
export function copyState(cfg, profile, { extensionId = null } = {}) {
  const userDataDir = expandHome(cfg.userDataDir);
  const copiesDir = path.resolve(expandHome(cfg.copiesDir));
  const { error, entries } = extensionEntries(userDataDir, profile.dir);
  if (error) return { ok: false, text: error, warnings: [] };
  const where = (e) => (e.path ? path.resolve(userDataDir, profile.dir, 'Extensions', e.path) : null);
  const warnings = [];
  if (entries.some((e) => e.id === WEB_STORE_ID && isEnabled(e))) {
    warnings.push(`${profile.dir} also has the Chrome Web Store build of Browser Control switched on; it connects to port 19989, so switch it off there`);
  }
  const mine = entries.find((e) => where(e) === profile.copyDir);
  const others = entries.filter((e) => e !== mine && where(e) && isEnabled(e)
    && ((extensionId && e.id === extensionId) || isInside(where(e), copiesDir)));
  if (!mine && others.length) return { ok: false, text: `has ${tilde(where(others[0]))} loaded instead of ${tilde(profile.copyDir)}`, warnings };
  if (!mine) return { ok: false, text: `has not loaded ${tilde(profile.copyDir)} yet`, warnings };
  if (others.length) return { ok: false, text: `also has ${others.map((e) => tilde(where(e))).join(', ')} loaded: remove it at chrome://extensions`, warnings };
  if (!isEnabled(mine)) return { ok: false, text: `has ${tilde(profile.copyDir)} loaded but switched off`, warnings };
  return { ok: true, text: `has ${tilde(profile.copyDir)} loaded`, warnings };
}

export function isSnapBrowser(userDataDir, home = os.homedir()) {
  return isInside(path.resolve(userDataDir), path.join(home, 'snap'));
}

// A snap browser reads your home folder only below a top folder whose name
// starts with neither a dot nor "s" (AppArmor: owner @{HOME}/[^s.]**), plus
// its own folder under ~/snap. Returns why dir is unreadable, or null.
export function snapProblem(dir, userDataDir, home = os.homedir()) {
  const target = path.resolve(dir);
  if (isSnapBrowser(userDataDir, home)) {
    const ownSnap = path.join(home, 'snap', path.relative(path.join(home, 'snap'), path.resolve(userDataDir)).split(path.sep)[0]);
    if (isInside(target, ownSnap)) return null;
  }
  if (!isInside(target, home)) return `${tilde(target)} is outside your home folder, where a snap browser cannot read it`;
  const top = path.relative(home, target).split(path.sep)[0];
  if (top.startsWith('.')) return `${tilde(target)} is under ~/${top}, and a snap browser cannot read folders in your home whose name starts with a dot`;
  if (top.startsWith('s')) return `${tilde(target)} is under ~/${top}, and a snap browser cannot read top folders in your home whose name starts with "s"`;
  return null;
}
