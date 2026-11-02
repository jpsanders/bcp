import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  WEB_STORE_ID, copyState, detectBrowsers, isSnapBrowser, profileOpen, readProfiles, snapProblem,
} from '../src/browsers.js';
import { profileList } from '../src/config.js';
import { cfgFor, fakeBrowser, prefs, tmp, UPSTREAM_ID } from './helpers.js';

test('profiles are read from Local State, Default first, then by number', () => {
  const dir = tmp();
  const userDataDir = fakeBrowser(path.join(dir, 'chromium'), { 'Profile 10': 'Ten', 'Profile 2': 'Two', Default: 'Main', 'Profile 1': 'One' }, { open: ['Profile 2'] });
  assert.deepEqual(readProfiles(userDataDir).map((p) => `${p.dir}=${p.displayName}`), ['Default=Main', 'Profile 1=One', 'Profile 2=Two', 'Profile 10=Ten']);
  assert.equal(profileOpen(userDataDir, 'Profile 2'), true);
  assert.equal(profileOpen(userDataDir, 'Default'), false);
  assert.equal(profileOpen(path.join(dir, 'missing'), 'Default'), false);
});

test('browsers are detected by their Local State file', () => {
  const home = tmp();
  fakeBrowser(path.join(home, 'snap', 'chromium', 'common', 'chromium'));
  fakeBrowser(path.join(home, '.config', 'google-chrome'));
  assert.deepEqual(detectBrowsers({ home, platform: 'linux' }).map((b) => b.id), ['chromium-snap', 'chrome']);
  assert.deepEqual(detectBrowsers({ home, platform: 'win32' }), []);
});

test('reads which copy a profile has loaded, from Preferences or Secure Preferences', () => {
  const dir = tmp();
  const cfg = cfgFor(dir);
  const [work] = profileList(cfg);
  const ud = cfg.userDataDir;
  const copies = path.join(dir, 'copies');
  const opts = { extensionId: UPSTREAM_ID };

  assert.match(copyState(cfg, work, opts).text, /cannot read Default\/Preferences \(ENOENT\)/);
  prefs(ud, 'Default', { abc: { path: '/opt/other/extension' } });
  assert.match(copyState(cfg, work, opts).text, /has not loaded .*copies\/work yet/);
  prefs(ud, 'Default', { [UPSTREAM_ID]: { path: path.join(copies, 'personal') } });
  assert.match(copyState(cfg, work, opts).text, /has .*copies\/personal loaded instead of .*copies\/work/);
  prefs(ud, 'Default', { [UPSTREAM_ID]: { path: '/usr/lib/node_modules/@opencode-ai/browser-control/extension/dist' } });
  assert.match(copyState(cfg, work, opts).text, /has \/usr\/lib\/node_modules\/.*loaded instead of/);
  prefs(ud, 'Default', { [UPSTREAM_ID]: { path: path.join(copies, 'work') }, other: { path: path.join(copies, 'old') } });
  assert.match(copyState(cfg, work, opts).text, /also has .*copies\/old loaded: remove it/);
  prefs(ud, 'Default', { [UPSTREAM_ID]: { path: path.join(copies, 'work'), disable_reasons: [1] } });
  assert.match(copyState(cfg, work, opts).text, /loaded but switched off/);
  prefs(ud, 'Default', { [UPSTREAM_ID]: { path: path.join(copies, 'work'), state: 0 } });
  assert.match(copyState(cfg, work, opts).text, /switched off/);
  prefs(ud, 'Default', { [UPSTREAM_ID]: { path: path.join(copies, 'work') } });
  const ok = copyState(cfg, work, opts);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.warnings, []);

  prefs(ud, 'Default', { [WEB_STORE_ID]: { path: `${WEB_STORE_ID}/0.8.4_0` } });
  prefs(ud, 'Default', { [UPSTREAM_ID]: { path: path.join(copies, 'work') } }, 'Secure Preferences');
  const both = copyState(cfg, work, opts);
  assert.equal(both.ok, true, 'Secure Preferences counts too');
  assert.match(both.warnings[0], /Chrome Web Store build of Browser Control switched on; it connects to port 19989/);
});

test('without the extension id, the loaded copy is still found by its folder', () => {
  const dir = tmp();
  const cfg = cfgFor(dir);
  const [work] = profileList(cfg);
  prefs(cfg.userDataDir, 'Default', { someid: { path: path.join(dir, 'copies', 'work') } });
  assert.equal(copyState(cfg, work).ok, true);
});

test('the snap rule: no top folder in home that starts with a dot or "s", nothing outside home', () => {
  const home = '/home/u';
  const ud = '/home/u/snap/chromium/common/chromium';
  assert.equal(isSnapBrowser(ud, home), true);
  assert.equal(isSnapBrowser('/home/u/.config/chromium', home), false);
  assert.equal(snapProblem('/home/u/browser-control-profiles', ud, home), null);
  assert.equal(snapProblem('/home/u/work/.hidden/copies', ud, home), null, 'only the top folder matters');
  assert.match(snapProblem('/home/u/.local/share/copies', ud, home), /under ~\/\.local, and a snap browser cannot read folders in your home whose name starts with a dot/);
  assert.match(snapProblem('/home/u/scratch/copies', ud, home), /under ~\/scratch, .*starts with "s"/);
  assert.match(snapProblem('/tmp/copies', ud, home), /outside your home folder/);
  assert.equal(snapProblem('/home/u/snap/chromium/common/copies', ud, home), null, 'the snap reads its own folder');
  assert.match(snapProblem('/home/u/snap/other/copies', ud, home), /starts with "s"/);
  assert.match(snapProblem('/home/u/.x', '/home/u/.config/chromium', home), /starts with a dot/, 'a browser that is not a snap has no own snap folder');
});
