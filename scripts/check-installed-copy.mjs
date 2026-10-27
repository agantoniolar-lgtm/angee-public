#!/usr/bin/env node
/**
 * check-installed-copy.mjs — the installed copy of the kit never drifts from its source.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────
 * Installing the kit onto the kit's own repo creates a SECOND copy of every skill, script
 * and template inside the same repo, and nothing keeps the two in sync. Editing the
 * installed copy instead of the source is a silent error: what gets published comes from
 * `kit/`, so the change never reaches any project and the repo behaves differently from
 * what it distributes. This checker is the only thing that looks at both copies at once.
 *
 * The worst case is `scripts/`: `open-session` runs `scripts/*.mjs` — the copy — so a stale
 * copy means this repo verifies itself with rules it has already changed.
 *
 * ── Three states, and why three rather than two ────────────────────────────────────────
 * An installed file can be present and identical (passes), present and diverged (fails), or
 * DELIBERATELY ABSENT. The third exists because the repo producing the kit doesn't use all
 * of it: with no database and no UI, `verify-rls`, `verify-ui`, `design` and several scripts
 * are not installed there — and without that state, every deliberate exclusion would read as
 * a broken copy. The exclusion list is this checker's input, not a footnote.
 *
 * ── Two lists, and why two ────────────────────────────────────────────────────────────
 * One path per line, relative to the project root, each with its reason. A directory
 * (trailing `/`) covers everything under it.
 *
 *   `.ae-kit-excluded` — pieces OF THE KIT this project doesn't use:
 *       .claude/skills/verify-ui/   # no UI, and there never will be
 *       scripts/emit-lessons.mjs    # this repo receives the channel, it doesn't emit
 *
 *   `.ae-kit-local` — the project's OWN files that live in kit-owned folders:
 *       .claude/skills/my-skill/    # this repo's own skill, never came from the kit
 *
 * They started as a single list, and that merge cost an entire row of the approved decision
 * table: with one file, a stale copy of a skill the kit had renamed was declared, absent
 * from the source, and passed silently in both tools. A declaration that means two things
 * can verify neither of them.
 *
 * The reason is MANDATORY in both. It doesn't close off abuse — adding a path to silence a
 * real divergence has no mechanical defence, these are text files somebody edits — but it
 * makes it more expensive and leaves it legible in the diff. That is recorded as an accepted
 * risk rather than pretended solved. What IS mechanical: claiming in `.ae-kit-local`
 * something the kit does ship fails, because that is the shortcut that would take a file out
 * of the comparison entirely.
 *
 * ── What it does NOT reimplement ──────────────────────────────────────────────────────
 * The destination-vs-source comparison already exists in the installer's plan (`install.sh`
 * classifies every kit file as new, identical or to replace), and the executable-bit criterion in the `case` that same loop uses to
 * restore it. Here the bit is compared SOURCE AGAINST DESTINATION instead of deciding all
 * over again which files deserve `+x`: if the source is executable and the copy isn't, the
 * copy is broken even when the bytes match.
 *
 * Exit codes:
 *   0  the installed copy matches its source, and absences are declared
 *   1  divergence, an undeclared missing piece, an excluded piece present, or a lying list
 *   2  could not check — there is no `kit/` source next to the copy
 *   3  the kit is not installed in this project (a state, not a defect)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();

// ── The source ───────────────────────────────────────────────────────────────────────
// This checker only makes sense where source and copy live in the same tree, which is the
// situation of the repo that produces the kit. In a project that merely consumes the kit
// there is no `kit/` to compare against, and saying so is more honest than inventing a check.
const kitDir = join(root, 'kit');
if (!existsSync(join(kitDir, '.claude', 'skills'))) {
  console.error(`✗ There is no kit source at ${kitDir}`);
  console.error('  This check compares the installed copy against the source living in the');
  console.error('  SAME repo. Without both, there is nothing to compare.');
  process.exit(2);
}

// ── The mappings, taken from the four `install_tree` calls in install.sh ─────────────
// The destination does not preserve the source path: `kit/templates/` installs as
// `ae-kit-templates/`, and `kit/scripts/` loses its folder. Assuming the path is preserved
// would produce a false "everything is missing".
const TREES = [
  { src: join(kitDir, '.claude', 'skills'), dest: '.claude/skills', ownedByKit: true },
  { src: join(kitDir, '.claude', 'agents'), dest: '.claude/agents', ownedByKit: true },
  { src: join(kitDir, 'templates'), dest: 'ae-kit-templates', ownedByKit: true },
  // `scripts/` is the mixed case: it holds kit copies AND the repo's own source. That is
  // why orphans are not looked for there — see below.
  { src: join(kitDir, 'scripts'), dest: 'scripts', ownedByKit: false },
];

// What the kit holds but NEVER sends to a project. The same rule lives in `install.sh`
// (the `case` on `scripts/test-*.sh` inside `install_tree`), and has to keep living in
// both: if the installer stops sending something this checker still expects, every project
// gets reported as an incomplete install over a file nobody wanted.
// The suite's integration block installs for real and checks that the two still agree.
const NEVER_INSTALLED = [
  /^scripts\/test-.*\.sh$/,
  // This very checker. It reads kit/, which exists only in the repo producing the kit; in any
  // other project it exits 2 forever. A verifier that cannot answer where it lands is worse
  // than absent — it teaches the project to ignore an exit code.
  /^scripts\/check-installed-copy\.mjs$/,
  // A step of installing, not a piece of what gets installed: install.sh runs it from the
  // kit it cloned, to declare the SubagentStop hook, and a project never calls it again.
  // install_tree's `case` holds the same rule; if the two stop matching, this checker
  // reports as missing something the installer deliberately never sends.
  /^scripts\/merge-claude-hook\.mjs$/,
];
const neverInstalled = (destRel) => NEVER_INSTALLED.some((re) => re.test(destRel));

// ── Generated pieces ─────────────────────────────────────────────────────────────────
// What the installer WRITES without any source file existing in kit/. They are the
// exception to two of this checker's rules, which is why the set is explicit and short
// rather than a heuristic: (1) bytes are not compared, because there is nothing to compare
// against; (2) declaring them in `.ae-kit-excluded` is not a phantom exclusion, even though
// the kit does not ship them as files. Without that second exception, excluding the marker
// — the deliberate choice of the repo that produces the kit, where its own VERSION is
// already the truth — fell into the phantom row and the checker rejected the very
// declaration the installer obeys.
// What IS still verified is presence against declaration, the only thing checkable here:
// declared and present fails, undeclared and absent fails.
const GENERATED = ['.ae-kit-version'];
// Generated too, but ABSENCE is a legitimate state, so it is not a missing piece: the
// installer writes `.ae-kit-manifest` only on a clean install (D012 in T130), and every
// project installed before it existed has none. The project's own verifier is what warns
// about a missing manifest; here the only rules left are the two list exceptions — declaring
// it out is not a phantom, declared and present means delete it, and claiming it as the
// project's own in `.ae-kit-local` is the same shortcut as for the marker.
const GENERATED_OPTIONAL = ['.ae-kit-manifest'];

// ── Lines in the project's own files ─────────────────────────────────────────────────
// The installer also appends ONE line to a file that belongs to the project:
// `.gitattributes`, which gets the task-log merge attribute. There is no kit copy to
// compare and the file is the project's, so presence proves nothing either way. The only
// rule it is an exception to is the phantom one: declaring it in `.ae-kit-excluded` is how
// a project keeps its own merge rule for task logs, and the installer obeys that line.
const PROJECT_FILE_LINES = ['.gitattributes'];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// ── The two lists, which say different things ────────────────────────────────────────
// `.ae-kit-excluded` — pieces OF THE KIT this project doesn't use. They must exist in the
//                      kit; if they don't, the declaration is rotten (a phantom).
// `.ae-kit-local`    — the project's OWN files living in kit folders. They must NOT exist
//                      in the kit; if they do, somebody is claiming as theirs something the
//                      kit provides, and that would hide a real divergence.
//
// They started as one list, and that merge cost a whole row of the decision table: by
// letting an exclusion also mean "this one is mine", a file that was installed, declared,
// and absent from the kit — the stale copy of a renamed skill — passed silently, invisible
// to both tools. A declaration that means two things can verify neither.
//
// `install.sh` obeys the first, and reads the second only to decide what it does not retire:
// a file declared there is never removed as one the kit dropped. It never stops a kit file
// from being written — a local file is, by definition, at a path the kit does not ship.
const malformed = [];

// ── Format rules, deliberately simple ──────────────────────────────────────────────
// This same parsing lives in `install.sh` (in bash), because the installer has to obey the
// list or a declared absence isn't a stable state. Two parsers reading the same line
// differently reproduce the red loop the list exists to eliminate, and silently at that:
// the checker says "delete them", the person deletes them, the next install revives them,
// and neither tool mentions the line's format. Hence rules that are the minimum replicable
// without ambiguity in both languages — no backtracking expressions:
//   1. separator = the FIRST occurrence of `#`, `—` or `--`
//   2. path = what comes before, trimmed; reason = what comes after
//   3. no separator, no reason, or a path with spaces → malformed, and not obeyed
//   4. a leading `./` is normalized
// `test-installed-copy.sh` runs a format matrix against BOTH programs and requires them to
// agree; without that test, this drifts again the moment somebody touches one of them.
function parseDeclList(file, label) {
  const entries = [];
  if (!existsSync(file)) return entries;
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = i + 1;
    const text = raw.trim();
    if (!text || text.startsWith('#')) return;

    const sep = [text.indexOf('#'), text.indexOf('—'), text.indexOf('--')]
      .filter((n) => n >= 0);
    if (sep.length === 0) {
      malformed.push([label, line, text.split(/\s+/)[0], 'declares no reason']);
      return;
    }
    const at = Math.min(...sep);
    const path = text.slice(0, at).trim().replace(/^\.\//, '');
    const reason = text.slice(at).replace(/^(#|—|--)/, '').trim();

    if (!path || /\s/.test(path)) {
      malformed.push([label, line, path || text, 'the path is empty or contains spaces']);
      return;
    }
    if (!reason) {
      malformed.push([label, line, path, 'the reason is empty']);
      return;
    }
    entries.push({ path, isDir: path.endsWith('/'), reason, line, used: false });
  });
  return entries;
}

const exclusions = parseDeclList(join(root, '.ae-kit-excluded'), '.ae-kit-excluded');
const locals = parseDeclList(join(root, '.ae-kit-local'), '.ae-kit-local');

const matchIn = (list, relPath) => {
  for (const e of list) {
    if (e.isDir ? relPath.startsWith(e.path) : relPath === e.path) return e;
  }
  return null;
};
// The task log's pieces cannot be declared out (T054): the skills write through them.
// install.sh installs them over a declaration, with the same list; here a declaration for
// one of them is ignored, so the piece is compared like any other and its absence is an
// incomplete install, not a declared one.
const REQUIRED = new Set([
  'scripts/task-log.mjs', 'scripts/task-log-append.mjs', 'scripts/check-task-log.mjs',
  'scripts/generate-task-log-view.mjs', 'ae-kit-templates/task-log-ontology.md',
]);
const ignoredExclusions = []; // [path, reason] declared out but required
const exclusionFor = (relPath) => {
  const e = matchIn(exclusions, relPath);
  if (e && REQUIRED.has(relPath)) {
    e.used = true; // it matches a kit piece, so it is not a phantom
    ignoredExclusions.push([relPath, e.isDir ? e.path : null]);
    return null;
  }
  return e;
};
const localFor = (relPath) => matchIn(locals, relPath);

// ── Is it installed? ─────────────────────────────────────────────────────────────────
// `.ae-kit-version` is not used as the signal: in the repo that produces the kit that
// marker is deliberately excluded (its own VERSION is already the truth), so its absence
// says nothing. `scripts/` is no signal either — it exists there with no kit installed.
const installedMarkers = ['.claude/skills', '.claude/agents', 'ae-kit-templates'];
const isInstalled = installedMarkers.some((d) => existsSync(join(root, d)));

if (!isInstalled) {
  console.log(`\n  The kit is not installed at ${root}.`);
  console.log('  There is no copy to verify — this is a state, not a defect.');
  console.log('  (Said once, instead of reporting every kit file as missing.)\n');
  process.exit(3);
}

// ── The walk ─────────────────────────────────────────────────────────────────────────
const diverged = [];    // copy differs from source
const missing = [];     // undeclared and absent
const shouldNotBe = []; // excluded but present
const orphans = [];     // installed and absent from the kit
const modeBroken = [];  // same bytes, lost permission
const claimed = [];     // declared "mine" in .ae-kit-local, but the kit does ship it
const okCount = { same: 0, declared: 0, local: 0, generated: 0 };
const foreign = [];     // the repo's own source living alongside in scripts/

const expectedDest = new Set();

for (const tree of TREES) {
  for (const srcFile of walk(tree.src)) {
    const rel = relative(tree.src, srcFile);
    const destRel = `${tree.dest}/${rel}`;
    const destAbs = join(root, destRel);
    if (neverInstalled(destRel)) continue;
    expectedDest.add(destRel);

    // Claiming as your own something the kit does ship is how you silence a real
    // divergence unnoticed: the file would stop being compared against its source.
    const mine = localFor(destRel);
    if (mine) {
      mine.used = true;
      claimed.push([destRel, mine.reason]);
      continue;
    }

    const ex = exclusionFor(destRel);
    if (ex) ex.used = true;

    if (!existsSync(destAbs)) {
      if (ex) okCount.declared++;      // the declared absence
      else missing.push(destRel);      // incomplete install
      continue;
    }

    // Present. If it was excluded, the defect is its PRESENCE, and the fix is to delete it.
    // Telling someone to sync a file that shouldn't exist sends them to do the opposite of
    // the right thing — which is why this case wins over divergence.
    if (ex) {
      shouldNotBe.push([destRel, ex.reason]);
      continue;
    }

    const srcBuf = readFileSync(srcFile);
    const destBuf = readFileSync(destAbs);
    if (!srcBuf.equals(destBuf)) {
      diverged.push(destRel);
      continue;
    }

    // Same bytes. The mode is compared against the source instead of deciding all over
    // again what deserves +x: that rule already lives in `install_tree`'s `case`, and
    // duplicating it would let the two drift apart.
    const srcExec = (statSync(srcFile).mode & 0o111) !== 0;
    const destExec = (statSync(destAbs).mode & 0o111) !== 0;
    if (srcExec && !destExec) {
      modeBroken.push(destRel);
      continue;
    }
    okCount.same++;
  }
}

// ── The generated pieces ─────────────────────────────────────────────────────────────
// Same scheme as the loop above, minus the "identical" dimension: there is no source here.
// Four states remain, and all four say something:
//   undeclared + present  → passes, the normal case for any project
//   undeclared + absent   → fails: the installer never stamped it (an incomplete or refused
//                           install), and passing green would hide that
//   declared   + absent   → passes, the declared absence
//   declared   + present  → fails, and the fix is to delete it
for (const rel of GENERATED) {
  const abs = join(root, rel);
  const present = existsSync(abs);

  // The wrong list silences nothing: the kit does provide this piece — it generates it —
  // so claiming it as your own is the same shortcut `claimed` exists to close.
  const mine = localFor(rel);
  if (mine) { mine.used = true; claimed.push([rel, mine.reason]); continue; }

  const ex = exclusionFor(rel);
  if (ex) ex.used = true;

  if (!present) {
    if (ex) okCount.declared++;
    else missing.push(rel);
    continue;
  }
  if (ex) shouldNotBe.push([rel, ex.reason]);
  else okCount.generated++;
}
for (const rel of GENERATED_OPTIONAL) {
  const present = existsSync(join(root, rel));
  const mine = localFor(rel);
  if (mine) { mine.used = true; claimed.push([rel, mine.reason]); continue; }
  const ex = exclusionFor(rel);
  if (ex) ex.used = true;
  if (!present) {
    if (ex) okCount.declared++;
    continue;
  }
  if (ex) shouldNotBe.push([rel, ex.reason]);
  else okCount.generated++;
}

// ── Orphans ──────────────────────────────────────────────────────────────────────────
// Only in the trees that belong entirely to the kit. `scripts/` is skipped on purpose:
// there, kit copies and the repo's own source live together with nothing to tell them
// apart, and reporting the project's own script as an orphan would be a false positive.
// Accepted, undisguised consequence: a kit script deleted from the source is not detected
// in `scripts/`.
//
// `.ae-kit-local` is the door through which a project declares "this is mine, not the
// kit's". Without it, `.claude/skills/` and `.claude/agents/` were assumed to be 100% kit
// — precisely the folders where a project adds its own skills — and a local skill came out
// reported as an orphan with instructions to delete it, with no way to declare it.
//
// ONLY that list is consulted here, never `.ae-kit-excluded`: if an exclusion also silenced
// orphans, the case of a file that is installed, declared, and absent from the kit — the
// stale copy of a renamed skill — would pass silently again. Excluding a kit piece and
// declaring a file of your own are different claims, and they are verified differently.
for (const tree of TREES.filter((t) => t.ownedByKit)) {
  for (const destFile of walk(join(root, tree.dest))) {
    const destRel = relative(root, destFile);
    if (expectedDest.has(destRel)) continue;
    const mine = localFor(destRel);
    if (mine) { mine.used = true; okCount.local++; continue; }
    orphans.push(destRel);
  }
}
if (existsSync(join(root, 'scripts'))) {
  for (const f of walk(join(root, 'scripts'))) {
    const destRel = relative(root, f);
    if (!expectedDest.has(destRel)) foreign.push(destRel);
  }
}

// ── Phantom exclusions ───────────────────────────────────────────────────────────────
// They declare as excluded something the kit no longer has. The defect is in the list, not
// in the repo — and without this the list fills with dead exclusions, each hiding something.
const phantom = exclusions.filter((ex) => {
  if (ex.used) return false;
  if (PROJECT_FILE_LINES.includes(ex.path)) return false;
  if (ex.isDir) return ![...expectedDest].some((d) => d.startsWith(ex.path));
  return !expectedDest.has(ex.path);
});

// `.ae-kit-local` declarations that match no real file. They do no harm the way a phantom
// exclusion does — they hide no kit piece — but they are just as dead, and a list that
// accumulates no-op lines stops being read.
const staleLocal = locals.filter((l) => !l.used);

// ── Report ───────────────────────────────────────────────────────────────────────────
// The whole report is accumulated and emitted on ONE stream. Mixing them — detail on
// stdout, verdict on stderr — meant that in a CI log the summary appeared BEFORE what it
// summarizes, because the two interleave as they flush. The report is this tool's only
// product; it being readable in order is not cosmetic.
const out = [];
const say = (s = '') => out.push(s);

say(`\n  Installed copy vs. source in kit/   (${root})\n`);
say(`  ✓ identical:            ${okCount.same}`);
say(`  ✓ absent, declared:     ${okCount.declared}`);
if (ignoredExclusions.length) {
  say(`  ⚠ declared out, but required — the declaration is ignored (${ignoredExclusions.length}):`);
  for (const [p, dir] of ignoredExclusions) {
    say(dir ? `      ${p} — covered by the folder line "${dir}": keep that line, nothing to do`
            : `      ${p} — remove its line from .ae-kit-excluded`);
  }
  say('    The skills write to the task log through these, so they are always installed.');
}
if (okCount.local) say(`  ✓ project's own, declared: ${okCount.local}`);
// It is named "no source" and not folded into the identical count: nothing was compared,
// and a count that promises more than it measured is the kind of green that teaches people
// to stop reading the report.
if (okCount.generated) say(`  ✓ generated (no source to compare): ${okCount.generated}`);
// "the repo's own" would be a positive claim this script cannot support: a stale kit copy
// left behind after a rename lands in the same pile, and `open-session` would keep running
// it while the report labels it as the repo's own source. It states only what is actually
// known.
if (foreign.length) say(`  · not recognized as kit copies: ${foreign.length} in scripts/`);

const problems =
  diverged.length + missing.length + shouldNotBe.length + orphans.length +
  modeBroken.length + phantom.length + malformed.length + claimed.length +
  staleLocal.length;

if (diverged.length) {
  say(`\n  ✗ Diverged — the copy says something different from the source (${diverged.length}):`);
  for (const p of diverged) say(`      ${p}`);
  say('    Fix: reinstall the kit. If the good change is in the copy, move it to');
  say('    kit/ first — what gets published comes from there, not from here.');
}
if (modeBroken.length) {
  say(`\n  ✗ Missing the executable bit, with identical bytes (${modeBroken.length}):`);
  for (const p of modeBroken) say(`      ${p}`);
  say('    Fix: chmod +x. It fails the moment somebody tries to run it, which is');
  say('    always the worst moment.');
}
if (missing.length) {
  say(`\n  ✗ Missing, undeclared (${missing.length}):`);
  for (const p of missing) say(`      ${p}`);
  say('    Fix: install it, or declare it in .ae-kit-excluded with its reason.');
  say('    A half install that passes green is worse than one that fails.');
}
if (shouldNotBe.length) {
  say(`\n  ✗ Declared out, but installed (${shouldNotBe.length}):`);
  for (const [p, why] of shouldNotBe) say(`      ${p}\n        declared out: ${why}`);
  say('    Fix: DELETE THEM. Do not sync them — the list says they do not belong here.');
}
if (orphans.length) {
  say(`\n  ✗ Orphans — installed here and absent from the kit (${orphans.length}):`);
  for (const p of orphans) say(`      ${p}`);
  say("    Fix: if it came from the kit and the source dropped it, delete it. If it is");
  say("    yours and not the kit's, declare it in .ae-kit-local with its reason — you");
  say("    will not be asked to delete it.");
}
if (claimed.length) {
  say(`\n  ✗ Declared as the project's own in .ae-kit-local, but the kit DOES ship them (${claimed.length}):`);
  for (const [p, why] of claimed) say(`      ${p}\n        declared own: ${why}`);
  say('    Fix: remove them from .ae-kit-local. Claiming as yours something the kit');
  say('    provides takes it out of the comparison, and that is where a real divergence');
  say('    stops being visible.');
}
if (phantom.length) {
  say(`\n  ✗ Phantom exclusions — the defect is in .ae-kit-excluded (${phantom.length}):`);
  for (const ex of phantom) say(`      line ${ex.line}: ${ex.path} — the kit does not ship that`);
  say('    Fix: remove them. A list of dead exclusions hides the ones that matter.');
  say('    If what you meant was to declare a file of your own, it goes in .ae-kit-local.');
}
if (staleLocal.length) {
  say(`\n  ✗ Dead declarations in .ae-kit-local (${staleLocal.length}):`);
  for (const l of staleLocal) say(`      line ${l.line}: ${l.path} — there is no file there`);
  say('    Fix: remove them. A list that accumulates no-op lines stops being read.');
}
if (malformed.length) {
  say(`\n  ✗ Declarations with no reason (${malformed.length}):`);
  for (const [label, line, path, why] of malformed) say(`      ${label} line ${line}: ${path} — ${why}`);
  say('    Fix: write down why. A declaration with no reason is a silence, and six weeks');
  say('    from now it is indistinguishable from an oversight.');
}

if (problems === 0) {
  say('\n✓ The installed copy matches its source, and every absence is declared.\n');
  console.log(out.join('\n'));
  process.exit(0);
}

say(`\n✗ ${problems} problem(s) between the installed copy and its source.`);
say('  This repo produces the kit: if its own copy drifts, it publishes one thing and runs another.\n');
console.error(out.join('\n'));
process.exit(1);
