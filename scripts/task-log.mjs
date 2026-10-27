/**
 * task-log.mjs — the one place that knows the shape of a task log.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 * Three consumers need to turn `logs/tasks/<task-id>.md` into entries: the appender (to
 * know what is valid before it writes), the verifier (to report what is broken) and the
 * view generator (to hide what is resolved). The kit has already paid once for letting
 * two scripts each carry their own copy of a rule — the task index and the migrator both
 * encoded "which statuses are active", and both encoded the same dangerous default. So
 * the format is parsed here, imported everywhere, and re-implemented nowhere.
 *
 * The ontology this enforces is written in prose in `ae-kit-templates/task-log-ontology.md`.
 * That document is what the project owner approves; this file is what obeys it. If they
 * ever disagree, the document wins and this file is the defect.
 *
 * ── What this file deliberately does NOT do ──────────────────────────────────────────
 * It does not write, and it does not answer cross-file questions. Whether a link points
 * at an entry that exists, whether two entries resolve the same one, whether a cycle
 * closes — all of those need every entry read first, and they live in
 * `check-task-log.mjs`. This file answers only "what does this ONE file say, and what
 * about it is malformed?".
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── The closed list ──────────────────────────────────────────────────────────────────
// Seven types. Adding an eighth is a decision by the project owner, taken in the ontology
// document, not a line added here because something did not fit.
//
// `lesson` and `question-for-owner` are absent on purpose: the first goes to
// `lessons/ledger.json`, the second to `PENDINGS.md`. Each already has a channel with its
// own verifier and its own reader, and a record with two homes ends up in neither.
export const TYPES = {
  // A unit's round also carries `unit`, `commit` and `blocking` (T123 U2): the three are
  // optional for the type — an adversarial gap search has no unit — and all-or-none, because
  // integrate-unit.mjs counts a round only with the three, and a round with two would look
  // like a review that cleared something while clearing nothing.
  'review-round':   { required: ['by', 'result'], optional: ['unit', 'commit', 'blocking'] },
  // A finding's other fields (T026 U3) are optional: a finding with only `severity` is still
  // whole, and the old findings carry none of them. Where they come, findingFieldProblems
  // judges them, here and therefore in the verifier too.
  'finding':            { required: ['severity'], optional: ['level', 'evidence', 'defect-type', 'destination', 'induced-by', 'reopens-if', 'due'] },
  // A fix may name the commit it landed in (T026 U4). Optional for the type: a blocking
  // finding is fixed inside its own unit and needs none; the fix of a flag needs one, and the
  // appender reads the task log to judge it (flagFixProblem).
  'fix':             { required: ['resolves'], optional: ['commit'] },
  'measurement':            { required: ['metric', 'value'] },
  // A decision may name a unit (T147, D038): the owner's decision that opens one more review
  // round of that unit once it reached the cap. Optional, because nearly every decision is
  // about something else.
  'decision':     { required: ['by'], optional: ['unit'] },
  'adversarial-cases': { required: ['count'] },
  'note':                { required: [] },
};

export const TYPE_NAMES = Object.keys(TYPES);

/** Available to every type. `by` is required on two of them and optional on the rest. */
export const COMMON_FIELDS = ['ref', 'resolves', 'replaces', 'by'];

/** Which fields a given type accepts at all. Anything else is rejected, not ignored. */
export function allowedFields(type) {
  const spec = TYPES[type];
  if (!spec) return null;
  return new Set([...COMMON_FIELDS, ...spec.required, ...(spec.optional ?? [])]);
}

// ── A unit's review round, as data ───────────────────────────────────────────────────
// The shapes of the three fields, checked here so the writer refuses them and the verifier
// reports them with one rule. `unit` is named as in `## Done when` (U and digits, no leading
// zero), `commit` is a hex sha (7 to 64: SHA-256 repositories), `blocking` the count of
// blocking findings the round left, a plain non-negative integer.
export const REVIEW_FIELDS = ['unit', 'commit', 'blocking'];
export const UNIT_FIELD_RE = /^U[1-9]\d*$/;
export const SHA_FIELD_RE = /^[0-9a-f]{7,64}$/;
export const COUNT_FIELD_RE = /^(0|[1-9]\d*)$/;

function reviewFieldProblems(fields, at) {
  const out = [];
  const present = REVIEW_FIELDS.filter((f) => f in fields);
  if (!present.length) return out;
  const shape = { unit: [UNIT_FIELD_RE, 'a unit name as in "## Done when": U and its number, no leading zero (U2)'],
                  commit: [SHA_FIELD_RE, 'a commit sha: 7 to 64 lowercase hex characters'],
                  blocking: [COUNT_FIELD_RE, 'the count of blocking findings the round left: 0, 1, 2…'] };
  for (const f of present) {
    const v = String(fields[f] ?? '').trim();
    if (!shape[f][0].test(v)) out.push(`${at}"${f}: ${v}" is not ${shape[f][1]}.`);
  }
  const missing = REVIEW_FIELDS.filter((f) => !(f in fields));
  if (missing.length) {
    out.push(`${at}a unit's review-round carries unit:, commit: and blocking: together, and this one lacks ${missing.join(', ')}. ` +
             `integrate-unit.mjs counts a round only with the three; with fewer it reads as a review that cleared something and clears nothing.`);
  }
  return out;
}

/**
 * Whether a round's `unit:` names a unit of the task, read from the task file's text with the
 * caller's parser (task-units.mjs `parseUnits`, which this module does not import: it reads
 * one file and answers nothing across files). Null when it does, or when nothing can tell.
 */
export function unknownUnitProblem(entry, taskText, parseUnits) {
  const unit = String(entry.fields?.unit ?? '').trim();
  if (!['review-round', 'decision'].includes(entry.type) || !UNIT_FIELD_RE.test(unit) || !parseUnits || taskText == null) return null;
  const units = parseUnits(taskText)?.units ?? [];
  if (units.some((u) => u.id === unit)) return null;
  return `"unit: ${unit}" is not a unit of the task (its units: ${units.map((u) => u.id).join(', ') || 'none'}). Name the unit the ${entry.type === 'decision' ? 'decision is about' : 'round reviewed'}.`;
}

// ── A finding's severity, when it is written ─────────────────────────────────────────
// Two words, compared without case or surrounding spaces, and stored as they came: isBlocking
// already reads them that way (T026). This is a WRITE rule only — the appender calls it and
// validateEntry does not — because the task logs already hold findings with other words
// (non-blocking, minor, warning, nit…) and the verifier rejecting them would turn every old
// log red. Those still read as not blocking, exactly as before.
export const SEVERITY_VALUES = ['blocking', 'flag'];

