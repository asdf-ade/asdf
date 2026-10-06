# asdf

An agentic development environment (ADE): an Electron + React 19 desktop app for
running coding agents such as Claude Code, Codex and Gemini CLI against
repositories in parallel, each in its own git worktree.

@.claude/rules/architecture.md

## Language

**Everything written into this repository is in English.** This is a public
repository with a global audience, so a Korean artifact is a wall for most
readers.

| Artifact | Language |
|---|---|
| Commit messages | English |
| Code comments and doc comments | English |
| Pull request titles and bodies | English — except the Summary section, which carries a Korean version in a `<details>` block |
| Issue titles and bodies | English |
| README, CLAUDE.md, rules, ADRs | English |
| Branch names | English |
| UI strings | Neither — they go in `src/app/i18n.ts` as translation resources |

Chat with the user stays in whatever language the user writes. Only artifacts
that land in the repository or on GitHub are English.

Never hardcode user-facing text in a component. Add a key to
`src/app/locales/en.json`, translate it in the other locale files, and read it
with `t()`. Those files are the only place non-English text belongs.

### Shipped locales

| Locale | Why |
|---|---|
| `en` | Default and fallback. Also covers India, the second-largest developer population, which works in English. |
| `ko` | Team language |
| `zh-CN` | China — top 5 developer population |
| `ja` | Japan |
| `es` | Spanish |
| `pt-BR` | Brazil — top 5 developer population |
| `ru` | Russia — top 5 developer population |

That set is closed. The rule was: English, Korean, Chinese, Japanese, Spanish,
plus whatever the five countries with the most developers need. Those five are
the United States, India, China, Brazil and Russia, which the list above covers,
so no further language is added without a new decision.

Regional variants are resolved by i18next rather than shipped: `en-GB` falls to
`en` via `nonExplicitSupportedLngs`, and `pt-PT` and `zh-TW` are mapped onto
`pt-BR` and `zh-CN` by the `fallbackLng` map in `src/app/i18n.ts`. Every locale
file must carry the same key set as `en.json`.

## Commands

```sh
pnpm dev                      # run the app
pnpm lint / lint:fix          # biome, includes the layer boundary rules
pnpm typecheck                # tsc --noEmit
pnpm knip                     # unused files, exports, dependencies
pnpm test                     # vitest, the main-process modules
pnpm build                    # typecheck, then build main, preload and renderer
pnpm package                  # build and produce installers with electron-builder
```

## Git and pull requests must go through the skills

Do not run `git` or `gh` directly for branch creation, commit, push, or pull
request creation. The skills apply commitlint, branch
naming, the PR template, reviewer assignment, label assignment and the main
branch guard in one step; calling the CLI directly bypasses all of it.

| Step | Task | Skill |
|---|---|---|
| 1 | Open the issue | `/issue` |
| 2 | New branch | `/new` |
| 3 | Commit and push | `/commit-push` |
| 4 | Create a pull request | `/pr` |

Run them in that order. Step 1 is the one step that does not apply to every
change — see Issues below for when it is needed. Steps 2 to 4 always apply.

**Never commit or push to `main`.** It is protected on GitHub: pull requests are
required, force pushes and deletions are blocked, and the rule applies to
administrators. If a commit is requested while on `main`, create a branch with
`/new` first. Do not push to a branch whose pull request is already merged.

**Exception:** only when the user explicitly says to bypass the skills.

Definitions live in `.claude/skills/{issue,new,commit-push,pr}/SKILL.md`.

## Labels

Every pull request carries exactly one `type:*` and one `mode:*` label.

- `type:` — feat, fix, refactor, chore, docs, test, style, ci, perf
- `mode:` — `mode:ai` (AI drove the work), `mode:human` (a human drove it),
  `mode:mixed` (both contributed substantially)

Pull request bodies fill in `.github/pull_request_template.md`.

## Review

`main` requires **one approving review**. Force pushes and deletions are
blocked, conversations must be resolved, and the rule applies to administrators.

