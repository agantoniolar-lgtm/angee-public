#!/usr/bin/env node
/**
 * apply-branch-policy.mjs — leave a project's CLAUDE.md and .gitignore consistent with the
 * branch policy its owner chose in `setup`.
 *
 * ── Why this is a script and not a paragraph ─────────────────────────────────────────
 * The template's Git conventions carry one line that only holds for a project that
 * delegates: "Delegating is the default…". It tells the agent to build each unit in a
 * worktree under `.claude/worktrees/`, and that directory must be in `.gitignore` before
 * the first delegation — otherwise a `git add -A` while a worktree exists commits a
 * dangling reference to it. Two edits, in two files, that depend on one answer. Written as
 * prose in `setup`, they were done by hand, differently each time, and nothing checked that
 * the line was gone from a single-writer project or that the entry was there in a
 * delegating one. Here both follow from the answer.
 *
 * ── The three policies ───────────────────────────────────────────────────────────────
 *   single    one writer at a time. The delegation line is removed from CLAUDE.md;
 *             .gitignore is not touched.
 *   delegate  units are built by subagents in worktrees. `.claude/worktrees/` is added to
 *             .gitignore unless the last line there that names it (`.claude/worktrees`,
 *             with or without a leading or trailing slash or a trailing `*`) ignores it
 *             rather than negating it; .gitignore is created if missing. Then CLAUDE.md is
 *             checked, not edited, for the delegation line.
 *   other     the project has a policy of its own (one branch per task, say). Nothing is
 *             touched: what that policy needs is a conversation with the owner, not a
 *             default.
 *
 * Usage: node scripts/apply-branch-policy.mjs <single|delegate|other> [--root <path>]
 *
 * ── The delegation line is recognised only verbatim ──────────────────────────────────
 * The script never guesses which line delegates. Guessing by content either misses a
 * translated line and passes, or deletes a legitimate line that happens to name
 * `.claude/worktrees/`. So it recognises exactly the template's line — the list item that
 * starts with DELEGATION_LINE below, with any indented continuation lines under it — and
 * `setup` applies the policy to the English CLAUDE.md it just generated, before translating
 * it, and keeps that line in English when it does: it is configuration, not prose. When the
 * line is not there verbatim (a mature CLAUDE.md, a translated one), the script does not
 * claim the file is consistent: it exits 3 and lists the lines that mention worktrees or an
 * `ai/` branch, for a person to read. A CLAUDE.md that is not clean UTF-8 is never
 * rewritten (exit 2); a UTF-8 byte-order mark is kept.
 *
 * Every change is printed, quoting what was removed.
 *
 * Exit codes:
 *   0  the project is consistent with the policy (changed now, or already was)
 *   1  rejected: bad arguments, a root that is not a directory, or `single` with no
 *      CLAUDE.md to apply it to — the message says what to do
 *   2  a file could not be read, decoded or written; nothing is claimed about its state
 *   3  could not verify: CLAUDE.md does not carry the template's delegation line verbatim
 *      (or carries it more than once), so whether it asks to delegate is for a person to
 *      check — the lines worth reading are listed. Anything this run had to write to
 *      .gitignore was written first.
 */

import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const USAGE = 'usage: node scripts/apply-branch-policy.mjs <single|delegate|other> [--root <path>]';
const POLICIES = ['single', 'delegate', 'other'];
const ENTRY = '.claude/worktrees/';
// The start of the line in kit/templates/CLAUDE.md.template, verbatim. Nothing else counts.
const DELEGATION_LINE = '- **Delegating is the default, while no class A decision is pending on the work.**';
// Lines a person should read when the verbatim line is not there.
const WORTH_READING = /worktree|ai\//i;
// A .gitignore pattern for the worktrees directory, exactly like ENTRY. No leading space:
// git does not strip one, so ` .claude/worktrees/` ignores nothing.
const EQUIVALENT_ENTRY = /^\/?\.claude\/worktrees(\/|\/\*|\/\*\*)?$/;
const BOM = '﻿';

