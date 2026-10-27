#!/usr/bin/env node
/**
 * collect-subagent.mjs — the entry point that saves one subagent's dispatch prompt and final
 * reply into the repo. The logic lives in `subagent-collector.mjs`; this file is only the way
 * in, and it ALWAYS runs.
 *
 * Two ways in, one code path:
 *   · As a `SubagentStop` hook — the payload arrives as JSON on stdin. Measured against Claude
 *     Code 2.1.276: it carries `agent_transcript_path`, `agent_id`, `agent_type` and `cwd`
 *     (see docs/medicion-hook-subagent-stop.md in the repo that produces this kit).
 *   · By hand — `node collect-subagent.mjs --transcript <path> [--root <dir>]`.
 *
 * There is deliberately no `if (this file is the one being run)` guard here. Such a guard has
 * to compare the path Node was handed with the path this module resolved to, and those two
 * disagree whenever the script is reached through a symlink (on macOS `/tmp` is one) or
 * through a name carrying a space or an accent. When they disagree the process starts, runs
 * nothing, prints nothing and exits 0 — indistinguishable from a successful collection, which
 * is the exact failure this collector exists to prevent. Splitting the CLI away from the
 * library removes the need for the question: nothing imports this file, so running it is the
 * only thing it can be asked to do.
 *
 * It never fails loudly. A logging mechanism that can take down the session it is logging
 * costs more than it is worth and gets uninstalled the first day it breaks, so every failure
 * is caught, written to `logs/subagents/collector-errors.log`, and the exit code stays 0.
 *
 * A saved transcript can carry a secret — a subagent that read `.env` and quoted it. Nothing
 * here filters that: the pre-commit's `gitleaks protect --staged` scans `logs/subagents/`
 * like any other staged file and blocks the commit. When it does:
 *   1. Replace the value in the saved file with a visible `[REDACTED — rotated YYYY-MM-DD]`.
 *   2. Rotate the credential at its provider. Redacting the file does not un-leak it (R16).
 *   3. `git add` the redacted file — the scan reads what is staged, not the working tree — and
 *      commit again. Never skip the hooks to get past it.
 * The hook only blocks where gitleaks is installed; without it the hook warns and lets the
 * commit through, and the CI scan (R9) catches the secret only after it reached the remote.
 *
 * Where it writes. A subagent that worked in a linked worktree reports that worktree as its
 * `cwd`, and the worktree is deleted once its work is integrated — taking the record with it.
 * So, unless `--root` names a folder by hand, the root is the repo's MAIN working tree: the
 * parent of the common `.git`, asked of git for the subagent's own directory. Only an answer
 * that checks out is used — an absolute path that exists, whose parent is a real working tree
 * with that `.git` as its git directory. Anything else (a git too old for `--path-format`, a
 * bare repo, a submodule, `--separate-git-dir`, a deleted `cwd`, no git on PATH) falls back to
 * the folder it would have used before, and the fallback is noted in that root's
 * `collector-errors.log`, so a lost record is never silent again. A directory outside any git
 * repo is the ordinary case, not a failure, and is not noted.
 */

import { readFileSync, mkdirSync, appendFileSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectSubagent } from './subagent-collector.mjs';

// ── Failure goes somewhere findable, and nowhere else ────────────────────────────────
function noteFailure(root, err) {
  try {
    const dir = join(root, 'logs', 'subagents');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'collector-errors.log'),
      `${new Date().toISOString()} collect-subagent: ${err?.stack ?? err}\n`, 'utf8');
  } catch { /* if even this fails, the session still must not notice */ }
}

// ── The root: the main working tree, or the folder it would have been before ────────────
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const real = (p) => { try { return realpathSync(p); } catch { return null; } };

// Git is asked about the directory it is pointed at, never about this process's environment:
// a hook can inherit GIT_DIR or GIT_WORK_TREE from whatever ran it, and git would then answer
// for that repo instead of the subagent's.
const GIT_ENV = (() => {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[k];
  // "not a git repository" is matched below; a translated git would say it otherwise.
  env.LC_ALL = 'C';
  return env;
})();