/** Null when a finding's severity is one of the two, or the entry is not a finding. */
export function severityWriteProblem(entry) {
  if (entry.type !== 'finding' || !('severity' in (entry.fields ?? {}))) return null;
  // With any of the other fields, validateEntry already refuses another word (R-2), once.
  if (FINDING_FIELDS.some((f) => f in entry.fields)) return null;
  const raw = String(entry.fields.severity ?? '');
  const v = raw.trim().toLowerCase();
  if (!v || SEVERITY_VALUES.includes(v)) return null; // empty is the missing-field problem, reported once
  return `"severity: ${raw.trim()}" is not one of the two: blocking (it is fixed before the push) or flag (it is not). ` +
         `Case does not matter. Another word does not say which of the two it is, and only "blocking" stops the push.`;
}

// ── A finding's other fields ─────────────────────────────────────────────────────────
// The lists and the combinations are the severity rubric's (ae-kit-templates/severity-rubric.md),
// which the owner approved; this is what obeys it. Unlike the severity word above, these rules
// live in validateEntry, so the appender refuses and the verifier reports with the same rule:
// no old finding carries these fields, so nothing already written turns red. Each rule runs
// only with the fields it compares present (B-11), except that a hypothetical never blocks,
// with or without a level (R-1). Values compare without case or outer spaces, like severity.
export const FINDING_FIELDS = ['level', 'evidence', 'defect-type', 'destination', 'induced-by', 'reopens-if', 'due'];
export const FINDING_LISTS = {
  level: ['critical', 'major', 'debt', 'cosmetic', 'suggestion'],
  evidence: ['reproduced', 'plausible', 'hypothetical'],
  'defect-type': ['function', 'interface', 'checking', 'assignment', 'timing', 'build', 'documentation', 'algorithm'],
  destination: ['fix', 'new-unit', 'debt', 'drop', 'dissolve', 'accept', 'owner'],
};
/** The levels each gate admits, and the destinations: the rubric's two tables. */
export const LEVELS_BY_SEVERITY = { blocking: ['critical', 'major'], flag: ['debt', 'cosmetic', 'suggestion'] };
export const DESTINATIONS_BY_SEVERITY = { blocking: ['fix', 'dissolve', 'accept', 'owner'], flag: ['new-unit', 'debt', 'drop', 'dissolve', 'owner'] };

// A task id in `due:`, by the rule taskIdOf applies in check-commit-task.mjs: letters, an
// optional separator and digits, then the end or a separator (T186, T186-el-indice-de-deuda,
// TT-12). Copied and not imported because this module is never declared out and that one
// can be; the suite checks the two agree.
export const TASK_ID_PREFIX_RE = /^([A-Za-z]+[-_.]?\d+)(?=$|[-_.])/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `due:` is a real calendar date (YYYY-MM-DD, past ones included) or a task id. */
export function validDue(value) {
  const v = String(value ?? '').trim();
  const d = DATE_RE.exec(v);
  if (d) {
    const [y, m, day] = d.slice(1).map(Number);
    const t = new Date(Date.UTC(y, m - 1, day));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
  }
  return validTaskId(v) && TASK_ID_PREFIX_RE.test(v);
}

function findingFieldProblems({ id, fields }, at) {
  const out = [];
  const present = FINDING_FIELDS.filter((f) => f in fields);
  if (!present.length) return out;
  const val = (f) => String(fields[f] ?? '').trim().toLowerCase();
  const has = (f) => f in fields && val(f) !== '';
  const listed = (f) => has(f) && (!FINDING_LISTS[f] || FINDING_LISTS[f].includes(val(f)));

  for (const f of present) {
    if (!has(f)) { out.push(`${at}"${f}:" is empty. A field that is written carries its value; leave it out instead.`); continue; }
    if (FINDING_LISTS[f] && !listed(f)) {
      out.push(`${at}"${f}: ${String(fields[f]).trim()}" is not one of ${FINDING_LISTS[f].join(', ')}. Case does not matter; another word is not on the list (ae-kit-templates/severity-rubric.md).`);
    }
  }

  // R-2: a finding that carries a new field is a new finding, and the severity's closed list applies.
  const sev = val('severity');
  const gate = SEVERITY_VALUES.includes(sev) ? sev : null;
  if (!gate && sev) {
    out.push(`${at}"severity: ${String(fields.severity).trim()}" is not blocking or flag, and this finding carries ${present.join(', ')}. ` +
             `The old words are read only on findings written before those fields existed; a finding that has them uses one of the two.`);
  }
  if (gate && listed('level') && !LEVELS_BY_SEVERITY[gate].includes(val('level'))) {
    out.push(`${at}"severity: ${gate}" does not go with "level: ${val('level')}". blocking goes only with critical or major, and flag only with debt, cosmetic or suggestion: the level decides the gate.`);
  }
  if (listed('evidence') && val('evidence') === 'hypothetical') {
    if (listed('level') && LEVELS_BY_SEVERITY.blocking.includes(val('level'))) {
      out.push(`${at}"evidence: hypothetical" does not go with "level: ${val('level')}". A hypothetical finding is capped at debt: its input is one nobody would send.`);
    } else if (gate === 'blocking' && !has('level')) {
      out.push(`${at}"evidence: hypothetical" does not go with "severity: blocking". A hypothetical finding is capped at debt, so it never blocks.`);
    }
  }
  // A flag with destination fix is judged with the log, by flagDestinationProblem (y1eo):
  // it holds when the flag's round left blocking findings, which one entry cannot tell. Only
  // the appender calls it (242b), so the verifier lets such a flag through, as it does an old
  // severity word.
  const byTheLog = gate === 'flag' && val('destination') === 'fix';
  if (gate && listed('destination') && !byTheLog && !DESTINATIONS_BY_SEVERITY[gate].includes(val('destination'))) {
    out.push(`${at}"destination: ${val('destination')}" does not go with "severity: ${gate}". A ${gate === 'blocking' ? 'blocking finding' : 'flag'} admits only ${DESTINATIONS_BY_SEVERITY[gate].join(', ')}.`);
  }
  if (listed('destination') && val('destination') === 'debt') {
    const missing = ['reopens-if', 'due'].filter((f) => !(f in fields));
    if (missing.length) out.push(`${at}"destination: debt" needs reopens-if: and due:, and this finding lacks ${missing.join(' and ')}. Debt without what brings it back, and when, is a finding nobody reopens.`);
  } else if (!has('destination') || listed('destination')) {
    for (const f of ['reopens-if', 'due'].filter(has)) {
      out.push(`${at}"${f}:" belongs only to a finding with "destination: debt", and this one ${has('destination') ? `has "destination: ${val('destination')}"` : 'has no destination'}.`);
    }
  }
  if (has('due') && !validDue(fields.due)) {
    out.push(`${at}"due: ${String(fields.due).trim()}" is neither a real date (YYYY-MM-DD) nor a task id (T186, T186-el-indice-de-deuda, TT-12).`);
  }
  if (has('induced-by')) {
    const link = parseLink(fields['induced-by']);
    if (!link.ok) out.push(`${at}"induced-by:" ${link.why}. It carries the id of the finding whose fix produced this one, or <task-id>#<entry-id>.`);
    else if (id && link.id === id) out.push(`${at}"induced-by:" points at the finding itself. A finding is induced by another finding's fix, not by its own.`);
  }
  return out;
}

