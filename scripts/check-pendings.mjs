#!/usr/bin/env node
/**
 * check-pendings.mjs — surface pendings that have been carried long enough to need a decision.
 *
 * ── The pattern this ends ────────────────────────────────────────────────────────────
 * Pendings drift with nothing that ever forces them closed, in three distinct ways:
 *
 *   1. The one that repeats while nobody escalates — carried four sessions before
 *      somebody spent the half hour it needed.
 *   2. The one that evaporates without a decision — copied verbatim across five files,
 *      then gone, with no record of anyone deciding against it.
 *   3. The one the system cannot act on at all, because it's waiting on a person outside
 *      the project (a phone number nobody has yet).
 *
 * All three look identical in a flat list, and compete for the same attention. So each
 * pending carries who can close it and how many separate sessions it has survived.
 * Three mentions is the escalation line — not because three is magic, but because the
 * measured cases crossed it and nothing happened.
 *
 * ── What escalation means ────────────────────────────────────────────────────────────
 * Not "work on it now". It means the pending stops being a line in a list and becomes a
 * decision: promote it to a task, hand it to whoever can actually close it, or drop it
 * **on purpose and in writing**. Dropping it is a legitimate outcome; dropping it
 * silently is the failure.
 *
 * Format — a markdown table in PENDINGS.md:
 *   | id | pending | owner | first raised | mentions | state |
 *
 * The valid values for `owner` and `state` used to be listed right here, as a comment,
 * and a comment cannot fail: a consuming project wrote an invented owner into 14 rows and
 * nothing noticed. They now live as data in `pendings-table.mjs` and are enforced by
 * `check-task-links.mjs`. This file counts mentions; it does not judge the values.
 *
 * Exit codes:
 *   0  nothing needs a decision right now
 *   1  at least one pending crossed the line and is still `open`
 *   2  PENDINGS.md missing or unparseable
 */

import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Parsing this table lives in one file — `check-task-links.mjs` needs the identical read,
// and two parsers of one hand-written table drift the day someone adds a column.
const { readPendings } =
  await import(join(dirname(fileURLToPath(import.meta.url)), 'pendings-table.mjs'));

const args = process.argv.slice(2);
const root = resolve(args.find((a) => !a.startsWith('--')) || process.cwd());
const i = args.indexOf('--limit');
const LIMIT = i === -1 ? 3 : Number(args[i + 1]);
const file = join(root, 'PENDINGS.md');

if (!existsSync(file)) {
  console.error(`✗ No existe PENDINGS.md en ${root}`);
  console.error(`  Create it from ae-kit-templates/PENDINGS.md.template, or drop this rule from CLAUDE.md.`);
  process.exit(2);
}

const { rows, malformed, skipped } = readPendings(root);
if (malformed.length) {
  // Each entry says what is actually wrong with IT. Printing them all under one fixed
  // label sent the reader to count pipes on a row whose six columns were all present.
  for (const m of malformed) {
    console.error(`✗ PENDINGS.md — ${m.why}`);
    if (m.line) console.error(`    ${m.line}`);
    if (m.fix) console.error(`    → ${m.fix}`);
  }
  process.exit(2);
}

// Anything not counted is said out loud, and this is the script where that matters most:
// its entire purpose is that nothing gets carried a fourth time without a decision. A
// counter that answers "nothing to report" about rows it decided not to read is worse
// than no counter, because it is trusted. Reported here even though the rows are only
// ever template scaffolding — the silence is the defect, not the skipping.
for (const { id, why } of skipped) {
  console.log(`  · ${id} no se cuenta — ${why}`);
}
if (skipped.length) console.log('');

if (rows.length === 0) {
  console.log('✓ Sin pendientes registrados.');
  process.exit(0);
}

const days = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
};

const open = rows.filter((r) => r.state === 'open');
const needsDecision = open.filter((r) => r.mentions >= LIMIT);
const alreadyEscalated = rows.filter((r) => r.state === 'escalated');

console.log(`\n  Pendientes: ${rows.length}  ·  abiertos: ${open.length}  ·  escalados: ${alreadyEscalated.length}\n`);

for (const r of rows.filter((r) => r.state === 'open' || r.state === 'escalated')) {
  const age = days(r.first);
  const mark = r.mentions >= LIMIT ? '⚑' : '·';
  console.log(`  ${mark} ${r.id}  ${r.text}`);
  console.log(`      cierra: ${r.owner}  ·  ${r.mentions} menciones  ·  ${age === null ? 'fecha ilegible' : `${age} días`}`);
}

// A third-party pending is not the project's to close, but it is the project's to chase
// or to formally give up on. It escalates like any other; what changes is the action.
if (needsDecision.length === 0) {
  console.log(`\n✓ None crossed the ${LIMIT}-mention line.\n`);
  process.exit(0);
}

console.error(`\n✗ ${needsDecision.length} pending item(s) at ${LIMIT} or more mentions and still \`open\`:\n`);
for (const r of needsDecision) {
  console.error(`  ⚑ ${r.id} — ${r.text}`);
  console.error(`      ${r.mentions} sesiones distintas. Cierra: ${r.owner}.`);
}
console.error(
  `\n  Carrying it another session is not a neutral option: it is the decision not to decide,` +
  `\n  taken with nobody signing it. Promote it to a task, hand it to whoever can actually` +
  `\n  close it, or drop it deliberately and in writing (state: dropped, with the reason).\n`
);
process.exit(1);
