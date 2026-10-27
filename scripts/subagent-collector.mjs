/**
 * subagent-collector.mjs — save what a subagent was told and what it answered, inside the repo.
 *
 * The library half. `collect-subagent.mjs` is the CLI and the `SubagentStop` hook entry point;
 * `recover-subagents.mjs` sweeps transcripts still on disk. Both call `collectSubagent` from
 * here, so a naming or truncation decision is made in exactly one place.
 *
 * This file is a module and nothing else: it has no entry-point guard, because a guard that
 * compares `process.argv[1]` against this file's own path is a silent failure waiting to
 * happen. Called through a symlink (`/tmp` is one on macOS), or through a path holding a
 * space or an accent, the comparison misses and the script exits 0 having done nothing — the
 * one outcome a collector must never produce.
 *
 * Claude Code keeps every subagent's transcript under `~/.claude/projects/…`, outside the
 * repo, and deletes it after `cleanupPeriodDays`. The reviewer reports that are the evidence
 * for a task therefore evaporate: three of them were already lost between a measurement and
 * its verification. This writes two documents per subagent into the project itself, where git
 * keeps them:
 *
 *   logs/subagents/<YYYY-MM-DD>/<HHMM>-<type>[-<workflow>]-<description>-<id>/input.md
 *                                                                            /output.md
 *
 * The same subagent can be saved more than once — the `SubagentStop` hook fires every time a
 * subagent stops, not only when it finishes, and a recovery sweep can catch one while it is
 * still running. The folder is found by the agent's id rather than by the hour in its name,
 * so a later, different answer lands in the folder that already exists, as `output-2.md`,
 * `output-3.md`. Nothing already saved is ever rewritten or renamed.
 *
 * Only the dispatch prompt and the final reply, never the whole transcript. A single reviewer
 * on this repo leaves ~450 KB of tool calls and file reads; git history is not pruned, and the
 * kit installs into projects that did not choose to pay for that.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, appendFileSync } from 'node:fs';
import { join, resolve, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';

// ── Declared limits ──────────────────────────────────────────────────────────────────
// Per FILE, not per folder. 64 KB is far above a normal reviewer report and far below the
// megabytes a long transcript reaches. Over it, the text is cut with a visible marker that
// names the source, so nobody mistakes a truncated document for a short answer.
export const MAX_BYTES = 64 * 1024;
// Per name SEGMENT. Long enough for a real description, short enough that the whole folder
// name stays inside the 255-byte limit every filesystem in use imposes.
const MAX_SEGMENT = 48;

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

// ── Names ────────────────────────────────────────────────────────────────────────────
// A description is written by whoever dispatched the subagent, so it is untrusted text that
// ends up forming a path. Everything outside [a-z0-9-] is dropped, which removes slashes,
// colons, newlines, `..` and absolute paths by construction rather than by blocklist.
// Accents are folded rather than deleted: "Revisión independiente" has to stay readable —
// a folder nobody can read defeats the point of naming it.
function slug(value, fallback) {
  const raw = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let out = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!out) return fallback;
  // Truncating two different descriptions to the same prefix would silently merge two
  // subagents into one folder — data loss dressed up as tidiness. When the name is cut, a
  // digest of the FULL value is appended, so two long descriptions that differ anywhere
  // still differ here.
  if (out.length > MAX_SEGMENT) {
    out = out.slice(0, MAX_SEGMENT).replace(/-+$/, '') + '-' + sha(value).slice(0, 6);
  }
  return out;
}

// The agent id is what makes a folder name unique, and it is why re-running the collector on
// the same transcript lands on the same folder instead of making a second one. Two subagents
// of the same type, with the same description, finishing in the same second — the normal
// shape of parallel review in this kit — still get two folders.
function shortId({ agentId, transcriptPath }) {
  if (agentId) return slug(String(agentId).slice(0, 12), 'id');
  const m = /^agent-([^.]+)\./.exec(basename(transcriptPath ?? ''));
  if (m) return slug(m[1].slice(0, 12), 'id');
  return sha(resolve(transcriptPath ?? 'unknown')).slice(0, 8);
}

// A subagent launched by a workflow is not in `subagents/` but one level down, in
// `subagents/workflows/wf_<id>/`. There is no workflow field in the hook payload — the id
// only exists in the path — so it is read from there and carried into the folder name.
function workflowIdFrom(transcriptPath) {
  const parts = resolve(transcriptPath).split(sep);
  const i = parts.lastIndexOf('workflows');
  if (i === -1 || i + 1 >= parts.length) return null;
  const candidate = parts[i + 1];
  return /^wf[_-]/.test(candidate) ? candidate : null;
}

// ── Reading the transcript ───────────────────────────────────────────────────────────
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n\n');
}

function parseTranscript(raw) {
  const entries = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    // A transcript can be cut mid-write when a session dies. One unparseable line is not a
    // reason to lose the rest of the file.
    try { entries.push(JSON.parse(t)); } catch { /* skip */ }
  }
  return entries;
}