// ── The cap ──────────────────────────────────────────────────────────────────────────
// 1500 characters of body. Measured, not guessed: the 25 substantive entries of
// `tasks/T066-logs-por-mes.md` run 400–1404 characters, so this accepts every one of
// them and rejects a review report of hundreds of lines — the case that motivated the
// task. Fields and the header do not count against it; they are bounded by their own
// shape and counting them would make the limit depend on how many links an entry carries.
export const BODY_CAP = 1500;

// ── The identifier ───────────────────────────────────────────────────────────────────
// `YYYY-MM-DD-hhmmss-xxxx`. It sorts as text into the order things happened — across
// midnight, month and year — and it is assigned without reading the file, so two entries
// written in the same second differ and appending costs the same at five hundred entries
// as at none.
export const ID_RE = /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-z]{4}$/;

const SUFFIX_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A fresh id. `now` is injectable so the suites can pin a clock instead of sleeping.
 *
 * The four random characters are what resolve two writes in the same second. They are not
 * a counter on purpose: a counter has to be read from somewhere, and reading in order to
 * write is precisely the race this shape exists to avoid.
 */
export function newId(now = new Date(), randomInt = (n) => Math.floor(Math.random() * n)) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${p(now.getFullYear(), 4)}-${p(now.getMonth() + 1)}-${p(now.getDate())}-` +
                `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  return `${stamp}-${suffix}`;
}

// ── The separator ────────────────────────────────────────────────────────────────────
// An entry starts at `### <id> · <type>`. STRICT matches a well-formed one; LOOSE matches
// anything that would be mistaken for one. The writer rejects a body containing a LOOSE
// match, and the reader reports one it cannot parse — between them, no line of a body is
// ever read back as the start of another entry.
export const ENTRY_HEADER_RE = /^###[ \t]+(\S+)[ \t]+·[ \t]+(\S+)[ \t]*$/;
export const LOOSE_HEADER_RE = /^###[ \t]+\S+[ \t]+·/;

const FIELD_RE = /^-[ \t]+\*\*([A-Za-z][\w-]*):\*\*[ \t]*(.*)$/;

// ── Task ids and paths ───────────────────────────────────────────────────────────────
// A task id becomes a filename, so a `/` or a `..` in it writes outside `logs/tasks/`.
// This is validated at the one point where the id arrives from a caller, and the shape is
// deliberately narrow: the kit's own task ids are `T067-ontologia-de-la-bitacora`.
export const TASK_ID_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;

export function validTaskId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 120 &&
         TASK_ID_RE.test(id) &&
         // The expression alone already rules out the slash and a leading dot; this closes
         // `T..`, which starts with a letter and would get through.
         !id.includes('..');
}

export const taskLogPath = (root, taskId) => join(root, 'logs', 'tasks', `${taskId}.md`);

// ── Where the view lives ─────────────────────────────────────────────────────────────
// The raw task log stays at `logs/tasks/<id>.md`; its view moved into `logs/tasks/current/`.
// One folder per kind, because with a hundred tasks the flat layout was two hundred files
// side by side and neither half could be listed on its own. `VIEW_DIR_NAME` is exported so
// that every walker of `logs/tasks/` skips the same name instead of each spelling it.
export const VIEW_DIR_NAME = 'current';
export const viewDir = (root) => join(root, 'logs', 'tasks', VIEW_DIR_NAME);
export const viewPath = (root, taskId) => join(viewDir(root), `${taskId}.md`);

/** The pre-0.36.0 view, kept only so the generator can recognize and retire it. */
export const legacyViewPath = (root, taskId) => join(root, 'logs', 'tasks', `${taskId}.current.md`);

/** `<task-id>.md` in `logs/tasks/`, minus the views left over from the old layout. */
export function isTaskLogFile(name) {
  return name.endsWith('.md') && !name.endsWith('.current.md');
}

