# bcp

## NAME

bcp - drive several Chromium profiles at once with Browser Control, one extension copy and relay per profile

## SYNOPSIS

```
bcp init [profile...] [--browser ID] [--user-data-dir DIR] [--copies-dir DIR] [--first-port PORT] [--force]
bcp [list] [--json]
bcp sync [--source DIR]
bcp open PROFILE [--url URL]
bcp start PROFILE
bcp stop PROFILE | --all
bcp check [profile...]
bcp mcp PROFILE | --all [--json]
bcp run PROFILE -- COMMAND [ARGS...]
bcp guide
bcp man [--install | --raw]
```

## DESCRIPTION

Browser Control lets an AI agent drive your real, logged in browser through a small extension and a local relay. One
relay serves one profile: the extension always connects to port 19989, and the relay turns a second profile's
extension away. bcp gives each Chromium profile its own copy of the extension, set to its own relay port, so one
relay per profile runs side by side and each agent gets the profile it should use.

bcp has no dependencies and needs Node 22 or later, Browser Control (`npm install -g @opencode-ai/browser-control`)
and a Chromium family browser: Chromium, Chrome, Brave, Edge or Vivaldi, on Linux or macOS. It is also installed as
`browser-control-profiles`, for systems where SQL Server's own `bcp` comes first on the PATH.

A profile is named by its name in the config (`work`), its folder (`"Profile 3"`) or its number (`3`).

## COMMANDS

| Command | What it does |
| --- | --- |
| `init` | Write a config from the browser's profiles, all or the ones named, ports from 19990. |
| `list` | The default. Each profile: its copy, what it has loaded, its relay. `--json` for scripts. |
| `sync` | Write one copy of the extension per profile. `--source DIR` copies another build. |
| `open` | Open a window in a profile, at chrome://extensions unless `--url` says otherwise. |
| `start` | Start a profile's relay. |
| `stop` | Stop a profile's relay; `--all` stops every relay. |
| `check` | Prove each profile works: open and close a tab, starting its relay and a window when needed. |
| `mcp` | Print a profile's MCP server entry; `--all` prints every profile's in one block; `--json` prints JSON alone. |
| `run` | Run a command with `BROWSER_CONTROL_PORT` set to the profile's port. |
| `guide` | Print this manual as Markdown, for people and agents. |
| `man` | Show this manual as a man page; `--install` puts it where `man bcp` finds it. |

## OPTIONS

| Option | Meaning |
| --- | --- |
| `--config FILE` | The config file instead of the default. |
| `--browser ID` | With `init`: `chromium-snap`, `chromium`, `chrome`, `brave`, `edge` or `vivaldi` on Linux; `chrome`, `chromium`, `brave` or `edge` on macOS. |
| `--user-data-dir DIR` | With `init`: the folder holding the browser's `Local State` and one folder per profile. |
| `--copies-dir DIR` | With `init`: where the extension copies go. Default `~/browser-control-profiles`. |
| `--first-port PORT` | With `init`: the first relay port. Default 19990. |
| `--force` | With `init`: replace an existing config. |
| `--json` | With `list` and `mcp`: print JSON. |
| `--all` | With `stop` and `mcp`: every profile. |
| `-h`, `--help` | The short help. |
| `-v`, `--version` | The version. |

## CONFIG

`~/.config/browser-control-profiles/config.json`, or under `XDG_CONFIG_HOME`, or the file in
`BROWSER_CONTROL_PROFILES_CONFIG` or `--config`.

| Field | Meaning |
| --- | --- |
| `browser` | The browser's executable, used by `open` and `check`. |
| `userDataDir` | The folder with `Local State` and one folder per profile. |
| `cli`, `mcp` | The Browser Control commands, `browser-control` and `browser-control-mcp` by default. |
| `extensionSource` | The extension build to copy; empty means find it through `browser-control` or `npm root -g`. |
| `copiesDir` | Where the copies go, one folder per profile, named after the profile's `name`. |
| `profiles` | Keyed by profile folder: `name` (lowercase letters, digits and dashes) and `port`. |
| `connectTimeoutSec` | How long `check` waits for an extension to connect after opening a window. Default 60. |
| `openGraceSec` | How long `check` lets an open profile's extension reconnect first. Default 35. |
| `wakeCloseSec` | How long the page `check` opens stays before closing itself. Default 120. |

Port 19989 stays Browser Control's own default, so a plain `browser-control` command keeps working.

## SETTING UP

```
bcp init                 # one entry per profile, ports from 19990
bcp sync                 # one copy of the extension per profile
bcp open work            # chrome://extensions in that profile
```

In each profile, switch on Developer mode, choose Load unpacked and pick that profile's folder under
`~/browser-control-profiles`. Then `bcp check` proves every profile end to end, and `bcp mcp --all` prints the MCP
entries to give your agents.

## SNAP BROWSERS ON UBUNTU

Snap Chromium cannot read top level folders in your home that start with a dot or with "s", so the extension inside
an npm folder such as `~/.nvm` cannot load there. The default copies folder is readable; `init` refuses one the snap
cannot read, and `list` and `sync` warn about one.

## AFTER A BROWSER CONTROL UPGRADE

Run `bcp sync`, then reload each copy at chrome://extensions in its profile. `bcp list` points out a copy older than
the installed package. If an upgrade changes the line that sets the port, `sync` stops before writing and says so.

## WINDOWS AND CRON

With no window open in a profile, Browser Control cannot open a tab there, so `check` opens one on a small page that
closes itself. Run from cron or a service on Linux, bcp takes the desktop's display variables from
`systemctl --user show-environment`, so the window still opens.

## EXIT STATUS

0 on success. 1 when a check fails or the arguments are wrong, with the reason on standard error.

## FOR AGENTS

Use `bcp list --json` to see the profiles, their ports and whether each relay runs. Give each agent its own profile's
MCP server from `bcp mcp PROFILE --json`, or run a Browser Control command against a profile with
`bcp run PROFILE -- browser-control ...`. Loading the unpacked extension in each profile is a step only the person can
do in the browser; ask them to, then run `bcp check`.

## SEE ALSO

https://github.com/jpsanders/bcp, https://github.com/anomalyco/browser-control

## AUTHOR

James Phillip Sanders, https://jamesphillipsanders.com
