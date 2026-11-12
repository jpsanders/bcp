---
name: bcp
description: Set up and use several Chromium profiles at once with Browser Control through bcp (Browser Control Profiles), one extension copy, relay port and MCP server per profile. Use when the user wants an agent to drive a specific browser profile (work, personal, a client's account), to run several browser agents side by side, or to fix a Browser Control profile that will not connect.
---

# Several Chromium profiles with bcp

Browser Control drives the user's real browser through an extension and a local relay, but one relay serves one
profile. bcp gives every profile its own extension copy and relay port, so each agent gets its own profile.

## Install

```sh
npm install -g @opencode-ai/browser-control            # Browser Control itself, Node 22.19 or later
npm install -g github:jpsanders/bcp#1.1.0              # bcp, no dependencies
```

## Set up, once

1. `bcp init` writes a config with one entry per browser profile, ports from 19990. Name profiles with
   `bcp init work personal` if only some should take part. Use `--browser` when several browsers are installed.
2. `bcp sync` writes one extension copy per profile under `~/browser-control-profiles`.
3. For each profile, `bcp open <profile>` opens chrome://extensions there. **Ask the person** to switch on Developer
   mode, choose Load unpacked and pick that profile's folder. This step only a person can do.
4. `bcp check` proves each profile end to end: relay up, extension connected, a tab opened and closed.

## Use

- `bcp list --json` shows each profile, its port, what it has loaded and whether its relay runs.
- `bcp mcp --all --json` prints the MCP servers for every profile in one `mcpServers` block; `bcp mcp work` prints
  the `claude mcp add` line for one. Give each agent only the profile it should use.
- `bcp run work -- browser-control status` runs any Browser Control command against one profile's relay.
- `bcp start work` and `bcp stop --all` manage relays.

## Rules

- A logged in profile can act as the person on every site it is signed in to. Use the profile the person named,
  and say which one before acting.
- After a Browser Control upgrade: `bcp sync`, then the person reloads each copy at chrome://extensions.
- `bcp guide` prints the full manual, including the snap Chromium folder rules on Ubuntu.