// ── The order things happened in ─────────────────────────────────────────────────────
// Not the id, which sorts by second and then by four RANDOM characters. `code-review`
// writes a round and its findings inside the same second, and those random characters
// decided which came first: in T054 three findings of round 1 sorted ahead of round 1. So
// the timestamp decides, and inside the same second the position in the file does — that
// one is the real write order, because the file is append-only.
export function entryOrder(a, b) {
  const sa = String(a.id).slice(0, 17), sb = String(b.id).slice(0, 17);
  if (sa !== sb) return sa < sb ? -1 : 1;
  const la = a.line ?? 0, lb = b.line ?? 0;
  if (la !== lb) return la - lb;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

export function fileHeader(taskId) {
  return `<!-- Task log of ${taskId}. Append-only: no entry is ever edited.\n` +
         `     A wrong entry is corrected by appending another one that replaces it.\n` +
         `     The format and the valid types: ae-kit-templates/task-log-ontology.md -->\n` +
         `\n# Task log — ${taskId}\n`;
}

// ── Links ────────────────────────────────────────────────────────────────────────────
/**
 * A `resolves:`/`replaces:` value. Two forms and only two: a bare id (this task log) or
 * `<task-id>#<entry-id>` (another task's). The task id is not optional in the second
 * form, because without it an id from elsewhere and an id that does not exist are the
 * same string, and no verifier can tell a cross-task link from a typo.
 */
export function parseLink(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { ok: false, why: 'is empty' };
  const hash = raw.indexOf('#');
  if (hash === -1) {
    if (!ID_RE.test(raw)) return { ok: false, why: `"${raw}" is not shaped like an identifier (YYYY-MM-DD-hhmmss-xxxx)` };
    return { ok: true, task: null, id: raw };
  }
  const task = raw.slice(0, hash);
  const id = raw.slice(hash + 1);
  if (!validTaskId(task)) return { ok: false, why: `"${task}" is not shaped like a task id` };
  if (!ID_RE.test(id)) return { ok: false, why: `"${id}" is not shaped like an identifier (YYYY-MM-DD-hhmmss-xxxx)` };
  return { ok: true, task, id };
}

// ── Validating one entry, without looking at any other ───────────────────────────────
/**
 * Everything that can be decided from a single entry: its type, its fields, its body.
 * Returns a list of prose problems — empty means well-formed.
 *
 * `where` is a label the caller supplies (a line number, or "the entry about to be
 * written"), so the same function serves the writer rejecting before it writes and the
 * verifier reporting after the fact.
 */
export function validateEntry({ id, type, fields, body }, where = '') {
  const at = where ? `${where}: ` : '';
  const out = [];

  if (!TYPES[type]) {
    out.push(`${at}"${type}" is not an event type. The seven are: ${TYPE_NAMES.join(', ')}.`);
    // Without a type there is no field list to judge against, so stop here rather than
    // emit a second, misleading complaint about every field being unknown.
    return out;
  }

  const allowed = allowedFields(type);
  for (const name of Object.keys(fields)) {
    if (!allowed.has(name)) {
      out.push(`${at}the field "${name}" does not exist in "${type}". The ones it accepts: ${[...allowed].join(', ')}. ` +
               `An invented field is a new type adopted without a decision by the owner.`);
    }
  }
  for (const name of TYPES[type].required) {
    if (!(name in fields) || !String(fields[name]).trim()) {
      out.push(`${at}the required field "${name}" of "${type}" is missing — ${FIELD_PURPOSE[name]}`);
    }
  }

  // ── A field value is one line, and the writer is what enforces it ──────────────────
  // The reader can never produce a field value with a newline in it — it parses line by
  // line — so this exists for the writer, and the case it stops is the same one the body
  // check stops: pasted tool output. In a field the damage is worse, because the split
  // happens BEFORE the body is written, so the second half of the paste is read back as
  // an entry of its own, carrying the real body and an id nobody assigned. That id can
  // collide with a future one or serve as a false target for a `resolves:`. Rejecting and
  // not escaping is the ontology's decision: neutralizing changes what was written.
  for (const [name, value] of Object.entries(fields)) {
    const raw = String(value ?? '');
    if (/[\r\n]/.test(raw)) {
      const first = raw.split(/\r?\n/)[0].trim().slice(0, 40);
      out.push(`${at}the field "${name}:" contains a line break, and a field is written on a single line. ` +
               `On rereading the task log, everything after "${first}…" would be read outside this entry, ` +
               `and a line starting with ### would fabricate an entry with an id nobody assigned. ` +
               `Put that text in a separate file and link it with "ref:".`);
    }
  }

  if (type === 'review-round') out.push(...reviewFieldProblems(fields, at));
  if (type === 'finding') out.push(...findingFieldProblems({ id, fields }, at));
  if (type === 'fix' && 'commit' in fields) {
    const v = String(fields.commit ?? '').trim();
    if (!SHA_FIELD_RE.test(v)) out.push(`${at}"commit: ${v}" is not a commit sha: 7 to 64 lowercase hex characters.`);
  }
  if (type === 'decision' && 'unit' in fields) {
    const v = String(fields.unit ?? '').trim();
    if (!UNIT_FIELD_RE.test(v)) out.push(`${at}"unit: ${v}" is not a unit name as in "## Done when": U and its number, no leading zero (U2).`);
  }

  for (const name of ['resolves', 'replaces']) {
    if (name in fields) {
      const link = parseLink(fields[name]);
      if (!link.ok) out.push(`${at}"${name}:" ${link.why}. A link carries an entry id, or <task-id>#<entry-id>.`);
    }
  }

  const text = String(body ?? '');
  if (!text.trim()) {
    out.push(`${at}the body is empty. An identifier that takes up a line in the view and says nothing is worse than not having the entry.`);
  } else if (text.length > BODY_CAP) {
    out.push(`${at}the body is ${text.length} characters and the cap is ${BODY_CAP}. ` +
             `It is not truncated: long text goes in its own file, linked from the entry with "ref:".`);
  }
  // ── The body does not start with something shaped like a field ─────────────────────
  // The parser ends the field block at the blank line, so a body like this one is read
  // back correctly when the entry was written by `renderEntry`. This rejection is for the
  // entry typed by hand, where the blank line is easy to forget and its absence turns the
  // first body line into a field nobody meant to write — a `resolves:` that hides an open
  // finding, or an invented field that makes every later commit fail. It is also what
  // keeps the raw file honest: a line that reads as a field should BE a field.
  const firstBodyLine = text.split('\n').find((l) => l.trim()) ?? '';
  if (FIELD_RE.test(firstBodyLine)) {
    const m = FIELD_RE.exec(firstBodyLine);
    out.push(`${at}the body starts with "${firstBodyLine.trim().slice(0, 60)}", which is shaped like a field. ` +
             `The only thing separating a field from an identical line of text is the blank line above it, ` +
             `and whoever writes the entry by hand will forget it: then that line is read as the field ` +
             `"${m[1]}" and leaves the body. If it is a field, put it above; if it is text, start the body ` +
             `with another line (a sentence, or "• ${m[1]}: …").`);
  }
  for (const line of text.split('\n')) {
    if (LOOSE_HEADER_RE.test(line)) {
      out.push(`${at}the body has a line that reads as the start of another entry: "${line.trim().slice(0, 60)}". ` +
               `On rereading the task log it would split this entry in two, the second with an id nobody assigned. ` +
               `Put that text in a separate file and link it with "ref:".`);
    }
  }
  return out;
}

const FIELD_PURPOSE = {
  by: 'who did or decided it, so that six weeks later nobody has to guess',
  result: 'how the review ended: what was approved and what was not',
  severity: 'whether it blocks or not, which is what decides if it is fixed before committing',
  resolves: 'which entry this fix closes; without it, the finding still shows as open',
  metric: 'what was measured',
  value: 'the number that came out',
  count: 'how many cases the approved list holds',
  ref: 'the path to the long text',
  unit: 'which unit the round reviewed, or which unit a decision opens one more round for',
  commit: 'the sha of the commit the round reviewed, or the one a fix landed in',
  blocking: 'how many blocking findings the round left',
  replaces: 'which entry this one replaces',
  level: 'how bad the finding is; it decides the gate',
  evidence: 'how often real use produces the input that triggers it',
  'defect-type': 'what kind of defect it is',
  destination: 'what happens to the finding',
  'induced-by': 'the finding whose fix produced this one',
  'reopens-if': 'what would bring a deferred finding back',
  due: 'when or where a deferred finding gets fixed',
};

// ── Reading a file ───────────────────────────────────────────────────────────────────
/**
 * Parses the text of a task log.
 *
 * Returns `{ entries, problems }`. `problems` carries everything malformed WITH its line
 * number, and `entries` carries what could be read regardless — a file damaged by a hand
 * edit still yields the entries around the damage, because the alternative is that one
 * bad line hides three hundred good ones.
 */
export function parseTaskLog(text) {
  const lines = String(text ?? '').split('\n');
  const entries = [];
  const problems = [];

  let current = null;
  const flush = () => {
    if (!current) return;
    // Trailing blank lines are formatting, not content, and keeping them would make the
    // cap depend on how many newlines happened to follow the entry.
    current.body = current.bodyLines.join('\n').replace(/\s+$/, '').replace(/^\n+/, '');
    delete current.bodyLines;
    entries.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const strict = ENTRY_HEADER_RE.exec(line);
    if (strict) {
      const [, id, type] = strict;
      if (!ID_RE.test(id)) {
        // It has the shape of a header but not a usable id. Reporting it is the whole
        // point: swallowing it into the previous entry's body is how an entry silently
        // disappears from every check that walks ids.
        flush();
        problems.push({ line: i + 1, what: `"${id}" is not shaped like an identifier, and the line reads as the start of an entry`,
                        fix: 'An id is YYYY-MM-DD-hhmmss-xxxx. Correct it by hand, or rewrite the line so it does not start with ###.' });
        continue;
      }
      flush();
      current = { id, type, fields: {}, fieldLines: {}, line: i + 1, bodyLines: [], inFields: true };
      continue;
    }
    if (LOOSE_HEADER_RE.test(line)) {
      flush();
      problems.push({ line: i + 1, what: `the line reads as the start of an entry but cannot be read: "${line.trim().slice(0, 70)}"`,
                      fix: 'The shape is `### <id> · <type>`. If it is body text, move it to a separate file and link it with "ref:".' });
      continue;
    }
    if (!current) continue; // preamble: the file header and the title

    if (current.inFields) {
      const f = FIELD_RE.exec(line);
      if (f) {
        const [, name, value] = f;
        if (name in current.fields) {
          problems.push({ line: i + 1, what: `the entry ${current.id} repeats the field "${name}"`,
                          fix: 'Keep only one. With two, which one wins depends on who reads the file.' });
        }
        current.fields[name] = value.trim();
        current.fieldLines[name] = i + 1;
        continue;
      }
      // ── Where the fields end ───────────────────────────────────────────────────────
      // At the blank line `renderEntry` always writes, and nowhere else. The fields are
      // the contiguous lines right under the header — not "everything until something
      // stops looking like a field". The difference is the whole point: with the loose
      // rule, a body whose FIRST line happens to read as `- **name:** value` — the way
      // this kit writes its own findings, and the way anyone quotes a `resolves:` id —
      // got promoted into structure. Silently, in the worst case: a `note` that merely
      // CITED a blocking finding's id acquired a real `resolves:` and made that finding
      // disappear from the view, with every verifier still green. Ending at the blank
      // line removes the ambiguity instead of chasing it.
      current.inFields = false;
      if (!line.trim()) continue;      // the blank line between fields and body
    }
    current.bodyLines.push(line);
  }
  flush();

  for (const e of entries) {
    for (const p of validateEntry(e, `line ${e.line}`)) {
      problems.push({ line: e.line, what: p, fix: null, entry: e.id });
    }
  }

  return { entries, problems };
}

/** Reads one task log off disk. A file that does not exist is an empty task log, not an error. */
export function readTaskLog(root, taskId) {
  const path = taskLogPath(root, taskId);
  if (!existsSync(path)) return { path, exists: false, entries: [], problems: [] };
  return { path, exists: true, ...parseTaskLog(readFileSync(path, 'utf8')) };
}

/** The text of one entry, exactly as it is appended. One renderer, so writer and reader agree. */
export function renderEntry({ id, type, fields = {}, body }) {
  const order = [...TYPES[type].required, ...(TYPES[type].optional ?? []), ...COMMON_FIELDS.filter((f) => !TYPES[type].required.includes(f))];
  const seen = new Set();
  let out = `\n### ${id} · ${type}\n`;
  for (const name of order) {
    if (name in fields && String(fields[name]).trim() && !seen.has(name)) {
      seen.add(name);
      out += `- **${name}:** ${String(fields[name]).trim()}\n`;
    }
  }
  return `${out}\n${String(body).trim()}\n`;
}

// ── The graph the entries form ───────────────────────────────────────────────────────
/**
 * `resolves:` and `replaces:` turn a task log into a directed graph. Two consumers need
 * to walk it: the verifier, to report what is broken, and the view, to hide what is
 * closed. It lives here for the same reason the parser does — walked twice, it would be
 * walked differently, and the verifier would bless a file the view renders wrong.
 *
 * Returns:
 *   hiddenBy   Map<id, [ids]>   entries that point at this one from inside this file
 *   cycles     [[id, …], …]     each set of entries that close a loop
 *   open       [entry, …]       in id order: what is still live
 *   hidden     [entry, …]       closed or superseded — still in the file, out of the view
 *   dangling   [{from, field, target}]  links to an id this file does not contain
 *   external   [{from, field, task, target}]  links that name another task
 *
 * A cycle's members stay OPEN. Hiding them would make work that is still open vanish from
 * the only place anyone looks — the most expensive failure in the whole design — so the
 * loop is reported and its members are shown.
 */
export function linkAnalysis(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const edges = [];        // { from, field, target }
  const dangling = [];
  const external = [];

  for (const e of entries) {
    for (const field of ['resolves', 'replaces']) {
      if (!(field in e.fields)) continue;
      const link = parseLink(e.fields[field]);
      if (!link.ok) continue; // malformed links are reported by validateEntry, not here
      if (link.task) { external.push({ from: e.id, field, task: link.task, target: link.id }); continue; }
      if (!byId.has(link.id)) { dangling.push({ from: e.id, field, target: link.id }); continue; }
      edges.push({ from: e.id, field, target: link.id });
    }
  }

  // Cycles, by iterative depth-first search. Iterative and not recursive on purpose: a
  // task log is append-only and grows without limit, and a five-hundred-deep chain that
  // blows the stack would take down the pre-commit hook of whoever happened to hit it.
  const out = new Map();
  for (const { from, target } of edges) {
    if (!out.has(from)) out.set(from, []);
    out.get(from).push(target);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map([...byId.keys()].map((id) => [id, WHITE]));
  const cycles = [];
  const inCycle = new Map(); // id -> cycle index

  for (const start of byId.keys()) {
    if (color.get(start) !== WHITE) continue;
    const stack = [{ id: start, next: 0 }];
    const path = [start];
    color.set(start, GREY);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const kids = out.get(top.id) ?? [];
      if (top.next >= kids.length) {
        color.set(top.id, BLACK);
        stack.pop(); path.pop();
        continue;
      }
      const kid = kids[top.next++];
      const c = color.get(kid);
      if (c === GREY) {
        const at = path.indexOf(kid);
        const loop = path.slice(at);
        const idx = cycles.length;
        cycles.push(loop);
        for (const id of loop) if (!inCycle.has(id)) inCycle.set(id, idx);
        continue;
      }
      if (c === BLACK) continue;
      color.set(kid, GREY);
      stack.push({ id: kid, next: 0 });
      path.push(kid);
    }
  }

  // Who hides whom. An edge inside a cycle hides nothing: both ends stay visible.
  const hiddenBy = new Map();
  const effective = [];
  for (const { from, field, target } of edges) {
    if (inCycle.has(from) && inCycle.has(target) && inCycle.get(from) === inCycle.get(target)) continue;
    effective.push({ from, field, target });
    if (!hiddenBy.has(target)) hiddenBy.set(target, []);
    hiddenBy.get(target).push(from);
  }

  const sorted = [...entries].sort(entryOrder);
  return {
    hiddenBy, cycles, dangling, external,
    // The summary view needs to tell a `resolves:` from a `replaces:` — a finding its fix
    // closed is FIXED, one its replacement supersedes never happened — and it needs to know
    // which edges the cycle already neutralized. Both are known here and nowhere else;
    // recomputing them in the generator is the second copy of a rule this file exists to
    // prevent.
    edges: effective,
    inCycle: new Set(inCycle.keys()),
    open: sorted.filter((e) => !hiddenBy.has(e.id)),
    hidden: sorted.filter((e) => hiddenBy.has(e.id)),
  };
}

// ── Who closed what ──────────────────────────────────────────────────────────────────
/**
 * `replaces:` says an entry never stood; `resolves:` says it stood and was dealt with. One
 * rule for every reader that asks whether a finding is still open — the view, and
 * integrate-unit.mjs, which refuses a unit while the task has a blocking one (D025) — so
 * the two can never disagree. Only links inside this log count, and a cycle closes nothing
 * (see linkAnalysis). A finding is open when it stands and nothing resolves it; whoever ends
 * a replacement chain of its closer decides whether it was fixed or dropped.
 */
export function closures(entries, g = linkAnalysis(entries)) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const replacedBy = new Map();
  const resolvedBy = new Map();
  for (const { from, field, target } of g.edges) (field === 'replaces' ? replacedBy : resolvedBy).set(target, byId.get(from));
  const live = (e) => !!e && !replacedBy.has(e.id);
  /** The last standing entry of a replacement chain. */
  const finalOf = (e) => {
    let cur = e; const seen = new Set();
    while (cur && replacedBy.has(cur.id) && !seen.has(cur.id)) { seen.add(cur.id); cur = replacedBy.get(cur.id); }
    return cur;
  };
  /** fixed, dropped or open — decided by the TYPE of whoever ended up closing it. */
  const statusOf = (e) => {
    const closer = finalOf(resolvedBy.get(e.id));
    return { status: !closer ? 'open' : closer.type === 'fix' ? 'fixed' : 'dropped', closer: closer ?? null };
  };
  return { live, finalOf, statusOf };
}

