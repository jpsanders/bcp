# Security

## Reporting a vulnerability

Please report security problems privately, through GitHub's
[private vulnerability reporting](https://github.com/jpsanders/bcp/security/advisories/new), not in a public issue.
You will get an answer within a week.

## What bcp does on your machine

bcp reads the browser's `Local State` and profile preferences, copies the Browser Control extension you installed
into one folder per profile with its relay port changed, starts and stops Browser Control's relays, and opens browser
windows. It makes no network requests of its own; relays listen on 127.0.0.1.

A profile with the extension loaded can be driven by any agent that has its relay port, as the person who is signed
in. Give each agent only the profile it needs.
