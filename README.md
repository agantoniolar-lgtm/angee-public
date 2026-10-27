# angee

Guardrails for software projects run by an AI agent in Claude Code. angee is a set of skills, scripts and templates that you install into a project, new or already running. From then on the agent plans before it touches files and verifies its work for real. An independent subagent reviews each change, and every step leaves a written trail.

The principle behind all of it: **the project owner reviews outputs, not diffs.** Every checkpoint leaves something a person can read and decide on without opening the code — a task file, a review finding explained in plain language, a session log, a status page.

Install it with one command (*Step 1* below), then run the `setup` skill in that project. Install the whole kit rather than picking pieces: the guardrails depend on each other. Verification depends on tasks being tracked, review depends on verification having run, and shipping depends on both.

> **Language.** The kit itself is always in English: skills, scripts, templates, and everything they print. Each project picks its own language during `setup`, and that choice governs the project's own documents — its `CLAUDE.md`, `STATUS.md`, task files, scope docs and session logs. The one exception is the control center page (`templates/control-center.html`), which carries English and Spanish texts and asks each project its language the first time it is created.

## Requirements

- **Claude Code**, the terminal CLI. The skills live under `.claude/skills/`, where Claude Code discovers them with no registration step. The kit is written for Claude Code and is not set up for other Claude surfaces.
- **git.** The installer clones the kit with it. The target project should be a git repository: that is what lets the installer promise that anything it replaces can be brought back.
- **The GitHub CLI, `gh`, authenticated** (`gh auth status` should succeed). The install command fetches the installer with `gh api`, the installer clones with `gh repo clone`, and the version check asks GitHub through `gh`. `gh` is required: the install command itself starts with `gh api`.
- **bash**, plus `sha256sum` or `shasum` for the file hashes the installer records. Both are standard on macOS and Linux.
- **Node.js.** The scripts in `scripts/` are ES modules run with `node`. The kit declares no minimum version. Without Node, the installer cannot write its hook into `.claude/settings.json` and ends incomplete.
- **gitleaks**, for the secret scan `setup` runs on an existing project and for the pre-commit hook it asks you to install. An equivalent scanner that reads the full content of every commit also satisfies it.

The installer needs the network. There is no offline install.

## What's in here

- **`.claude/skills/`**: the 15 skills. `open-session` and `session-log` open and close a working session. `setup` installs the guardrails into a project. `prototype` tests an idea before anyone commits to it. Then the chain for each task: `scope`, `design`, `adversarial`, `build`, `verify-tests`, `verify-evals`, `verify-ui`, `verify-rls`, `commit`, `code-review` and `ship` (see *Step 3*). `ship` carries a script, `ship/scripts/check-deploy-status.sh`, that polls a pushed commit's GitHub checks through `gh` until they resolve.
- **`.claude/agents/`**: two read-only subagents. `code-reviewer` is dispatched by `code-review` and receives only the change and its stated intent, never the builder's reasoning, so it does not inherit the builder's assumptions. `scope-reviewer` checks a task's plan before the owner sees it.
- **`templates/`**, installed as `ae-kit-templates/`: the project's standing rules (`CLAUDE.md.template`) and its setup checklist (`SETUP_CHECKLIST.md.template`). The task tracker (`task.md.template`, `BACKLOG.md.template`, `PENDINGS.md.template`, `STATUS.md.template`). The two shapes of written plan (`scope-doc.md.template`, `prd.md.template`). Reference documents the skills read, such as `style-rules.md` and `decision-classes.md`.
- **`scripts/`**: the checkers and generators the skills and git hooks run.
- **`release-notes/`**: one file per version, `<version>.md`, with what to do before and after installing it. The installer prints the ones that apply.
- **`VERSION`**: the kit's version, the one number a project compares itself against.
- **`install.sh`**: the only installer.
- **`LICENSE`**: MIT.

The task tracker is one file per task under `tasks/`. `TASKS.md`, `BACKLOG.md` and `TASKS_ARCHIVE.md` are indexes generated from those files by `scripts/generate-task-index.mjs`, never edited by hand: anything written in them is lost the next time they are regenerated. An idea not yet started is a task file too, with `status: backlog`, and it shows up in `BACKLOG.md`. `PENDINGS.md` holds open decisions carried between sessions and counts them: at three mentions, `scripts/check-pendings.mjs` escalates. Session logs live in `logs/sessions/<YYYY-MM>/`, one folder per month.

## Installing into a project

### Step 1 — put the kit's files in the project

No Claude session is needed for this step. One command, which always installs from this repository:

```bash
gh api repos/agantoniolar-lgtm/angee-public/contents/install.sh \
  -H "Accept: application/vnd.github.raw" | bash -s -- /absolute/path/to/project
```

Options go after the path:

| Option | What it does |
|---|---|
| `--dry-run` | Reports what would be written, replaced or refused, and writes nothing |
| `--ref <branch>` | Installs from that branch instead of `main`. Git would also accept a tag, but this repository publishes none. A commit SHA is not accepted. A ref that does not exist stops the install instead of falling back to `main` |
| `--notes-done <x.y.z>` | Confirms that the "Before installing" steps of the release notes are done. Only the version being installed confirms them |
| `--help` | Prints the usage and exits |

The installer writes at the project root: `.claude/skills/`, `.claude/agents/`, `ae-kit-templates/`, `scripts/`, `.ae-kit-version` (the kit version the project runs) and `.ae-kit-manifest` (the SHA-256 of every kit file it left on disk). The kit's own test suites do not travel.

It also adds one declaration to each of two files that belong to the project: the `SubagentStop` hook in `.claude/settings.json`, and the line `logs/tasks/*.md merge=union` in `.gitattributes`. If either conflicts with what the project already declares, it leaves the file alone and prints the exact text to paste.

**Release notes.** Before writing anything, the installer prints the release notes of every version between the one installed and the new one. If any of them lists steps under "Before installing", it stops with nothing written. Do those steps, then run the same command again with `--notes-done <new version>`. A first install into a project with none of the kit's files sees only the new version's notes and is never stopped. A project that already has its own files at paths the kit ships (for example its own `.claude/skills/commit/`, `scope/` or `build/`, or `.claude/agents/code-reviewer.md`) is treated differently: see "Using it on an existing project".

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Installed |
| 1 | Fatal error: no target, the kit could not be fetched, or a malformed release-notes file |
| 2 | A malformed argument |
| 3 | Incomplete: a project file needs a line pasted by hand, or a kit file could not be written. `.ae-kit-version` does not move |
| 4 | Refused, nothing written (see *Keeping a project current*) |
| 5 | Stopped by the release notes, nothing written |

### Pieces a project won't use

A project declares the parts of the kit that don't apply to it in `.ae-kit-excluded`, at its root. One path per line, each with a reason after `#`, `—` or `--`:

```
.claude/skills/verify-rls/   # no database
.claude/skills/verify-ui/    # no UI
```

The installer skips them and says which ones and why, so they don't come back on the next update. A line with no reason is ignored, and the piece is installed anyway. The task-log pieces (its scripts and `task-log-ontology.md`) cannot be excluded: the skills write every step of the work through them.

A project's own files that live inside the kit's folders, such as a skill of its own, go in `.ae-kit-local`, with the same format. The installer never removes them as files the kit dropped. It does overwrite a file of the project that sits at the very path of a kit file.

### A fix a project needs in a kit file

A kit file is not edited in the project: the next install overwrites it. A fix the kit does not ship yet becomes a row in the "Local kit adjustments" section of the project's `CLAUDE.md`. The row holds the rule in prose, or points to a local file outside the kit's paths declared in `.ae-kit-local`, and names the issue that asks for the fix upstream.

`scripts/check-local-adjustments.mjs` compares every kit file against `.ae-kit-manifest`. Installed as a pre-commit hook, it blocks a commit that edits a kit file without a row. `ae-kit-templates/local-adjustments.md` turns a kit file already edited into a row, step by step.

### Step 2 — run `setup` in Claude Code, inside the project

Claude Code discovers `.claude/skills/setup/SKILL.md` on its own. If `.claude/` did not exist when the session started, restart the session, and run `/skills` to confirm it is listed.

`setup` first checks the project's kit version against this repository with `scripts/check-kit-current.mjs`. It then interviews you briefly — including the language for the project's own documents — or detects the existing stack in a project already running. It writes `CLAUDE.md`, `SETUP_CHECKLIST.md` and the task-tracker files at the project root.

### Step 3 — work through the chain

The project is ready once `SETUP_CHECKLIST.md` is fully checked, or its unchecked items are marked Not applicable or Deferred in its section 0. From then on, each session opens with `open-session` and closes with `session-log`. Every non-trivial task runs, once per unit of work:

`scope → design → adversarial → build → verify → commit → code-review`

and then `ship` once, when every unit has passed its review. `scope` splits the task into units, one commit each. `design` runs only when the task changes a data structure or a UI. `verify` means `verify-tests` always, plus `verify-evals`, `verify-ui` or `verify-rls` when the change calls for them. `commit` stops at a local commit, `code-review` reviews that commit, and `ship` pushes the whole task and confirms the remote checks came back green.

`ae-kit-templates/` stays in the project: the skills read their reference documents from it.

## Keeping a project current

`.ae-kit-version` records which kit version the project runs. Two skills compare it against this repository's `VERSION` with `scripts/check-kit-current.mjs`: `setup`, before it starts, and `open-session`, at the start of every session. The comparison always asks the remote, never a copy on disk.

| Exit | Meaning |
|---|---|
| 0 | Current |
| 1 | Behind: update before starting work |
| 2 | Could not verify (no network, no `gh`, or not authenticated). This is reported as unverified, never as current |
| 3 | No `.ae-kit-version`, or one with no readable version |
| 4 | Ahead of the remote: something local never made it back to the kit |