function dispatchPrompt(entries) {
  for (const e of entries) {
    if (e?.type === 'user' && e?.isSidechain === true) {
      const t = textOf(e?.message?.content);
      if (t.trim()) return t;
    }
  }
  return null;
}

// A subagent that hands its report back does so through a tool call, and a tool call is not
// text: the last TEXT in such a transcript is whatever the agent happened to say before the
// handoff ("Now the append suite."). Saving that instead of the report was measured on every
// recent subagent of this repo, so the delivered message wins over the trailing prose.
// Only this one tool counts — any other tool call is work, not an answer.
function handbackMessage(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type !== 'assistant' || e?.isApiErrorMessage) continue;
    const content = e?.message?.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const b = content[j];
      if (b?.type !== 'tool_use' || b?.name !== 'SubagentHandback') continue;
      const m = b?.input?.message;
      // An empty or non-text handback carries nothing; saving it would replace a real answer
      // with a blank file, so it is skipped and the search goes on backwards.
      if (typeof m === 'string' && m.trim()) return m;
    }
  }
  return null;
}

function finalReply(entries) {
  const handed = handbackMessage(entries);
  if (handed !== null) return handed;
  // Walked backwards, because the last line is not reliably the answer: a transcript can end
  // on an API error entry, or on a tool result when the subagent was interrupted mid-step.
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type !== 'assistant') continue;
    if (e?.isApiErrorMessage) continue;
    const t = textOf(e?.message?.content);
    if (t.trim()) return t;
  }
  return null;
}