// ── The review-round cap ─────────────────────────────────────────────────────────────
/**
 * How many review rounds a unit runs before the owner decides. Three until T026 U8; two
 * since the owner's decision o8za, measured in docs/medicion-rubrica-severidad.md.
 */
export const ROUND_CAP = 2;

/**
 * At most two review rounds per unit (ROUND_CAP) before the owner decides (T147, T026). The
 * rule, as the owner settled it (D038–D041):
 *
 * - Only a `review-round` whose `unit:` is well formed counts, and only for that unit. One
 *   without it — adversarial's gap search, a final pass — never counts and is never refused.
 * - A round that replaces another of the same unit and the same commit is a CORRECTION: it
 *   repairs what was written, not what was reviewed. A round and every correction linked to
 *   it are one GROUP — however many times it was corrected, and whether each correction
 *   points at the original or at the previous correction — and the group counts once: in
 *   the original's place in time, with the count of blocking findings its most recent
 *   correction recorded. Two shas are the same commit when one is a prefix of the other
 *   (a short sha and its full form), as integrate-unit.mjs reads them.
 * - A round replaced by a round of ANOTHER unit stops counting for its own unit and counts
 *   only as the other unit's round (D043): the unit was written wrong, and the replacement
 *   says which unit it was. Any other replacement — a round of the same unit on another
 *   commit — counts as a new round, and a round replaced by something that is not a round
 *   still counts — otherwise replacing the last round each time, or covering it with a
 *   note, would keep the count at the cap forever (D039).
 * - With two rounds or more, a new one is refused only when the LAST round left blocking
 *   findings (D040): a clean round closes the cycle, and a later review — after a rebase,
 *   say — is not a fix loop. A round whose `blocking:` is missing or malformed counts as
 *   having left them: an unreadable count must not open the gate.
 * - It is let through by a standing `decision` with the same `unit:`, written after that
 *   last round — after it in time AND further down the file. Time alone would let one
 *   decision stamped in the future open every later round; position alone would let a
 *   merged branch's older decision count. Each decision is consumed by the round it opens,
 *   because that round becomes the new last one. A correction is never refused.
 *
 * `newEntry` is the round about to be written, with its `id`; `ownIds` the names this task
 * goes by in a `<task>#<id>` link, which point inside this same log (as integrate-unit.mjs
 * reads them). Returns null when the rule does not apply, else
 * { refuse, correction, count, last, decision, now, atCap }: `count` and `last` before the
 * new round, `now` the count once it is written and `atCap` whether, then, the unit has
 * two rounds or more and the last left blocking findings — the next round needs the owner.
 */
