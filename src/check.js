import { copyState, profileOpen } from './browsers.js';
import { expandHome } from './paths.js';
import { lastLine, relayStatus, runCli, stopRelay } from './relay.js';
import { openWindow, wakeUrl } from './window.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Brings one profile to the point where a Browser Control session has a live
// tab in it, and back. Every outside effect goes through ops, so tests can
// stand in for the relay and the browser.
export class Runner {
  constructor({ cfg, extensionId = null, ops = {} }) {
    this.cfg = cfg;
    this.status = ops.status || ((port) => relayStatus(port));
    this.cli = ops.cli || ((port, args, o) => runCli(cfg, port, args, o));
    this.open = ops.open || ((p, url) => openWindow(cfg, p, url));
    this.stop = ops.stop || ((port) => stopRelay(port));
    this.copyState = ops.copyState || ((p) => copyState(cfg, p, { extensionId }));
    this.isOpen = ops.isOpen || ((p) => profileOpen(expandHome(cfg.userDataDir), p.dir));
    this.sleep = ops.sleep || sleep;
  }

  async waitConnected(port, ms) {
    const until = Date.now() + ms;
    let st = await this.status(port);
    while (!st.connected && Date.now() < until) {
      await this.sleep(1000);
      st = await this.status(port);
    }
    return st;
  }

  // The profile has its own copy loaded, its relay is up, its extension is
  // connected, and the session has its first tab.
  async prepare(p, { session }) {
    const copy = this.copyState(p);
    if (!copy.ok) return { ok: false, opened: false, startedRelay: false, error: `${p.dir} ${copy.text}` };
    let startedRelay = false;
    let opened = false;
    const fail = async (error, open = null) => {
      await this.cleanup(p, { session: open, stopRelay: startedRelay });
      return { ok: false, opened, startedRelay, error };
    };
    let st = await this.status(p.port);
    if (!st.relay) {
      // status never starts a relay; any command that needs one does.
      await this.cli(p.port, ['session', 'list', '--json'], { timeoutMs: 30_000 });
      const until = Date.now() + 15_000;
      for (st = await this.status(p.port); !st.relay && Date.now() < until; st = await this.status(p.port)) await this.sleep(250);
      if (!st.relay) return { ok: false, opened, startedRelay, error: `the relay on port ${p.port} did not start` };
      startedRelay = true;
    }
    // In an open profile the extension reconnects by itself, every second while
    // its worker is awake and on a 30 second alarm while it sleeps; a new
    // window would not wake it sooner, so wait for that first.
    if (!st.connected && this.isOpen(p)) st = await this.waitConnected(p.port, this.cfg.openGraceSec * 1000);
    if (!st.connected) {
      await this.open(p, wakeUrl(p, this.cfg.wakeCloseSec));
      opened = true;
      st = await this.waitConnected(p.port, this.cfg.connectTimeoutSec * 1000);
      if (!st.connected) {
        const why = st.rejected ? ', and the relay turned another browser away' : '';
        return fail(`the extension in ${p.dir} did not connect to port ${p.port} within ${this.cfg.connectTimeoutSec} s${why}`);
      }
    }
    const made = await this.cli(p.port, ['session', 'new', session], { timeoutMs: 30_000 });
    if (!made.ok) return fail(`could not create the session ${session}: ${lastLine(made)}`);
    const firstTab = () => this.cli(p.port, ['execute', '--session', session, 'return page.url()'], { timeoutMs: 60_000 });
    let tab = await firstTab();
    // A connected extension in a profile with no window cannot open a tab, and
    // Chromium answers "No current window": open one and try again.
    if (!tab.ok && !opened && /No current window/i.test(`${tab.stdout || ''}\n${tab.stderr || ''}`)) {
      await this.open(p, wakeUrl(p, this.cfg.wakeCloseSec));
      opened = true;
      const until = Date.now() + this.cfg.connectTimeoutSec * 1000;
      do {
        await this.sleep(2000);
        tab = await firstTab();
      } while (!tab.ok && Date.now() < until);
    }
    if (!tab.ok) return fail(`the first tab of ${session} did not open: ${lastLine(tab)}`, session);
    return { ok: true, opened, startedRelay };
  }

  // Deleting a session closes every tab it opened. The relay is stopped only
  // when prepare started it.
  async cleanup(p, { session = null, stopRelay = false } = {}) {
    let deleted = true;
    let error = '';
    if (session) {
      const del = await this.cli(p.port, ['session', 'delete', session], { timeoutMs: 30_000 });
      deleted = del.ok;
      if (!del.ok) error = lastLine(del);
    }
    const stop = stopRelay ? await this.stop(p.port) : { stopped: false };
    return { ok: deleted, deleted, stopped: Boolean(stop.stopped), error };
  }
}
