#!/usr/bin/env node
/**
 * merge-claude-hook.mjs — declares the `SubagentStop` hook in a project's
 * `.claude/settings.json`, or refuses to and says which block to paste.
 *
 * `install.sh` calls this from the kit it just cloned. It is the ONE thing the installer
 * writes that is not a file of the kit's, and it is the only reason the installer needs
 * Node at all. Like `check-installed-copy.mjs`, this file never travels to a project: it
 * is a step of installing, not a piece of what gets installed.
 *
 * WHY NODE AND NOT BASH. Everything else the installer does is `cmp` and `cp`. This is a
 * merge into someone else's JSON, and merging JSON with `sed` produces a file that parses
 * until the day it doesn't — on a project's settings file, where the failure shows up as
 * Claude Code silently ignoring every hook, including the ones that were already there.
 *
 * USAGE
 *   node merge-claude-hook.mjs --settings <path> [--apply]
 *
 *   Without `--apply` nothing is written: the status reported is the one the write would
 *   have produced. That is what `--dry-run` uses.
 *
 * OUTPUT — line 1 is the status, for the caller; the rest is prose, for the person:
 *   created    the file did not exist and now holds the hook and nothing else
 *   added      the event was added; every other byte of the file is unchanged
 *   present    a SubagentStop hook already calls the collector — nothing to do
 *   conflict   the file was NOT touched. The caller prints the block to paste
 *
 * Exit code: 0 for the first three, 3 for a conflict — the same code `install.sh` already
 * uses for an incomplete install, because that is exactly what a conflict here leaves.
 *
 * THE FORMAT GUARD, which is the whole reason this is careful. Writing back a parsed
 * object reformats the file to whatever `JSON.stringify` produces. On a settings file
 * indented with tabs, or with keys the owner ordered by hand, that rewrites work nobody
 * asked to have rewritten — and it does it inside a diff too noisy to review, which is how
 * such a change reaches `main` unnoticed. So before writing anything, the original is
 * re-serialized unchanged and compared byte for byte with what was read. If it does not
 * reproduce, this file has a formatting style we cannot preserve, and that is a conflict
 * with a block to paste — never a silent reformat.
 *
 * Order matters in the checks below: "is the hook already there" is asked BEFORE the
 * format guard. Someone who pasted the block into their own hand-formatted file must get
 * a clean install on the next run, not a conflict over formatting we were never going to
 * touch.
 *
 * `settings.local.json` is never read and never written. It is gitignored in every project
 * that has one, so a hook declared there runs for one person and for nobody else — and CI
 * would not see it either.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The event and the command. `install.sh` prints its own copy of this block for the
// conflict case — it has to, since a missing `node` is one of the conflicts. The two
// copies are kept in step by a test that pastes the printed block and reruns the installer
// (F-2): a block that stopped being valid JSON, or stopped naming the collector, reports
// `conflict` there where `present` was expected.
const EVENT = 'SubagentStop';
const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/scripts/collect-subagent.mjs"';
// What identifies OUR hook among someone else's. Matching on the collector's filename
// rather than on the exact command string means a project that moved the collector, or
// added its own flags, still counts as having it — re-adding a second copy of a hook that
// already runs would double every collection.
const HOOK_MARKER = 'collect-subagent.mjs';
const HOOK_TIMEOUT = 15;

const newEntry = () => ({
  hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: HOOK_TIMEOUT }],
});

// The one serialization this program will ever write. Two spaces and a trailing newline is
// what Claude Code itself writes, and — measured, not assumed — what both settings files in
// the repo producing this kit already round-trip to.
const serialize = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

// The status goes out on a line the caller can FIND, not on a line it has to count to.
// First version printed the bare word and install.sh read line 1; anything that printed
// before this program did — an instrumentation preload, a version manager's banner — pushed
// that line down and the status was read as unrecognized. A settings.json that had been
// written was then reported untouched. The stderr half of that was the blocking finding of
// 2026-09-19; the stdout half is the same defect and is closed the same way.
const STATUS_PREFIX = 'AEKIT-HOOK-STATUS:';

function report(status, message) {
  console.log(`${STATUS_PREFIX} ${status}`);
  if (message) console.log(message);
  process.exit(status === 'conflict' ? 3 : 0);
}

// ── Arguments ────────────────────────────────────────────────────────────────────────
let settingsPath = '';
let apply = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--settings') settingsPath = argv[++i] ?? '';
  else if (argv[i] === '--apply') apply = true;
  else {
    console.error(`merge-claude-hook: unrecognized argument: ${argv[i]}`);
    process.exit(2);
  }
}
if (!settingsPath) {
  console.error('merge-claude-hook: --settings <path> is required');
  process.exit(2);
}

// ── 1. No file at all: the simplest case, and the one a fresh project lands in ───────
if (!existsSync(settingsPath)) {
  if (apply) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, serialize({ hooks: { [EVENT]: [newEntry()] } }), 'utf8');
  }
  report('created', 'the file did not exist; it now declares this hook and nothing else');
}

// ── 2. It exists. Anything we cannot read is a conflict, never a replacement ─────────
let original;
try {
  original = readFileSync(settingsPath, 'utf8');
} catch (err) {
  report('conflict', `the file could not be read: ${err.message}`);
}

let parsed;
try {
  parsed = JSON.parse(original);
} catch (err) {
  // An invalid settings file is already breaking that project's hooks. Overwriting it
  // would destroy the only copy of whatever they were mid-edit on, so it is left exactly
  // as found and reported.
  // Says what to do, not only what is wrong: pasting the block does NOT clear this one.
  // The parse runs before the "is the hook already there?" question, so a file that is both
  // unparseable and already correct keeps failing. Without this sentence the project ends up
  // in a loop where every install is incomplete and nobody knows why.
  report('conflict', `the file is not valid JSON (${err.message}); it was left untouched. Fix the syntax FIRST — pasting the block below into a file that does not parse leaves every future install incomplete, because this check runs before the one that asks whether the hook is already there`);
}
if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
  report('conflict', 'the file parses, but its top level is not a JSON object');
}

// ── 3. Is our hook already declared? Asked before the format guard, on purpose ───────
const hooksSection = parsed.hooks;
const hasHooksSection = hooksSection !== undefined;
if (hasHooksSection && (hooksSection === null || typeof hooksSection !== 'object' || Array.isArray(hooksSection))) {
  report('conflict', 'the "hooks" key exists but is not an object; it was left untouched');
}

const eventValue = hasHooksSection ? hooksSection[EVENT] : undefined;
const hasEvent = eventValue !== undefined;
if (hasEvent && !Array.isArray(eventValue)) {
  report('conflict', `"hooks.${EVENT}" exists but is not an array; it was left untouched`);
}

// Any command under the event that names the collector counts. The shape is walked
// defensively rather than trusted: this is a file a person edits by hand, and a malformed
// entry here must not throw — a crash would be reported as "the installer failed", which
// sends someone to look at the installer instead of at their settings file.
const declaresCollector = (entries) =>
  Array.isArray(entries) && entries.some((entry) =>
    entry && typeof entry === 'object' && Array.isArray(entry.hooks)
      && entry.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(HOOK_MARKER)));

if (hasEvent && declaresCollector(eventValue)) {
  report('present', `a ${EVENT} hook already calls ${HOOK_MARKER}`);
}

// ── 4. The event is there but it is somebody else's ──────────────────────────────────
// An empty array is not somebody else's hook: it is the absence of one, written out. It
// gets appended to like any missing event.
if (hasEvent && eventValue.length > 0) {
  report('conflict',
    `this project declares its own ${EVENT} hook, which does not call ${HOOK_MARKER}; it was left untouched`);
}

// ── 5. The format guard ──────────────────────────────────────────────────────────────
if (serialize(parsed) !== original) {
  report('conflict',
    'this file has a formatting style that writing it back would not reproduce '
    + '(indentation, key order, or trailing bytes); it was left untouched');
}

// ── 6. Add the event ─────────────────────────────────────────────────────────────────
// Mutating the parsed object keeps every existing key in its original position — the new
// event is appended, and nothing before it moves. Combined with the guard above, the only
// difference between the old bytes and the new ones is the block that was added.
if (!hasHooksSection) parsed.hooks = {};
if (!Array.isArray(parsed.hooks[EVENT])) parsed.hooks[EVENT] = [];
parsed.hooks[EVENT].push(newEntry());

if (apply) writeFileSync(settingsPath, serialize(parsed), 'utf8');
report('added', `the ${EVENT} event was added; the rest of the file is unchanged`);
