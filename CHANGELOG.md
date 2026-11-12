# Changelog

Versions follow [semantic versioning](https://semver.org). Tags carry the bare version, such as `1.1.0`.

## 1.1.0 (2026-11-12)

- `bcp mcp --all` prints every profile's MCP server in one `mcpServers` block (`--json`), or one `claude mcp add`
  line each, so a whole set of agents is wired up in one paste.
- A full manual: `bcp guide` prints it, `bcp man` shows it, `bcp man --install` makes `man bcp` work, and a global
  npm install puts the man page on the manpath by itself.
- Node 22 or later (Node 20 reached its end of life in April 2026); CI tests Node 22, 24 and 26 on Linux and macOS,
  then packs and installs the package. A release workflow attaches the npm tarball.
- A Claude Code plugin with a skill, AGENTS.md, llms.txt, a security policy, a code of conduct, issue forms and
  Dependabot.

## 1.0.0 (2026-11-02)

The first release: `init`, `list`, `sync`, `open`, `start`, `stop`, `check`, `mcp` and `run`, Linux and macOS.