**To update a project that fell behind:** first turn any kit file the project edited into a local adjustment (`setup`'s step 0a, with `ae-kit-templates/local-adjustments.md`). Then run the install command again and commit what it wrote. Run it with `--dry-run` first to read the report before anything changes. The installer overwrites every kit file that differs from the new version, and reports:

- **the files it replaced**, and apart, **the ones the project had edited**, each with the `git show` command that brings its previous content back. The command names the commit that was `HEAD` before the install, so it still works after the install is committed.
- **the files the kit no longer ships**: removed if they are unchanged since they were installed, left in place and reported once if the project changed them. Nothing declared in `.ae-kit-excluded` or `.ae-kit-local` is removed.
- **what it judged "edited" and "unchanged" against.** Normally the previous `.ae-kit-manifest`. Without a usable one (missing, never committed, or with a malformed line), it compares against the published version that `.ae-kit-version` names, read from the kit repository's history. If that cannot be read either, every replaced file is listed as unknown and nothing is removed.

**In a git repository, it refuses with exit 4 and writes nothing when git could not bring back what it would replace.** The usual case is a kit file it would change that has uncommitted changes, or is not tracked: commit or stash them, then run it again. It also refuses when a `.git` exists but git cannot read it. Outside any git repository it installs and says that what it replaced cannot be recovered; run `git init` and commit first if that matters.

Exit 3 means the install is incomplete, and the report says why. It may be a line to paste in a project file, a kit file or manifest it could not write, or a dropped file it could not remove. `.ae-kit-version` stays at the previous version until a run completes.

## Using it on an existing project

- **Before the first install, move your own skills and agents off the kit's paths.** The kit ships `.claude/skills/<name>/` for each of its 15 skills and `.claude/agents/code-reviewer.md` and `scope-reviewer.md`. A project file at one of those paths is the kit's from then on: the installer overwrites it (listing it, with a `git show` command to bring it back). Such a file also makes the installer treat the project as an earlier install, print the notes of every past version and stop with exit 5; those notes were written for projects that installed earlier versions and their steps do not apply to you. Rename your own files (for example `.claude/skills/my-commit/`), commit, and install again; the first install then runs without stopping.
- **The setup retrofit** is required. Run `setup` on the existing codebase so it gets `CLAUDE.md`, the skills, and a `SETUP_CHECKLIST.md` that tells what is missing apart from what simply isn't built yet (its section 0).
- **Migrating history** is optional. A project can start `tasks/` and `logs/sessions/` fresh. If you backfill an old tracker, every item becomes a task file under `tasks/`: not-yet-started ones with `status: backlog`, active ones with their real status, closed ones with `status: done` or `dropped`. The indexes, `BACKLOG.md` included, are then regenerated from them; never paste items into an index.

## Assumed stack

Unless the `setup` interview says otherwise: Postgres with per-user access control (Supabase or equivalent), serverless functions for AI-native logic, React + Vite, TypeScript strict, Vitest + Playwright, npm. Where per-branch databases aren't available, the default sandbox is a second, separate instance seeded with fake data; `SETUP_CHECKLIST.md.template` describes it. Branch policy and commit-message format are asked during `setup`, since a running project usually has a convention for each.

This is the stack assumed once a project reaches each piece. A project that hasn't built one yet records it as Deferred in section 0 of `SETUP_CHECKLIST.md` and as `TBD — deferred` in the Stack section of `CLAUDE.md`.

## Secrets

Real API keys, database passwords and connection strings live only in `.env.local`: it is gitignored, and most frontend tooling loads it by that name. Not in a bare `.env`, which is easy to commit by accident. Never in `CLAUDE.md`, `SETUP_CHECKLIST.md`, task files, or anything under `.claude/skills/`, since those are committed.

On an existing project, `setup` first scans the whole git history for secrets already committed, with `gitleaks git .` by default. Any scanner that reads the full content of every commit satisfies it. A check by filename only does not: a secret can sit in a plain Markdown file.

## Contributing

This repository is generated from a private workshop repository on every release, and each release overwrites it. Nothing is merged here directly.

At the close of each session, `session-log` runs `scripts/emit-lessons.mjs`, which can send de-identified lessons to the workshop as an issue. It sends nothing without consent: `setup` asks once and writes the answer, `yes` or `no`, to `.ae-kit-contrib` at the project root, and every send still waits for the owner's approval. The workshop repository is private, so a team outside it should answer `no`; with `no` the script stays silent.

Open an issue, or a pull request if you have a concrete change. They are read by the maintainer when time allows, with no promised response time. What is accepted is carried to the source and ships in a later version, and the release notes of that version say what changed.

## License

MIT — see [`LICENSE`](LICENSE). The installer never copies it into a project. If you redistribute a project that contains the kit's files, keep a copy of the kit's `LICENSE` with them: MIT requires its notice in every copy.