The review pool is `devxian96` and `Hayoung0708`. `/pr` assigns exactly one of
them at random, minus the author — a person cannot approve their own pull
request, so assigning the author would deadlock the merge. Other collaborators
are not on the rota and are not auto-assigned.

## Issues

This repository does not use Linear. Work is tracked in GitHub Issues.

- **Not every change needs one.** An issue carries what a diff cannot: why this,
  why now, why not the obvious alternative. When the diff and the commit message
  already say everything there is to say, an issue adds a number and nothing
  else. Skip it for a typo, a dead link, a formatting pass, a dependency bump, a
  rename, a one-line fix nobody would argue with.
- **Write one** when the change is a decision someone could reasonably disagree
  with, when the work will outlive a single pull request, when someone reported
  it, or when a reader a month from now would ask why it is like this. When it
  is genuinely unclear, write it — an unnecessary issue costs a minute, a
  missing one costs a decision nobody can reconstruct.
- When the work does need an issue, write it **before the first edit**. Do not
  ask, and do not defer it to the end of the task — an issue written from a
  finished diff describes the diff, which is the one thing the diff already did.
- One issue per concern, not per commit and not per pull request. A branch that
  fixes two unrelated things gets two issues and links both; a branch that lands
  one concern in six commits gets one.
- Write the issue as if the reader has not seen the diff: what is wrong today,
  what should be true instead, and an `Acceptance` list specific enough that
  someone else could tell whether it is done.
- Issues use the forms in `.github/ISSUE_TEMPLATE/`.
- **Every issue carries every property**: one `type:*` label, one `mode:*`
  label, and an assignee. A form applies its `type:*` label itself in the web
  UI, but `gh issue create --body-file` bypasses that, so `/issue` sets all
  three by hand. An issue with no assignee and no labels is one nobody can
  filter for and nobody has.
- **Link the issue from the pull request body with `Ref #12`.**
- Use `Closes #12` only when the pull request satisfies every acceptance item on
  that issue. A closing keyword on partial work closes the issue without anyone
  checking the acceptance criteria.

## Open source hygiene

The repository is public, so it carries the files people look for:
`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
`SECURITY.md`, issue forms and `.github/CODEOWNERS`. Keep them accurate when the
workflow changes — a stale contributing guide is worse than none.

`.github/workflows/ci.yml` runs the full gate set on every pull request and is a
required status check. Never weaken it to make a change pass.

## Releases and versioning

Versions are never edited by hand. release-please derives them from Conventional
Commit types on `main`, keeps a `chore(main): release x.y.z` pull request open,
and bumps `package.json` in one commit alongside `CHANGELOG.md`.

`fix:` is a patch, `feat:` a minor, `feat!:` or a `BREAKING CHANGE:` footer a
major once past 1.0. `chore:`, `docs:`, `ci:`, `style:` and `test:` release
nothing — so choosing the wrong prefix silently changes what users receive.

Merging the release pull request tags the release and triggers
`.github/workflows/release.yml`, which builds installers for macOS, Windows and
Linux with electron-builder and attaches them plus the `latest*.yml` files
electron-updater reads to the GitHub release. The app checks those on startup and
offers the update in-app.

Publishing uses the workflow's `GITHUB_TOKEN`; there is no separate signing key
to lose. Code signing certificates are a separate question and are not set up
yet, so installers are unsigned and the OS will warn on first run.

## Gates

pre-commit runs `lint-staged`: biome → `pnpm typecheck` → `pnpm knip` →
`pnpm check:locales`, serially, on the staged snapshot. commit-msg runs
commitlint. pre-push runs `pnpm test` and `pnpm build`. All of these must stay green; never add
`--no-verify` to a workflow.

## Conventions

- The package manager is pnpm. Never use npm or yarn here.
- Add shadcn components with `npx shadcn@latest add <name>` — do not hand-write
  them into `src/components/ui`.
- Base UI composes with a `render` prop, not Radix's `asChild`.
- Tailwind v4 owns `src/index.css`; biome does not lint CSS.
