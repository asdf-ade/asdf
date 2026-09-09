# Security policy

## Supported versions

asdf is in early development and has no releases yet. Only `main` is supported.

## Reporting a vulnerability

Please do not open a public issue.

Report privately through GitHub Security Advisories:
[**Report a vulnerability**](https://github.com/asdf-ade/asdf/security/advisories/new).
That creates a private thread with the maintainers.

Useful to include: what an attacker can do, the steps to reproduce it, the
commit you tested, and your operating system.

We will acknowledge the report and tell you whether we consider it a
vulnerability. If we do, we will keep you updated until a fix ships, and credit
you in the advisory unless you prefer otherwise.

## Scope

asdf runs coding agents as local child processes with access to your
filesystem and repositories. Findings that are especially relevant:

- Escaping the intended worktree boundary
- Command injection through repository paths, branch names or agent output
- Main-process IPC handlers reachable from renderer content that should not be
- Leaking credentials, tokens or environment variables into logs or the UI

Out of scope: vulnerabilities in the agents themselves — report those to their
own projects.
