#!/usr/bin/env node
/**
 * check-deploy-verified.mjs — did the last push actually get verified?
 *
 * ── Why this exists, and why it is separate from check-deploy-status.sh ───────────────
 * `check-deploy-status.sh` DOES the verification. This one detects that it never
 * happened. That split is the whole point.
 *
 * Extending the `ship` skill to run the check closes the gap only while the skill is
 * followed — and "the rule existed, nothing ran it" is precisely the defect this
 * capability was built to kill (measured 2026-07-28: zero runs across five commits).
 * A step that has to remember itself is an instruction, not a mechanism.
 *
 * So the debt is made visible instead: every push writes a ledger line, and this script
 * asks whether the commit currently on the remote has one. `open-session` runs it, so an
 * unverified push cannot survive quietly into the next session — the F7 failure mode,
 * where pendings drift with nothing that ever forces them closed.
 *
 * ── Why exit 4 exists: the evidence was never versioned ──────────────────────────────
 * The ledger line for a push is written AFTER `ship` has already committed and pushed,
 * so that line lands in the working tree with nothing left to carry it into git. During a
 * session this self-corrects — each line rides along with the next commit. The last one of
 * a session does not: it stays uncommitted forever. Measured 2026-08-09: the closing
 * commit's own verification line was sitting unstaged, and it was not an oversight, it is
 * how the cycle is built. Every session leaves the proof of its own close unversioned.
 *
 * It cannot be fixed by committing the line at the end, because that new commit must be
 * pushed and verified too (R6), which writes another orphan line. The recursion has to be
 * cut somewhere, and the only cut that needs no exception to R6 is the NEXT session:
 * `open-session` commits the orphan as its first act, so the line travels with that
 * session's work instead of needing a commit of its own.
 *
 * Hence this script distinguishes "never verified" (exit 1) from "verified, but the proof
 * is not in git yet" (exit 4). They are different debts with different fixes, and
 * collapsing them would make the second invisible behind the first.
 *
 * Exit codes:
 *   0  the remote HEAD has a resolved verification line, and the ledger is committed
 *   1  the remote HEAD was pushed and never verified — debt to settle now
 *   2  could not determine remote state (no upstream, no git, detached) — reports, never guesses
 *   4  verified, but the ledger holds uncommitted lines — commit them before new work
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const repoRoot = process.argv[2] ? resolve(process.argv[2]) : process.cwd();

function git(...args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

let upstream, remoteSha, localSha;
try {
  upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
  remoteSha = git('rev-parse', upstream);
  localSha = git('rev-parse', 'HEAD');
} catch {
  console.log('○ No upstream configured — nothing to verify yet.');
  process.exit(2);
}

const ledgerPath = join(repoRoot, 'logs', 'deploy-checks.md');
const short = (sha) => sha.slice(0, 7);

if (!existsSync(ledgerPath)) {
  // No ledger AND nothing pushed yet is a clean new repo, not debt.
  if (remoteSha === localSha) {
    console.error(
      `✗ El commit ${short(remoteSha)} está en ${upstream} y no existe logs/deploy-checks.md.\n` +
      `  That push was never verified. Run check-deploy-status.sh before moving on.`
    );
    process.exit(1);
  }
  // Only "the remote is BEHIND us" is safely nothing to claim. When the remote is ahead
  // — someone else pushed — that commit is on the tracked branch and demonstrably never
  // got verified here, and the old message said the opposite while exiting 0.
  const remoteIsBehind = (() => {
    try { return git('merge-base', '--is-ancestor', remoteSha, localSha) === '' ; }
    catch { return false; }
  })();
  if (remoteIsBehind) {
    console.log('○ No deploy log yet and the remote is behind — nothing to claim.');
    process.exit(0);
  }
  console.error(
    `✗ ${short(remoteSha)} está en ${upstream} y no existe logs/deploy-checks.md.\n` +
    `  That commit did not come from here, or left unverified. Resolve it before moving on.`
  );
  process.exit(1);
}

const ledger = readFileSync(ledgerPath, 'utf8').split('\n');
const entry = ledger.find(
  (line) => line.includes(short(remoteSha)) && /\|\s*exit\s*[03]\s*\|/.test(line)
);

if (entry) {
  console.log(`✓ ${short(remoteSha)} (${upstream}) verificado:`);
  console.log(`    ${entry.trim()}`);

  // Verified is not the same as recorded. The ledger is evidence, and evidence that lives
  // only in a working tree is one `git checkout` away from never having existed.
  let dirty = '';
  try {
    dirty = git('status', '--porcelain', '--', 'logs/deploy-checks.md');
  } catch {
    // Can't ask git about the file — report the verification and stop there rather than
    // claiming a versioning state we couldn't check.
    process.exit(0);
  }

  if (dirty) {
    console.error(
      `\n✗ La bitácora tiene evidencia sin commitear.\n` +
      `  The line proving that verification exists only in the working tree.\n` +
      `  Commit it along with this session's work before starting anything new.`
    );
    process.exit(4);
  }
  process.exit(0);
}

const unresolved = ledger.find((line) => line.includes(short(remoteSha)));
console.error(
  `✗ ${short(remoteSha)} está en ${upstream} sin verificación resuelta.\n` +
  (unresolved
    ? `  There is a line, but not in a resolved state:\n    ${unresolved.trim()}\n`
    : `  There is no line for that SHA in logs/deploy-checks.md.\n`) +
  `  Run check-deploy-status.sh ${short(remoteSha)} and do not move on until it resolves.`
);
process.exit(1);
