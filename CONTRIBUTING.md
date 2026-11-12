# Contributing

Issues and pull requests are welcome. Say which browser, which Browser Control version and which platform.

```sh
git clone https://github.com/jpsanders/bcp && cd bcp
npm test
```

There is nothing to install: bcp has no dependencies. After editing `docs/MANUAL.md`, run `npm run man`. CI runs the
tests and the man page check on Node 22, 24 and 26, on Linux and macOS, then packs and installs the package.
