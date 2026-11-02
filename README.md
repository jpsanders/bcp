# bcp

[![test](https://github.com/jpsanders/bcp/actions/workflows/test.yml/badge.svg)](https://github.com/jpsanders/bcp/actions/workflows/test.yml)
[![version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjpsanders%2Fbcp%2Fmain%2Fpackage.json&query=%24.version&label=version&color=blue)](https://github.com/jpsanders/bcp/releases/latest)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)
[![node: 20 or later](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen)](package.json)

Browser Control Profiles: drive several Chromium profiles at once with [Browser Control](https://github.com/anomalyco/browser-control).

Browser Control lets an agent drive your real, logged in browser through a small extension and a local relay. One relay serves one profile: the extension always connects to port 19989, and the relay turns a second profile's extension away. bcp gives each profile its own copy of the extension, set to its own port, and its own relay. Agents can then work in several profiles side by side, each with its own logins.

```
profile "Default"    ->  ~/browser-control-profiles/work      ->  relay on 19990  <-  MCP server, BROWSER_CONTROL_PORT=19990
profile "Profile 1"  ->  ~/browser-control-profiles/personal  ->  relay on 19991  <-  MCP server, BROWSER_CONTROL_PORT=19991
```

## How it works

- `bcp sync` copies the extension build out of your installed Browser Control package, once per profile, and changes the one line that sets the relay port. Each copy's name at chrome://extensions says which profile and port it belongs to. The manifest key stays, so every copy keeps the extension id the relay accepts.
- The relay and the MCP server already read `BROWSER_CONTROL_PORT`, so nothing else is patched.
- `bcp check` proves a profile works end to end: it has its own copy loaded, its relay is up, the extension connects, and a session can open and close a tab.

## Requirements

- Browser Control, installed with `npm install -g @opencode-ai/browser-control` (it needs Node 22.19 or later).
- Node 20 or later for bcp. It has no dependencies.
- A Chromium family browser (Chromium, Chrome, Brave, Edge, Vivaldi). The copies are loaded unpacked; the Chrome Web Store build of Browser Control cannot be patched.
- Linux or macOS. Tested on Ubuntu, including a live run with Browser Control 0.8.4 in which two Chromium browsers, each with its own copy and relay, were connected and checked at the same time. The same patch works on 0.7.0. The macOS browser paths follow each vendor's documented locations but are not tested yet.

## Install

```sh
npm install -g github:jpsanders/bcp          # the latest
npm install -g github:jpsanders/bcp#1.0.0    # a release
```

This installs the command `bcp`, and the same command under its long name, `browser-control-profiles`, for systems where SQL Server's own `bcp` comes first on the PATH.

## Quick start

```sh
bcp init        # one entry per browser profile, ports from 19990
bcp sync        # one copy of the extension per profile
bcp open work   # opens chrome://extensions in that profile
```

In each profile, switch on Developer mode, choose Load unpacked and pick that profile's folder under `~/browser-control-profiles`. Then:

```sh
bcp check       # opens and closes a tab in every profile
bcp             # what each profile has loaded, and its relay
```

Give each agent the MCP server for the profile it should use. `bcp mcp work` prints the entry; for Claude Code it is:

```sh
claude mcp add browser-control-work -e BROWSER_CONTROL_PORT=19990 -- browser-control-mcp
```

Or run any Browser Control command against a profile:

```sh
bcp run work -- browser-control status
```

## Commands

| Command | What it does |
| --- | --- |
| `bcp init [profile...]` | Writes a config from the browser's profiles: all of them, or the ones named. Options: `--browser <id>`, `--user-data-dir <dir>`, `--copies-dir <dir>`, `--first-port <port>`, `--force`. |
| `bcp list` (the default) | Each profile: its copy, what the profile has loaded, and its relay. `--json` for scripts. |
| `bcp sync` | Writes one copy of the extension per profile. `--source <dir>` copies from another build. |
| `bcp open <profile>` | Opens a window in that profile, at chrome://extensions unless `--url` says otherwise. |
| `bcp start <profile>` | Starts that profile's relay. |
| `bcp stop <profile>` | Stops that profile's relay; `--all` stops every profile's relay. |
| `bcp check [profile...]` | Opens and closes a tab in each profile, starting its relay and opening a window when needed. Exits 1 if any profile fails. |
| `bcp mcp <profile>` | Prints the MCP server entry for that profile. `--json` prints the JSON alone. |
| `bcp run <profile> -- <command>` | Runs a command with `BROWSER_CONTROL_PORT` set to that profile's port. |

A profile is named by its name in the config (`work`), its folder (`"Profile 3"`) or its number (`3`).

Browser ids for `--browser`: `chromium-snap`, `chromium`, `chrome`, `brave`, `edge` and `vivaldi` on Linux; `chrome`, `chromium`, `brave` and `edge` on macOS. For anything else, give `--user-data-dir` and set `browser` in the config.

## Config

The config lives at `~/.config/browser-control-profiles/config.json` (or under `$XDG_CONFIG_HOME`). `$BROWSER_CONTROL_PROFILES_CONFIG` or `--config <file>` points elsewhere.

```json
{
  "browser": "/snap/bin/chromium",
  "userDataDir": "~/snap/chromium/common/chromium",
  "cli": "browser-control",
  "mcp": "browser-control-mcp",
  "extensionSource": null,
  "copiesDir": "~/browser-control-profiles",
  "connectTimeoutSec": 60,
  "openGraceSec": 35,
  "wakeCloseSec": 120,
  "profiles": {
    "Default": { "name": "work", "port": 19990 },
    "Profile 1": { "name": "personal", "port": 19991 }
  }
}
```

| Field | Meaning |
| --- | --- |
| `browser` | The browser's executable, which `open` and `check` use to open a window in a profile. |
| `userDataDir` | The folder with the browser's `Local State` file and one folder per profile. |
| `cli`, `mcp` | The Browser Control commands. |
| `extensionSource` | The extension build to copy. Left empty, it is found through the `browser-control` command (a symlink, or a wrapper script that names its `cli.js`) or `npm root -g`. |
| `copiesDir` | Where the copies go, one folder per profile, named after the profile's `name`. |
| `profiles` | Keyed by profile folder. `name` is lowercase letters, digits and dashes; `port` is that profile's relay port. |
| `connectTimeoutSec` | How long `check` waits for an extension to connect after opening a window. |
| `openGraceSec` | How long `check` lets the extension in an open profile reconnect by itself before opening a window. |
| `wakeCloseSec` | How long the page that `check` opens stays before it closes itself. |

Port 19989 is Browser Control's default. `bcp init` starts at 19990, so a plain `browser-control` command, and any setup you already have, keeps working.

## Snap browsers on Ubuntu

Snap Chromium runs under an AppArmor rule (`owner @{HOME}/[^s.]**`) that hides every top folder in your home whose name starts with a dot or with "s". Browser Control's own extension folder sits inside its npm package, usually under a dot folder such as `~/.nvm`, where a snap browser cannot load it. The default copies folder, `~/browser-control-profiles`, is readable; `bcp init` refuses a copies folder the snap cannot read, and `bcp list` and `bcp sync` warn about one.

## After a Browser Control upgrade

Run `bcp sync`, then reload each copy at chrome://extensions in its profile. `bcp list` points out a copy that is older than the installed package. If an upgrade changes the line that sets the port, `bcp sync` stops before writing anything and says so.

## Windows and cron

When a profile has no window open, Browser Control cannot open a tab there, so `bcp check` opens one on a small page that closes itself. Run from cron or a service on Linux, bcp takes the desktop session's display variables from `systemctl --user show-environment`, so the window still opens.

## Licence

MIT, see [LICENSE](LICENSE).

Browser Control is made by Anomaly and is MIT licensed too. This repository does not include Browser Control: `bcp sync` copies the extension from the package you installed, on your own machine. This project is not affiliated with Anomaly or the Browser Control project.