export function roundCap(entries, newEntry, ownIds = []) {
  const unitOf = (e) => String(e?.fields?.unit ?? '').trim();
  const unit = unitOf(newEntry);
  if (newEntry?.type !== 'review-round' || !UNIT_FIELD_RE.test(unit)) return null;
  const own = new Set(ownIds.map((x) => String(x).toLowerCase()));
  const local = (v) => {
    const link = parseLink(v);
    if (!link.ok) return null;
    if (!link.task) return link.id;
    return own.has(link.task.toLowerCase()) ? link.id : null;
  };
  // Links into this log, in one form, so the cycle rule of linkAnalysis applies to both.
  const normalize = (e) => {
    if (!('replaces' in (e.fields ?? {}))) return e;
    const id = local(e.fields.replaces);
    const fields = { ...e.fields };
    if (id) fields.replaces = id; else delete fields.replaces;
    return { ...e, fields };
  };
  const before = entries.map(normalize);
  // The new round, as the last entry of the file: after everything in time and position.
  const fresh = normalize({ ...newEntry, id: newEntry.id ?? '9999-12-31-235959-zzzz', line: Infinity, fields: { ...newEntry.fields } });
  const after = [...before, fresh];

  const isRound = (e) => e?.type === 'review-round' && unitOf(e) === unit;
  const shaOf = (e) => String(e.fields.commit ?? '').trim();
  const sameCommit = (a, b) => {
    const x = shaOf(a), y = shaOf(b);
    return SHA_FIELD_RE.test(x) && SHA_FIELD_RE.test(y) && (x.startsWith(y) || y.startsWith(x));
  };
  const corrects = (by, e) => isRound(by) && isRound(e) && sameCommit(by, e);
  const blockingOf = (e) => { const b = String(e.fields.blocking ?? '').trim(); return COUNT_FIELD_RE.test(b) ? Number(b) : null; };
  const leftBlocking = (r) => !!r && (r.blocking === null || r.blocking > 0);

  /** Who replaces each entry, and which rounds of this unit are linked as corrections. */
  const links = (list) => {
    const byId = new Map(list.map((e) => [e.id, e]));
    const replacers = new Map();
    const peers = new Map();
    const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    for (const { from, field, target } of linkAnalysis(list).edges) {
      if (field !== 'replaces') continue;
      const by = byId.get(from), e = byId.get(target);
      add(replacers, target, by);
      if (corrects(by, e)) { add(peers, from, target); add(peers, target, from); }
    }
    return { byId, replacers, peers };
  };

  /** The rounds that count for this unit, one per correction group, in the order they began. */
  const tally = (list) => {
    const { byId, replacers, peers } = links(list);
    const movedAway = (e) => (replacers.get(e.id) ?? []).some((by) =>
      by?.type === 'review-round' && UNIT_FIELD_RE.test(unitOf(by)) && unitOf(by) !== unit);
    const seen = new Set();
    const rounds = [];
    for (const e of list) {
      if (!isRound(e) || seen.has(e.id)) continue;
      const group = [];
      const stack = [e.id];
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        group.push(byId.get(id));
        for (const p of peers.get(id) ?? []) stack.push(p);
      }
      if (group.some(movedAway)) continue;    // D043: it was another unit's round
      group.sort(entryOrder);
      const origin = group[0], latest = group[group.length - 1];
      rounds.push({ id: latest.id, origin, blocking: blockingOf(latest) });
    }
    return { rounds: rounds.sort((a, b) => entryOrder(a.origin, b.origin)), replacers };
  };

  const then = tally(after).rounds;
  const now = then.length;
  const atCap = now >= ROUND_CAP && leftBlocking(then[now - 1]);

  const target = 'replaces' in fresh.fields ? before.find((e) => e.id === fresh.fields.replaces) : null;
  if (target && corrects(fresh, target)) return { refuse: false, correction: true, count: now, last: then[now - 1] ?? null, now, atCap };

  const { rounds, replacers } = tally(before);
  const count = rounds.length;
  const last = rounds[count - 1] ?? null;
  if (count < ROUND_CAP || !leftBlocking(last)) return { refuse: false, count, last, now, atCap };

  const decision = before.filter((e) => e.type === 'decision' && unitOf(e) === unit
      && !replacers.has(e.id) && entryOrder(e, last.origin) > 0 && (e.line ?? 0) > (last.origin.line ?? 0))
    .sort(entryOrder).pop() ?? null;
  return { refuse: !decision, count, last, decision, now, atCap };
}

