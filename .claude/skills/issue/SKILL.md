---
name: issue
description: Create a GitHub issue with every property filled — body from the right template, type label, mode label, assignee. Use when the user says "이슈", "이슈 만들어", "issue", or when work needs an issue opened before the first edit.
---

# issue

Open a GitHub issue on this repository with **every property filled in**. An
issue created with a title and a body and nothing else is half an issue: it
does not say what kind of change it is, who is carrying it, or whether a human
or an agent drove it, and every one of those is a field someone later filters
on.

## When an issue is needed

`CLAUDE.md` decides that, not this skill. In short: write one when the change is
a decision someone could reasonably disagree with, when the work outlives a
single pull request, when someone reported it, or when a reader a month from now
would ask why it is like this. Skip it for a typo, a dead link, a formatting
pass, a dependency bump, a rename, a one-line fix nobody would argue with.

**Write it before the first edit.** An issue written from a finished diff
describes the diff, which is the one thing the diff already did.

One issue per concern — not per commit, not per pull request.

## Steps

### 1. Pick the template

`.github/ISSUE_TEMPLATE/` holds the forms. Match the work:

| Template | When |
|---|---|
| `bug_report.yml` | Something does not work the way it should |
| `feature_request.yml` | Something asdf should be able to do |

Write the body as the template's sections, in its order, as Markdown headings
(`### What happened`, `### Steps to reproduce`, …). The form's own `labels:` are
not applied when the body is passed on the command line, so the type label is
set by hand in step 3.

### 2. Write the body

English — this is a public repository. Write it as if the reader has not seen
the diff: what is wrong today, what should be true instead, what else was
considered and why it lost.

End with an `### Acceptance` list of checkboxes specific enough that someone
else could tell whether it is done. "Works correctly" is not an acceptance item;
"closing the last tab leaves the workspace's empty window" is.

### 3. Create it with every property

```sh
gh issue create \
  --title "<imperative, specific, no type prefix>" \
  --body-file <file> \
  --label "<type:*>" \
  --label "<mode:*>" \
  --assignee "<login>"
```

**Every one of these is required.**

| Property | Value |
|---|---|
| `--label` type | Exactly one `type:*` — `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `ci`, `perf`. Same vocabulary as the pull request's. |
| `--label` mode | Exactly one `mode:*` — `mode:ai` when an agent drove the work, `mode:human` when a person did, `mode:mixed` when both contributed substantially. An issue an agent wrote from the user's description is `mode:ai`. |
| `--assignee` | Who is carrying it. Default to the current user: `gh api user --jq .login`. Never leave it empty. |
| `--milestone` | Only when the repository has one open that fits. `gh api repos/:owner/:repo/milestones --jq '.[].title'` — no milestones, no flag. |

The `S`/`M`/`L`/`XL` labels are size labels applied to pull requests by their
diff. Do not put one on an issue: nothing has been written yet.

### 4. Report

Print the issue URL and the properties that went on it, so the user can see
nothing was left blank.

Then link it from the pull request body with `Ref #12`, or `Closes #12` only
when the pull request satisfies **every** acceptance item on it.

## Rules

- Never create an issue with no label and no assignee. If a property cannot be
  determined, ask — do not silently skip it.
- Title is a sentence about the change, not a prefix: "The terminal should paint
  with the system terminal's own profile", not "feat: terminal colours".
- Korean goes in chat, never in the issue.
- Check the open issues before writing a new one; a duplicate costs more than
  the minute it took to look.
