#!/usr/bin/env node
/**
 * check-kit-current.mjs — is this project running the current kit?
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 * A kit that improves while its projects stay on old copies is a kit that improves for
 * nobody. That was the measured state: one project sat two weeks behind, flagged once and
 * still open. The push half of the return channel (projects send lessons up) is useless
 * without the pull half (projects actually receive what those lessons changed).
 *
 * ── Why it asks the REMOTE, and why that is the whole point ───────────────────────────
 * Every surface that asked this question before compared `.ae-kit-version` against a
 * `kit/VERSION` file ON LOCAL DISK. That only works on a machine that happens to have the
 * kit checked out next door — which is to say, on exactly one person's laptop. Anywhere
 * else the check silently answered "fine" because the file it wanted to read was absent.
 * A verification that can only succeed in one place is not a verification.
 *
 * With the kit on GitHub, any project on any machine can ask. That is what makes
 * `.ae-kit-version` an actual mechanism instead of a marker nobody reads.
 *
 * ── The rule that governs the awkward cases ───────────────────────────────────────────
 * Not being able to check is NOT the same as checking and finding nothing wrong. Offline,
 * unauthenticated, or missing-marker all report honestly and refuse to claim "current" —
 * the same refusal that makes check-deploy-status.sh withhold a green light when a check
 * has not reported yet.
 *
 * Exit codes:
 *   0  current — the project matches the kit on the remote
 *   1  behind — update before starting work, after setup step 0a
 *   2  could not verify (offline, no gh, not authenticated) — reports, never guesses
 *   3  no .ae-kit-version — kit not installed, or installed from an unknown origin
 *   4  AHEAD of the remote — an anomaly: something local never made it back to the kit
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const repoRoot = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
// The kit is installed from the artifact repo, so drift is measured against that same repo.
// Asking the workshop instead would be asking it about a version it published — and in a
// private repo the project has no reason to have access to, the answer would be "could not
// verify" forever.
const KIT_REPO = process.env.AE_KIT_REPO || 'agantoniolar-lgtm/angee-public';
// The layout differs between the two valid remotes: in the artifact repo the kit sits at
// the root, in the workshop it sits under `kit/`. Both paths are tried instead of assuming
// one — the same criterion install.sh applies after cloning, and for the same reason: both
// remotes are real.
const VERSION_PATHS = ['VERSION', 'kit/VERSION'];

/** Parse the leading semver out of a marker line like "0.19.0 — installed 2026-08-09 …". */
function parseVersion(text) {
  const m = String(text).trim().match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], raw: m[0] } : null;
}

function compare(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

// ── The project's own memory of what it installed ────────────────────────────────────
const markerPath = join(repoRoot, '.ae-kit-version');
if (!existsSync(markerPath)) {
  console.error(
    '✗ There is no .ae-kit-version in this project.\n' +
    '  The kit is not installed, or was installed by a path that left no record.\n' +
    '  No version is guessed: install it, or write the marker with the real version.'
  );
  process.exit(3);
}

const local = parseVersion(readFileSync(markerPath, 'utf8'));
if (!local) {
  console.error(
    `✗ .ae-kit-version exists but holds no readable version.\n` +
    `  Contents: ${readFileSync(markerPath, 'utf8').trim().slice(0, 120)}\n` +
    `  This is reported rather than assuming a version.`
  );
  process.exit(3);
}

// ── What the remote actually says, right now ─────────────────────────────────────────
let remoteRaw;
// Both paths are tried and the first that answers wins. No attempt is made to tell "404
// because the layout is the other one" from "404 because there is no access": both end in
// the same exit 2, which is the honest one — *could not verify* is not *you are current*,
// and that is exactly the confusion this script exists not to make.
for (const VERSION_PATH of VERSION_PATHS) {
  try {
    const encoded = execFileSync(
      'gh',
      ['api', `repos/${KIT_REPO}/contents/${VERSION_PATH}`, '--jq', '.content'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
    remoteRaw = Buffer.from(encoded, 'base64').toString('utf8');
    break;
  } catch { /* try the next path */ }
}
if (remoteRaw === undefined) {
  console.error(
    `○ Could not query ${KIT_REPO} on the remote (tried ${VERSION_PATHS.join(' and ')}).\n` +
    `  Likely cause: no network, no \`gh\`, or no authentication for a private repo.\n` +
    `  ⚠ This does NOT mean the kit is current — it means it could not be verified.`
  );
  process.exit(2);
}

const remote = parseVersion(remoteRaw);
if (!remote) {
  console.error(`○ ${KIT_REPO} returned an unreadable VERSION: ${remoteRaw.trim().slice(0, 80)}`);
  process.exit(2);
}

const delta = compare(local, remote);

if (delta === 0) {
  console.log(`✓ Kit is current — ${local.raw}, same as ${KIT_REPO}.`);
  process.exit(0);
}

if (delta < 0) {
  console.error(
    `✗ Kit is behind: this project has ${local.raw} and the remote is at ${remote.raw}.\n` +
    `  Update BEFORE starting any work — otherwise this session runs against rules that\n` +
    `  already changed, and any lesson it produces is written against a kit that is gone.\n` +
    `  The install OVERWRITES every kit file that differs, edits of this project included:\n` +
    `  first turn each edit into a row of "Local kit adjustments" in CLAUDE.md (setup step 0a,\n` +
    `  ae-kit-templates/local-adjustments.md), then install and commit what it wrote.`
  );
  process.exit(1);
}

console.error(
  `⚠ Kit is AHEAD: this project has ${local.raw} and the remote is at ${remote.raw}.\n` +
  `  That is not being current: it means something was built here and never made it back\n` +
  `  to the kit. It is exactly the symptom the return channel exists to eliminate.`
);
process.exit(4);
