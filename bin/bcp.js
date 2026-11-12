#!/usr/bin/env node
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as commands from '../src/commands.js';
import { UsageError, defaultConfigPath, expandHome } from '../src/paths.js';

const HELP = `bcp (Browser Control Profiles): drive several Chromium profiles at once with Browser Control.

Each profile gets its own copy of the Browser Control extension, set to its own
relay port, so one relay per profile can run side by side.

Usage:
  bcp init [profile...]              write a config from the browser's profiles
      [--browser <id>] [--user-data-dir <dir>] [--copies-dir <dir>] [--first-port <port>] [--force]
  bcp [list] [--json]                each profile: its copy, what it has loaded, its relay
  bcp sync [--source <dir>]          write one extension copy per profile
  bcp open <profile> [--url <url>]   open a window in a profile (chrome://extensions by default)
  bcp start <profile>                start a profile's relay
  bcp stop <profile> | --all         stop a profile's relay
  bcp check [profile...]             prove a session can open and close a tab in each profile
  bcp mcp <profile> | --all [--json] print the MCP server entry for a profile, or for all of them
  bcp run <profile> -- <command> [args...]
                                     run a command against a profile's relay
  bcp guide                          the full manual, for people and agents
  bcp man [--install | --raw]        the manual as a man page; --install makes \`man bcp\` work

A profile is named by its name in the config ("work"), its folder ("Profile 3")
or its number ("3").

Options:
  --config <file>   the config file (default ~/.config/browser-control-profiles/config.json,
                    or $BROWSER_CONTROL_PROFILES_CONFIG)
  -h, --help        this help
  -v, --version     the version

bcp is also installed as browser-control-profiles, for systems where SQL Server's
own bcp command comes first on the PATH.
`;

const VALUE_FLAGS = new Set(['config', 'browser', 'user-data-dir', 'copies-dir', 'first-port', 'url', 'source']);
const BOOLEAN_FLAGS = new Set(['json', 'force', 'all', 'help', 'version', 'install', 'raw']);
const SHORT = { h: 'help', v: 'version' };

export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  let rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      rest = argv.slice(i + 1);
      break;
    }
    if (/^-[^-]/.test(a)) {
      if (!SHORT[a.slice(1)]) throw new UsageError(`unknown option ${a}; see --help`);
      flags[SHORT[a.slice(1)]] = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (BOOLEAN_FLAGS.has(name)) {
        if (eq !== -1) throw new UsageError(`--${name} takes no value`);
        flags[name] = true;
      } else if (VALUE_FLAGS.has(name)) {
        const value = eq === -1 ? argv[++i] : a.slice(eq + 1);
        if (value === undefined || value === '') throw new UsageError(`--${name} needs a value`);
        flags[name] = value;
      } else {
        throw new UsageError(`unknown option ${a}; see --help`);
      }
      continue;
    }
    positionals.push(a);
  }
  return { flags, positionals, rest };
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function guide() {
  return readFileSync(path.join(ROOT, 'docs', 'MANUAL.md'), 'utf-8').trimEnd();
}

function man({ flags, env, home }) {
  const page = path.join(ROOT, 'man', 'bcp.1');
  if (flags.install) {
    const dir = path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'man', 'man1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'bcp.1'), readFileSync(page));
    return `installed ${path.join(dir, 'bcp.1')}; open it with: man bcp`;
  }
  if (!flags.raw && process.stdout.isTTY && spawnSync('man', ['-l', page], { stdio: 'inherit' }).status === 0) {
    return { text: null, code: 0 };
  }
  return readFileSync(page, 'utf-8').trimEnd();
}

const COMMANDS = {
  guide,
  man,
  init: commands.init,
  list: commands.list,
  sync: commands.sync,
  open: commands.open,
  start: commands.start,
  stop: commands.stop,
  check: commands.check,
  mcp: commands.mcp,
  run: commands.run,
};

export async function main(argv, { env = process.env, home = os.homedir() } = {}) {
  const { flags, positionals, rest } = parseArgs(argv);
  if (flags.help) return { text: HELP.trimEnd(), code: 0 };
  if (flags.version) {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    return { text: pkg.version, code: 0 };
  }
  const name = positionals.length ? positionals[0] : 'list';
  const command = COMMANDS[name];
  if (!command) throw new UsageError(`unknown command "${name}"; see --help`);
  const configPath = flags.config ? path.resolve(expandHome(flags.config, home)) : defaultConfigPath(env, home);
  const out = await command({ configPath, flags, positionals: positionals.slice(1), rest, env, home });
  return typeof out === 'string' ? { text: out, code: 0 } : out;
}

function invokedDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then(
    ({ text, code }) => {
      if (text) process.stdout.write(`${text}\n`);
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`bcp: ${e instanceof UsageError ? e.message : (e && e.stack) || e}\n`);
      process.exitCode = 1;
    },
  );
}
