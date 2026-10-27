#!/usr/bin/env node
/**
 * recover-subagents.mjs — a one-time sweep for the transcripts that are still on disk.
 *
 * The hook only saves subagents that finish from now on. Everything that ran before it was
 * installed still exists under `~/.claude/projects/…` until Claude Code's cleanup deletes it
 * — 30 days by default, 90 on this machine. This walks what is left and hands each transcript
 * to the same collector the hook uses (`subagent-collector.mjs`), so recovered documents are indistinguishable from
 * saved ones and there is only one place where a naming or truncation decision is made.
 *
 *   node recover-subagents.mjs [--root <repo>] [--projects-dir <dir>] [--dry-run]
 *
 * Safe to run twice: the collector is idempotent, and a second pass reports what was already
 * there instead of making a duplicate. That matters because a recovery IS run twice — once to
 * see what it would do, once for real.
 *
 * Only the transcripts of THIS repo are swept. Claude Code files sessions under a folder named
 * after the project's absolute path, so the sweep starts from the folder belonging to `--root`
 * and never touches another project's history.
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { collectSubagent } from './subagent-collector.mjs';

// How Claude Code names a project's folder: the absolute path with every character that is
// not a letter or a digit turned into a dash. `/Users/me/Dev/ae-setup` becomes
// `-Users-me-Dev-ae-setup`. Derived from the folders on disk, not from documentation.
export const projectFolderName = (root) => resolve(root).replace(/[^a-zA-Z0-9]/g, '-');

// Recursive on purpose. A subagent launched by a workflow is not in `subagents/` but in
// `subagents/workflows/wf_<id>/`, so a flat glob over `subagents/agent-*.jsonl` loses every
// workflow subagent — which is most of them on this repo.
function findTranscripts(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) findTranscripts(full, out);
    else if (e.isFile() && /^agent-.*\.jsonl$/.test(e.name)) out.push(full);
  }
  return out;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i];
    else if (a === '--projects-dir') out.projectsDir = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root ?? process.cwd());
  const projectsDir = args.projectsDir ?? join(homedir(), '.claude', 'projects');
  const projectDir = join(projectsDir, projectFolderName(root));

  console.log(`  Subagent transcript recovery\n`);
  console.log(`  · project: ${root}`);
  console.log(`  · history: ${projectDir}\n`);

  if (!existsSync(projectDir)) {
    console.log('  There is no session history for this project. Nothing to recover.');
    process.exit(0);
  }

  // One level of session folders, each with its own `subagents/`. The session id is the
  // folder name, and it is carried into the saved documents so a recovered transcript names
  // the session it came from just like a hooked one does.
  const found = [];
  for (const session of readdirSync(projectDir)) {
    const subagents = join(projectDir, session, 'subagents');
    let st;
    try { st = statSync(subagents); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const t of findTranscripts(subagents)) found.push({ sessionId: session, transcriptPath: t });
  }

  if (!found.length) {
    console.log('  The history exists, but no subagent transcript is left in it.');
    process.exit(0);
  }

  if (args.dryRun) {
    console.log(`  ${found.length} transcript(s) on disk. With --dry-run nothing is written:\n`);
    for (const f of found) console.log(`    · ${f.transcriptPath}`);
    process.exit(0);
  }

  let written = 0, versions = 0, already = 0, skipped = 0, failed = 0;
  for (const f of found) {
    try {
      const res = collectSubagent({ ...f, root });
      if (res.status === 'written') { written++; console.log(`  ✓ ${res.dir}`); }
      // A subagent already saved that now answers something different: the new answer went
      // beside the old one. Counted apart, because it is neither a recovery nor a no-op.
      else if (res.status === 'version') { versions++; console.log(`  + ${res.path}`); }
      else if (res.status === 'already') already++;
      else skipped++;
    } catch (err) {
      // One unreadable transcript is not a reason to abandon the rest of the recovery.
      failed++;
      console.log(`  ✗ ${f.transcriptPath}\n      ${err.message}`);
    }
  }

  // The "new versions" clause appears only when there are any: a sweep that found nothing new
  // reads exactly as it always has.
  console.log(`\n✓ ${written} recovered, ` + (versions ? `${versions} new versions, ` : '') +
              `${already} already there, ${skipped} with no readable content` +
              (failed ? `, ${failed} with an error` : '') + '.');
  process.exit(0);
}

// No entry-point guard: nothing imports this file, and a guard comparing `process.argv[1]`
// with this module's own path silently does nothing when the script is reached through a
// symlink (`/tmp` on macOS) or a path with a space or an accent. A sweep that prints zero
// lines reads as "there was nothing to recover", which is the worst answer it could give.
main();
