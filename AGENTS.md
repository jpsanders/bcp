# AGENTS.md

Instructions for AI coding agents working on bcp itself. To use bcp, read `skills/bcp/SKILL.md` or run `bcp guide`.

## Commands

```sh
npm test           # every test, node --test, no dependencies
npm run man        # rebuild man/bcp.1 after editing docs/MANUAL.md
npm run man:check  # fail when man/bcp.1 is stale; CI runs it
```

Node 22 or later. CI runs Node 22, 24 and 26 on Linux and macOS, then packs and installs the package globally.

## Layout

```text
bin/bcp.js          argument parsing, help, guide and man, dispatch
src/commands.js     one function per command; returns text or { text, code }
src/config.js       the config file, profile lookup and validation
src/browsers.js     browser detection, profiles from Local State, the snap folder rule
src/extension.js    finding the Browser Control build and writing the patched copies
src/relay.js        starting, stopping and probing relays
src/check.js        the end to end check
src/window.js       opening a window in a profile, from a desktop or from cron
docs/MANUAL.md      the one source for bcp guide and the man page
```

## Rules

- No dependencies. Use Node's standard library.
- Tests never start a real browser or touch the user's config; use the fakes in `test/helpers.js`.
- The extension patch changes exactly one line (the relay port). If upstream changes that line, stop and say so.
- Lines in Markdown stop at 120 characters where possible. Tags carry the bare version, `1.2.0`, never `v1.2.0`.