export const isBlocking = (e) => String(e.fields.severity ?? '').trim().toLowerCase() === 'blocking';

/** The blocking findings still open in one task log, by the rule above. */
export function openBlockingFindings(entries) {
  const { live, statusOf } = closures(entries);
  return entries.filter((e) => e.type === 'finding' && live(e) && isBlocking(e) && statusOf(e).status === 'open');
}

// ── A flag is not fixed inside its own unit ──────────────────────────────────────────
// The reading both rules below share: the replacement links of one task log, and where a
// flag came from. One reading, so the fix and the destination can never place the same flag
// in two different units.
function flagContext(entries) {
  const sorted = [...entries].sort(entryOrder);
  const byId = new Map(sorted.map((e) => [e.id, e]));
  const unitOf = (e) => String(e?.fields?.unit ?? '').trim();
  const isUnitRound = (e) => e?.type === 'review-round' && UNIT_FIELD_RE.test(unitOf(e));
  const shaOf = (e) => String(e?.fields?.commit ?? '').trim();
  const sameSha = (x, y) => SHA_FIELD_RE.test(x) && SHA_FIELD_RE.test(y) && (x.startsWith(y) || y.startsWith(x));

  // The replacement links inside this log, with the cycles linkAnalysis already neutralized.
  const replaces = new Map();    // from -> the entry it replaces
  const replacedBy = new Map();  // target -> [entries that replace it]
  for (const { from, field, target: to } of linkAnalysis(sorted).edges) {
    if (field !== 'replaces') continue;
    replaces.set(from, byId.get(to));
    if (!replacedBy.has(to)) replacedBy.set(to, []);
    replacedBy.get(to).push(byId.get(from));
  }
  /** The first entry of a replaces: chain, walking back while `same` holds. */
  const originOf = (e, same) => {
    let cur = e; const seen = new Set([e.id]);
    for (let prev = replaces.get(cur.id); prev && same(prev) && !seen.has(prev.id); prev = replaces.get(cur.id)) { seen.add(prev.id); cur = prev; }
    return cur;
  };
  /** A round as it finally stands: followed through its replacements by rounds of a unit (D043, corrections). */
  const finalRound = (r) => {
    let cur = r; const seen = new Set([r.id]);
    for (;;) {
      const next = (replacedBy.get(cur.id) ?? []).filter((x) => isUnitRound(x) && !seen.has(x.id)).sort(entryOrder).pop();
      if (!next) return cur;
      seen.add(next.id); cur = next;
    }
  };
  const roundUnit = (r) => { const f = finalRound(r); return isUnitRound(f) ? unitOf(f) : ''; };
  /** A round's place in time: a correction stands where its original was. */
  const roundOrigin = (r) => originOf(r, (p) => p.type === 'review-round' && sameSha(shaOf(p), shaOf(r)));
  /** After `e` in time AND further down the file. */
  const isAfter = (o, e) => entryOrder(o, e) > 0 && (o.line ?? 0) > (e.line ?? 0);
  /** Where a finding came from: the origin of its chain, the unit of the round above it, and whether that round left blocking findings. */
  const flagOf = (finding) => {
    const flag = originOf(finding, (p) => p.type === 'finding');
    const above = sorted.slice(0, sorted.indexOf(flag)).filter((e) => e.type === 'review-round').pop();
    const round = above ? finalRound(above) : null;
    const unit = isUnitRound(round) ? unitOf(round) : '';
    const b = String(round?.fields?.blocking ?? '').trim();
    // A count that cannot be read is not taken as blocking here: the exception it opens is the
    // one that needs proving, so an unreadable count keeps the rule closed.
    return { flag, round, unit, leftBlocking: !!unit && COUNT_FIELD_RE.test(b) && Number(b) > 0 };
  };
  return { sorted, byId, unitOf, isUnitRound, shaOf, sameSha, roundUnit, roundOrigin, isAfter, flagOf };
}