function revParse(dir, args) {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', ...args],
      { env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    return { ok: true, lines: out.split('\n').filter((l) => l !== '') };
  } catch (err) {
    return { ok: false, missing: err?.code === 'ENOENT', stderr: String(err?.stderr || err?.message || '') };
  }
}

// Returns { root, fallback }: `fallback` is why the main tree was not used, or null when it
// was — or when there is no repo at all, which is the ordinary case and not worth a note.
function resolveRoot(candidates) {
  const given = candidates.filter(Boolean);
  // A deleted worktree is not recreated just to hold a record nobody will look for there.
  const start = given.find(isDir);
  if (!start) return { root: given[0] ?? '.', fallback: 'no existing directory to resolve from' };
  const gone = start === given[0] ? '' : `${given[0]} does not exist; `;
  const fall = (why) => ({ root: start, fallback: gone + why });

  const common = revParse(start, ['--git-common-dir']);
  if (!common.ok) {
    if (common.missing) return fall('git is not on PATH');
    if (/not a git repository/i.test(common.stderr)) return { root: start, fallback: gone || null };
    return fall(`git rev-parse failed: ${common.stderr.trim().split('\n')[0]}`);
  }
  // A git older than 2.31 echoes `--path-format=absolute` back instead of honouring it, so
  // anything but one absolute path that exists is not an answer.
  const [dotgit] = common.lines;
  if (common.lines.length !== 1 || !isAbsolute(dotgit) || !isDir(dotgit)) {
    return fall(`git did not answer with one absolute existing path: ${JSON.stringify(common.lines)}`);
  }
  const main = dirname(dotgit);
  // The parent has to be a working tree whose git directory IS that common `.git`. A bare
  // repo, a submodule's `.git/modules/<name>` and a `--separate-git-dir` all fail this, so a
  // record is never written next to a git directory.
  const check = revParse(main, ['--git-dir', '--show-toplevel']);
  if (!check.ok || check.lines.length !== 2
      || real(check.lines[0]) !== real(dotgit) || real(check.lines[1]) !== real(main)) {
    return fall(`${main} is not the working tree of ${dotgit}`);
  }
  return { root: main, fallback: gone || null };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--transcript') out.transcriptPath = argv[++i];
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--type') out.agentType = argv[++i];
    else if (a === '--description') out.description = argv[++i];
    else if (a === '--id') out.agentId = argv[++i];
  }
  return out;
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

const args = parseArgs(process.argv.slice(2));
let payload = {};
if (!args.transcriptPath) {
  const raw = readStdin().trim();
  if (raw) { try { payload = JSON.parse(raw); } catch { payload = {}; } }
}

let here; try { here = process.cwd(); } catch { here = undefined; }
let root = args.root;
if (!root) {
  try {
    const res = resolveRoot([payload.cwd, process.env.CLAUDE_PROJECT_DIR, here]);
    root = res.root;
    if (res.fallback) noteFailure(root, `root fallback, using ${root}: ${res.fallback}`);
  } catch (err) {
    root = payload.cwd || process.env.CLAUDE_PROJECT_DIR || here || '.';
    noteFailure(root, err);
  }
}
try {
  const res = collectSubagent({
    transcriptPath: args.transcriptPath || payload.agent_transcript_path,
    root,
    agentType: args.agentType || payload.agent_type,
    agentId: args.agentId || payload.agent_id,
    description: args.description,
    sessionId: payload.session_id,
    lastAssistantMessage: payload.last_assistant_message,
  });
  // Silent in hook mode: anything printed here shows up mid-session as if the agent had
  // said it. By hand, the person running it wants to know what happened.
  if (args.transcriptPath) {
    if (res.status === 'written') console.log(`✓ ${res.dir}`);
    else if (res.status === 'version') console.log(`✓ new version: ${res.path}`);
    else if (res.status === 'already') console.log(`· already collected: ${res.dir}`);
    else console.log('· no transcript on disk; nothing written');
  }
} catch (err) {
  noteFailure(root, err);
  if (args.transcriptPath) console.log(`· failed, noted in logs/subagents/collector-errors.log: ${err.message}`);
}
process.exit(0);