function endedAt(entries, transcriptPath) {
  // The END time, deliberately, and not the clock at collection time. It is the criterion a
  // subagent that started at 23:59 and finished after midnight is filed under, and it is what
  // makes a re-run months later land in the same folder instead of today's.
  for (let i = entries.length - 1; i >= 0; i--) {
    const ts = entries[i]?.timestamp;
    if (typeof ts === 'string') {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  try { return statSync(transcriptPath).mtime; } catch { return new Date(); }
}

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hourOf = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}`;

// ── Writing ──────────────────────────────────────────────────────────────────────────
function capped(text, source) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= MAX_BYTES) return text;
  const kept = buf.subarray(0, MAX_BYTES).toString('utf8');
  return `${kept}\n\n[truncated by collect-subagent.mjs: kept the first ${MAX_BYTES} of ${buf.length} bytes. ` +
         `The full transcript was at ${source}, until Claude Code's cleanup removed it.]\n`;
}

// Every document says where it came from on its own. Folders get moved and renamed; one that
// only makes sense from its path loses its context in the first reorganization. `source` is
// also what answers "was this collected by hand, pointing somewhere else?" — the answer is
// always written down rather than guessed at.
function header(meta, part) {
  const lines = [
    '---',
    `part: ${part}`,
    `subagent_type: ${JSON.stringify(meta.agentType)}`,
    `agent_id: ${JSON.stringify(meta.agentId ?? '')}`,
    `description: ${JSON.stringify(meta.description ?? '')}`,
  ];
  if (meta.workflowId) lines.push(`workflow: ${JSON.stringify(meta.workflowId)}`);
  if (meta.sessionId) lines.push(`session: ${JSON.stringify(meta.sessionId)}`);
  lines.push(`ended: ${meta.ended.toISOString()}`);
  lines.push(`source: ${JSON.stringify(meta.source)}`);
  lines.push('---', '');
  return lines.join('\n');
}

// ── Finding the folder this subagent already has ─────────────────────────────────────
// The folder name carries the hour the transcript ENDED, and that hour moves: a subagent
// stopped and resumed, or swept while it was still running, ends at a different minute the
// second time and would get a second folder holding the fuller answer, beside the partial one
// instead of with it. The id is what does not move, so the folder is found by id and the hour
// in the name is only ever the hour of the first save.
//
// Every day is searched, not just today's: an agent that stopped at 23:58 and finished at
// 00:03 belongs to the folder it already has.
function foldersWithId(base, id) {
  const suffix = '-' + id;
  const hits = [];
  let days;
  try { days = readdirSync(base, { withFileTypes: true }); } catch { return hits; }
  for (const day of days) {
    // `collector-errors.log`, a `.gitignore`, anything that is not a date folder: skipped.
    // Only a folder inside a date folder can be an agent's folder.
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
    let inner;
    try { inner = readdirSync(join(base, day.name), { withFileTypes: true }); }
    catch (err) {
      // One unreadable day is not a reason to abandon the search and make a duplicate of
      // every agent. It is recorded, and the other days still answer.
      noteError(base, `could not read ${join(base, day.name)}: ${err?.message ?? err}`);
      continue;
    }
    for (const e of inner) {
      // `endsWith` and not `includes`: a description that happens to contain another agent's
      // id must not capture that agent's folder. The id is always the last segment.
      if (e.isDirectory() && e.name.endsWith(suffix)) hits.push(`${day.name}/${e.name}`);
    }
  }
  // Oldest first, day before hour: 2026-09-18 at 23:59 precedes 2026-09-19 at 00:01. Both
  // parts sort lexicographically by construction (YYYY-MM-DD and HHMM).
  hits.sort();
  return hits.map((rel) => resolve(join(base, rel)));
}

function noteError(base, message) {
  try {
    mkdirSync(base, { recursive: true });
    appendFileSync(join(base, 'collector-errors.log'),
      `${new Date().toISOString()} subagent-collector: ${message}\n`, 'utf8');
  } catch { /* the session must not notice, even here */ }
}

// The header is what differs between two saves of the same answer — another hour, another
// source, another session — so comparison looks only at what comes after it.
function bodyOf(text) {
  const m = /^---\n[\s\S]*?\n---\n/.exec(text);
  return (m ? text.slice(m[0].length) : text).replace(/^\n+/, '').replace(/\n+$/, '');
}

function savedBodies(dirs) {
  const bodies = [];
  for (const d of dirs) {
    let names;
    try { names = readdirSync(d); } catch { continue; }
    for (const n of names) {
      if (!/^output(-\d+)?\.md$/.test(n)) continue;
      try { bodies.push(bodyOf(readFileSync(join(d, n), 'utf8'))); } catch { /* skip */ }
    }
  }
  return bodies;
}

/**
 * Collect one subagent. Returns { status, dir } and never throws for a reason the caller
 * cannot act on. status is one of:
 *   'written'        — the two documents were created
 *   'version'        — this subagent already had a folder and answered something different;
 *                      the new answer was written BESIDE the old one, as output-N.md, and
 *                      `path` says which file. Nothing already saved was touched.
 *   'already'        — this subagent was already collected; nothing was touched
 *   'no-transcript'  — the transcript is gone or unreadable; nothing was created
 */
export function collectSubagent(opts) {
  const root = resolve(opts.root ?? process.cwd());
  const transcriptPath = opts.transcriptPath ? resolve(opts.transcriptPath) : null;

  // A folder holding two empty files looks exactly like real evidence and lies in an audit.
  // When the transcript is gone — the cleanup ran, or it was never written — nothing is
  // created at all.
  if (!transcriptPath || !existsSync(transcriptPath)) return { status: 'no-transcript' };
  let raw;
  try { raw = readFileSync(transcriptPath, 'utf8'); } catch { return { status: 'no-transcript' }; }

  const entries = parseTranscript(raw);

  // The description is NOT in the hook payload — only the type is. It lives in the
  // `.meta.json` next to the transcript, so a missing or corrupt meta file is a case that
  // happens, not a defensive one. Losing a transcript over a missing label is the exact
  // outcome this script exists to prevent, so it is saved anyway.
  let meta = {};
  try {
    const metaPath = transcriptPath.replace(/\.jsonl$/, '') + '.meta.json';
    if (existsSync(metaPath)) meta = JSON.parse(readFileSync(metaPath, 'utf8')) ?? {};
  } catch { meta = {}; }

  const agentType = opts.agentType || meta.agentType || null;
  const description = opts.description ?? meta.description ?? null;
  const agentId = opts.agentId || meta.agentId || null;
  const workflowId = workflowIdFrom(transcriptPath);
  const ended = endedAt(entries, transcriptPath);

  const segments = [
    hourOf(ended),
    slug(agentType, 'unknown-type'),
    workflowId ? slug(workflowId, 'workflow') : null,
    slug(description, 'no-description'),
    shortId({ agentId, transcriptPath }),
  ].filter(Boolean);

  const base = join(root, 'logs', 'subagents');
  const fresh = resolve(join(base, dayOf(ended), segments.join('-')));

  // Containment, asserted rather than assumed. Everything above is derived from text written
  // by whoever dispatched the subagent; this is the line that says none of it can decide to
  // write somewhere else.
  if (fresh !== resolve(base) && !fresh.startsWith(resolve(base) + sep)) {
    throw new Error(`refused: the folder would land outside logs/subagents/ (${fresh})`);
  }

  // If this agent already has a folder — from any day — that folder is the one used, and its
  // name never changes: it says when the agent was first saved.
  const existing = foldersWithId(base, shortId({ agentId, transcriptPath }));
  const dir = existing[0] ?? fresh;

  const inputPath = join(dir, 'input.md');
  const outputPath = join(dir, 'output.md');

  const head = {
    agentType: agentType ?? 'unknown', agentId, description, workflowId,
    sessionId: opts.sessionId ?? null, ended, source: transcriptPath,
  };

  const prompt = dispatchPrompt(entries);
  const reply = finalReply(entries) ?? (typeof opts.lastAssistantMessage === 'string' ? opts.lastAssistantMessage : null);

  // An empty file cannot tell "there was no prompt" apart from "saving failed". Both
  // placeholders say which one happened, in the file itself.
  const input = header(head, 'dispatch prompt') +
    (prompt === null
      ? '_The dispatch prompt could not be identified in this transcript: it has no first\n' +
        'sidechain message. Everything else about the subagent is in the header above._\n'
      : capped(prompt, transcriptPath));

  const output = header(head, 'final reply') +
    (reply === null
      ? '_This subagent produced no final reply: it was interrupted, or it ended on an error.\n' +
        'The prompt it was given is in input.md, next to this file._\n'
      : capped(reply, transcriptPath));

  const nl = (s) => (s.endsWith('\n') ? s : s + '\n');

  // Re-running is normal — the recovery sweep gets run twice, and a hook can fire twice after
  // a reinstall. Already collected means nothing is rewritten, so no previously saved folder
  // ever changes in content or in name.
  if (existsSync(inputPath) && existsSync(outputPath)) {
    // A later pass that finds no answer at all would otherwise file the "produced no final
    // reply" notice as if it were a second answer. That notice is only ever worth saving when
    // it is the first thing in the folder.
    if (reply === null) return { status: 'already', dir };
    const body = bodyOf(output);
    // Compared against every answer in every folder this agent has, not just the first one:
    // an agent that already had two folders before this existed must not gain a third copy.
    if (savedBodies(existing.length ? existing : [dir]).includes(body)) return { status: 'already', dir };

    // `wx` refuses to write onto an existing file, so a hook and a sweep racing on the same
    // agent produce output-2 and output-3 rather than one overwriting the other.
    for (let n = 2; n < 1000; n++) {
      const path = join(dir, `output-${n}.md`);
      try {
        writeFileSync(path, nl(output), { encoding: 'utf8', flag: 'wx' });
        return { status: 'version', dir, path };
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err;
      }
    }
    throw new Error(`refused: ${dir} already holds 1000 versions`);
  }

  mkdirSync(dir, { recursive: true });
  // Written only when missing: a folder left half-written by an interrupted save gets the
  // file it lacks, and the one it already has stays byte for byte as it was.
  if (!existsSync(inputPath)) writeFileSync(inputPath, nl(input), 'utf8');
  if (!existsSync(outputPath)) writeFileSync(outputPath, nl(output), 'utf8');
  return { status: 'written', dir };
}