/**
 * A round with no blocking finding closes its unit (T026, Q7): a flag it left is fixed in a
 * NEW unit, with its own commit and its own review round, never by reopening the unit it came
 * from. The appender holds that at the one point it can see: the `fix` that resolves a flag.
 * The rule, as the owner settled it (e31b, xfuf, y1eo):
 *
 * - It applies only to a `fix` whose `resolves:` is a bare id of this log that names a finding
 *   which does not block — `isBlocking` false, the old words (minor, nit…) included. A link to
 *   another log, or a task-qualified one, closes nothing (see closures), so the rule skips it;
 *   so does a blocking finding, which is fixed inside its unit and needs no `commit:`.
 * - The flag's unit is the `unit:` of the review round written above it — in the order of
 *   entryOrder, as the view reads it — taking the ORIGIN of the flag's `replaces:` chain, so
 *   that replacing a flag under another unit's round does not move it out of its unit (R-9).
 *   When that round was replaced by a round of another unit, the unit is the replacement's
 *   (D043, R-8). A round without `unit:` — a final pass, a gap search — gives no unit, and a
 *   finding written before any round has none: the rule does not apply (C-4).
 * - Otherwise the fix carries `commit:`, and that commit (compared by prefix, as roundCap
 *   does) must already have a review round of ANOTHER unit written after the flag — after it
 *   in time AND further down the file, with a correction placed where its original was. A
 *   commit no round reviewed, one reviewed only before the flag (R-10), and one that any round
 *   of the flag's own unit reviewed (C-3, R-11) are refused.
 * - One exception (y1eo): when the flag's round left blocking findings, the unit is not closed
 *   — it is amended anyway — so the fix of the flag also holds with the commit the NEXT round
 *   of that same unit reviewed, written after the flag, as long as no round of that unit
 *   reviewed the commit before the flag. Whether the flag deserved fixing (Q11) and the cap of
 *   two flag fixes per task (Q12) are the session's judgement, not this function's.
 *
 * What it does not stop, accepted by the owner (a1nf): closing the flag with a note or a
 * decision, or a new round of a unit whose last round was clean. Detecting those is T187.
 *
 * Returns null when the rule does not apply or is met, else the problem in prose.
 */
export function flagFixProblem(entries, newEntry) {
  if (newEntry?.type !== 'fix') return null;
  const link = parseLink(newEntry.fields?.resolves);
  if (!link.ok || link.task) return null;                                        // C-7
  const c = flagContext(entries);
  const target = c.byId.get(link.id);
  if (!target || target.type !== 'finding' || isBlocking(target)) return null;   // C-2

  const { flag, unit, leftBlocking } = c.flagOf(target);
  if (!UNIT_FIELD_RE.test(unit)) return null;                                    // C-4

  const sha = c.shaOf(newEntry);
  const named = `the flag ${target.id} came out of a review round of ${unit}`;
  const exception = leftBlocking
    ? ` That round left blocking findings, so the commit the next round of ${unit} reviewed, after the flag, holds too.`
    : '';
  if (!sha) {
    return `${named}, and this fix carries no commit:. A flag is fixed in a new unit, not by reopening ${unit}: ` +
           `pass --commit <sha> with the commit of that new unit, once a review round of it is written.${exception}`;
  }
  if (!SHA_FIELD_RE.test(sha)) return null;              // its shape is validateEntry's to report, once

  const reviews = c.sorted.filter((e) => e.type === 'review-round' && c.sameSha(c.shaOf(e), sha))
    .map((r) => ({ r, unit: c.roundUnit(r), after: c.isAfter(c.roundOrigin(r), flag) }))
    .filter((x) => UNIT_FIELD_RE.test(x.unit));

  // y1eo: the round of the flag left blocking findings, and the next round of its unit reviewed this commit.
  if (leftBlocking && !reviews.some((x) => x.unit === unit && !x.after)) {
    const later = c.sorted.filter((e) => c.isUnitRound(e) && c.roundUnit(e) === unit)
      .map((r) => ({ r, o: c.roundOrigin(r) })).filter((x) => c.isAfter(x.o, flag))
      .sort((a, b) => entryOrder(a.o, b.o));
    const next = later.filter((x) => later.length && x.o.id === later[0].o.id);   // the next round, with its corrections
    if (next.some((x) => c.sameSha(c.shaOf(x.r), sha))) return null;
  }

  const own = reviews.find((x) => x.unit === unit);
  if (own) {
    return `${named}, and commit ${sha} was reviewed as ${unit} too (round ${own.r.id}). ` +
           `A fix inside the unit that left the flag reopens that unit: the flag is fixed in a new unit, with its own commit and its own round.${exception}`;
  }
  if (!reviews.some((x) => x.after)) {
    const why = reviews.length
      ? `the rounds that reviewed it (${reviews.map((x) => `${x.unit}, ${x.r.id}`).join('; ')}) were written before the flag, so none of them reviewed this fix`
      : 'no review round of any unit has reviewed it yet';
    return `${named}, and for commit ${sha} ${why}. The fix of a flag is written after the review round of the new unit that carries it.${exception}`;
  }
  return null;
}

/**
 * `destination: fix` on a flag (y1eo). validateEntry refuses `fix` on a flag only together
 * with this: it cannot see the round, and the destination holds exactly when the round the
 * flag came out of — read as flagFixProblem reads it — left blocking findings, so the unit is
 * amended anyway and the flag can be fixed in that same amendment. Only the appender calls it,
 * with the finding about to be written as the last entry: a WRITE rule, like the severity's
 * closed list (242b). Judged by the verifier against a round corrected later — blocking 1 to 0
 * — a flag written rightly would turn every later commit red, with no clean way out.
 * Returns null when it holds or does not apply, else the problem in prose.
 */
export function flagDestinationProblem(entries, entry) {
  if (entry?.type !== 'finding' || isBlocking(entry)) return null;
  if (String(entry.fields?.destination ?? '').trim().toLowerCase() !== 'fix') return null;
  if (String(entry.fields?.severity ?? '').trim().toLowerCase() !== 'flag') return null; // another word is validateEntry's (R-2)
  const list = entries.some((e) => e.id === entry.id) ? entries : [...entries, { ...entry, line: entry.line ?? Infinity }];
  const c = flagContext(list);
  const { unit, leftBlocking } = c.flagOf(c.byId.get(entry.id));
  if (leftBlocking) return null;
  return `"destination: fix" on a flag holds only when the review round it came out of left blocking findings, ` +
         `so the unit is amended anyway; ${unit ? `the round of ${unit} above it left none` : 'it came out of no unit\'s round'}. ` +
         `Otherwise a flag admits only ${DESTINATIONS_BY_SEVERITY.flag.join(', ')}.`;
}