function reject(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function failed(message) {
  console.error(`✗ ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  let policy = null;
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[i + 1];
      if (value === undefined || value === '') reject(`--root needs a path\n${USAGE}`);
      root = value;
      i++;
    } else if (arg.startsWith('-')) {
      reject(`unknown option ${arg}\n${USAGE}`);
    } else if (policy === null) {
      policy = arg;
    } else {
      reject(`one policy only, got "${policy}" and "${arg}"\n${USAGE}`);
    }
  }
  if (policy === null) reject(`no policy given\n${USAGE}`);
  if (!POLICIES.includes(policy)) reject(`unknown policy "${policy}" — expected one of ${POLICIES.join(', ')}\n${USAGE}`);
  return { policy, root: resolve(root) };
}

function readBytes(path) {
  try {
    return readFileSync(path);
  } catch (err) {
    failed(`could not read ${path}: ${err.message}`);
  }
}

function write(path, content) {
  try {
    writeFileSync(path, content);
  } catch (err) {
    failed(`could not write ${path}: ${err.message}`);
  }
}

// The verbatim delegation line(s) in `lines`, each as [start, end) with its indented
// continuation lines.
function findDelegationLines(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(DELEGATION_LINE)) continue;
    let end = i + 1;
    while (end < lines.length && lines[end].trim() !== '' && /^\s/.test(lines[end])) end++;
    found.push([i, end]);
  }
  return found;
}

// Prints the "could not verify" report and returns the exit code for it.
function cannotVerify(lines, found, what) {
  const reason = found.length > 1
    ? `CLAUDE.md carries the template's delegation line ${found.length} times (lines ${found.map(([i]) => i + 1).join(', ')})`
    : "CLAUDE.md does not carry the template's delegation line verbatim";
  console.log(`? ${reason} — could not verify ${what}.`);
  const worth = lines.map((line, i) => [i, line]).filter(([, line]) => WORTH_READING.test(line));
  if (worth.length === 0) console.log('  No line mentions a worktree or an ai/ branch. Read the Git conventions section by hand.');
  else {
    console.log('  Lines that mention a worktree or an ai/ branch — read them by hand:');
    for (const [i, line] of worth) console.log(`  ${String(i + 1).padStart(5)} | ${line.trim()}`);
  }
  return 3;
}

function applySingle(root) {
  const path = join(root, 'CLAUDE.md');
  if (!existsSync(path)) {
    reject(`no CLAUDE.md in ${root} — generate it from ae-kit-templates/CLAUDE.md.template first, then run this again`);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readBytes(path));
  } catch {
    failed(`${path} is not valid UTF-8 — not rewritten, since re-encoding it would corrupt it. Convert it to UTF-8, or remove the delegation line by hand.`);
  }
  const bom = text.startsWith(BOM) ? BOM : '';
  const lines = text.slice(bom.length).split('\n');
  const found = findDelegationLines(lines);
  console.log('.gitignore: not touched — a single writer creates no worktrees.');
  if (found.length !== 1) {
    return { changed: false, code: cannotVerify(lines, found, 'that CLAUDE.md does not ask to delegate; nothing was changed') };
  }
  const [at, end] = found[0];
  const removed = lines.slice(at, end);
  write(path, bom + [...lines.slice(0, at), ...lines.slice(end)].join('\n'));
  console.log(`CLAUDE.md: removed the delegation line (${end - at > 1 ? `lines ${at + 1}–${end}` : `line ${at + 1}`}) — this project works with a single writer:`);
  for (const line of removed) console.log(`  - ${line.replace(/\r$/, '')}`);
  console.log("  The Branch policy line under Git conventions must say so, in the project's own words.");
  return { changed: true, code: 0 };
}

function applyDelegate(root) {
  const path = join(root, '.gitignore');
  const why = 'without it, a `git add -A` while a worktree exists commits a dangling reference to it';
  let changed = false;
  if (!existsSync(path)) {
    write(path, `${ENTRY}\n`);
    console.log(`.gitignore: created, with ${ENTRY} — ${why}.`);
    changed = true;
  } else {
    // Read as latin1 so any encoding scans byte for byte; patterns are ASCII. The file is
    // only ever appended to, in bytes, so whatever encoding it has survives.
    const bytes = readBytes(path);
    const text = bytes.toString('latin1');
    const lines = text.split('\n');
    let last = null; // [index, ignores?] of the last line naming the directory
    lines.forEach((raw, i) => {
      // Exactly what git strips: a CR, then trailing spaces (U+0020) — never tabs or other
      // whitespace, and never leading ones.
      const line = raw.replace(/\r$/, '').replace(/ +$/, '');
      if (EQUIVALENT_ENTRY.test(line)) last = [i, true];
      else if (line.startsWith('!') && EQUIVALENT_ENTRY.test(line.slice(1))) last = [i, false];
    });
    if (last && last[1]) {
      console.log(`.gitignore: already ignores ${ENTRY} (line ${last[0] + 1}: ${lines[last[0]].trim()}) — nothing to add.`);
    } else {
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const sep = text === '' || text.endsWith('\n') ? '' : eol;
      try {
        appendFileSync(path, `${sep}${ENTRY}${eol}`);
      } catch (err) {
        failed(`could not write ${path}: ${err.message}`);
      }
      console.log(`.gitignore: added ${ENTRY} — ${why}.`);
      if (last) console.log(`  Line ${last[0] + 1} (${lines[last[0]].trim()}) negated it; the new entry comes after it and wins.`);
      changed = true;
    }
  }
  const claude = join(root, 'CLAUDE.md');
  if (!existsSync(claude)) {
    console.log('? No CLAUDE.md — could not verify that the project asks to delegate. Generate it from ae-kit-templates/CLAUDE.md.template.');
    return { changed, code: 3 };
  }
  // Only reading. UTF-8 when it decodes cleanly, so listed lines keep their accents;
  // otherwise latin1, which still finds the ASCII line in any encoding.
  const raw = readBytes(claude);
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    decoded = raw.toString('latin1').replace(/^\xEF\xBB\xBF/, '');
  }
  const lines = decoded.split('\n');
  const found = findDelegationLines(lines);
  if (found.length !== 1) return { changed, code: cannotVerify(lines, found, 'that CLAUDE.md asks to delegate') };
  console.log(`CLAUDE.md: not touched — it carries the delegation line (line ${found[0][0] + 1}).`);
  return { changed, code: 0 };
}

function main() {
  const { policy, root } = parseArgs(process.argv.slice(2));
  let isDir = false;
  try {
    isDir = statSync(root).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) reject(`${root} is not a directory — pass the project root with --root`);

  if (policy === 'other') {
    console.log('Policy "other": nothing touched — neither the delegation line in CLAUDE.md nor .gitignore.');
    console.log('  Whether the project keeps that line, and ignores .claude/worktrees/, is for the owner to decide.');
    process.exit(0);
  }
  const { changed, code } = policy === 'single' ? applySingle(root) : applyDelegate(root);
  if (code === 0 && !changed) console.log(`Nothing to do: already consistent with the "${policy}" policy.`);
  process.exit(code);
}

main();
