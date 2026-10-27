#!/usr/bin/env node
/**
 * check-status-shape.mjs — STATUS.md keeps its shape: a maturity line, three sections,
 * and a decisions table of one row per decision.
 *
 * ── The failure this removes ─────────────────────────────────────────────────────────
 * session-log already said "replace Last session". A consuming project still stacked 27
 * "previous session" sections and grouped its decisions by date in paragraphs, until the
 * file reached 1,108 lines and was read whole at the start of every session. The
 * instruction existed and was not followed. This script is what makes the shape hold.
 *
 * ── What it checks ───────────────────────────────────────────────────────────────────
 *   - a `maturity:` line with one of prototype / pre-users / live-users;
 *   - exactly three `## ` sections, in order: `Next session`, `Last session (…)`,
 *     `Decisions`. `### ` subsections inside them are allowed;
 *   - under `Decisions`, nothing but one markdown table (and HTML comments): a header of
 *     four columns, its separator, and rows of exactly four cells;
 *   - more than 15 decision rows is reported as a warning, not a failure. session-log
 *     retires decisions before adding the sixteenth.
 *
 * It does not check that a row is concise or true. That needs judgement.
 *
 * Exit codes:
 *   0  the shape holds (a warning may still be printed)
 *   1  the shape is broken — each defect is named
 *   2  there is no STATUS.md to check
 *   3  STATUS.md still has the old layout — neither `Next session` nor `Decisions`, and at least
 *      one old one ("Pending / next session priority", "Decided / deferred", "Known
 *      limitations"). `Last session` does not count as new: it existed before. Not migrated yet. Not a defect of this commit; the project migrates
 *      from its own repo. A file with any new section is checked in full, so a partial
 *      migration cannot switch the checker off.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_DECISIONS = 15;
const SECTIONS = [
  { name: 'Next session', test: (h) => h === 'Next session' },
  { name: 'Last session (YYYY-MM-DD)', test: (h) => /^Last session \(.+\)$/.test(h) },
  { name: 'Decisions', test: (h) => h === 'Decisions' },
];
const OLD_LAYOUT = /^##\s+(Pending \/ next session priority|Decided \/ deferred|Known limitations)/m;

const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const file = join(root, 'STATUS.md');
if (!existsSync(file)) {
  console.log(`· No STATUS.md in ${root} — nothing to check.`);
  process.exit(2);
}

const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
// HTML comments are allowed anywhere and never count as content; neither does a fenced code
// block. Both are blanked line by line so line numbers in the messages stay right.
const blank = (m) => m.replace(/[^\n]/g, '');
const text = raw.replace(/<!--[\s\S]*?-->/g, blank).replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank);
// `Last session` existed in the old layout too, so only the two new names mark a migrated file.
const NEW_LAYOUT = /^##\s+(Next session|Decisions)\s*$/m;
if (OLD_LAYOUT.test(text) && !NEW_LAYOUT.test(text)) {
  console.log('⚠ STATUS.md still has the old layout (Pending / Decided / Known limitations).');
  console.log('  Migrate it to three sections: Next session, Last session (date), Decisions.');
  console.log('  See ae-kit-templates/STATUS.md.template.');
  process.exit(3);
}

const lines = text.split('\n');
const problems = [];

const maturity = lines.filter((l) => /^maturity:/.test(l));
if (maturity.length > 1) problems.push(`${maturity.length} \`maturity:\` lines; keep one`);
else if (!maturity.length || !/^maturity:\s*(prototype|pre-users|live-users)\s*$/.test(maturity[0])) {
  problems.push('no `maturity:` line with prototype, pre-users or live-users');
}

const headings = [];
lines.forEach((l, i) => {
  const m = /^##\s+(.+?)\s*$/.exec(l);
  if (m && !l.startsWith('###')) headings.push({ title: m[1], line: i });
});

headings.forEach((h, i) => {
  const expected = SECTIONS[i];
  if (!expected) problems.push(`extra section "## ${h.title}" (line ${h.line + 1}); only three are allowed`);
  else if (!expected.test(h.title)) {
    problems.push(`section ${i + 1} is "## ${h.title}" (line ${h.line + 1}); expected "## ${expected.name}"`);
  }
});
for (let i = headings.length; i < SECTIONS.length; i++) {
  problems.push(`missing section "## ${SECTIONS[i].name}"`);
}

const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

const decisions = headings.find((h) => h.title === 'Decisions');
let rows = 0;
if (decisions) {
  const next = headings.find((h) => h.line > decisions.line);
  const body = lines.slice(decisions.line + 1, next ? next.line : lines.length);
  let tableLine = 0;
  let tableEnded = false;
  body.forEach((l, k) => {
    const where = `line ${decisions.line + 2 + k}`;
    if (l.trim() === '') {
      if (tableLine > 0) tableEnded = true;
      return;
    }
    if (!l.trim().startsWith('|')) {
      problems.push(`${where}: text outside the table under Decisions — one row per decision, the reason goes in Detail`);
      return;
    }
    if (tableEnded) {
      problems.push(`${where}: a second table under Decisions — keep a single table`);
      return;
    }
    tableLine += 1;
    const n = cells(l).length;
    if (tableLine === 1) {
      if (n !== 4) problems.push(`${where}: the header has ${n} columns; expected 4 (decision, date, enforced by, detail)`);
    } else if (tableLine === 2) {
      if (n !== 4 || !cells(l).every((c) => /^:?-{3,}:?$/.test(c))) problems.push(`${where}: the header separator is missing or does not have 4 columns`);
    } else {
      rows += 1;
      if (n !== 4) problems.push(`${where}: a decision row has ${n} cells; expected 4`);
      else if (cells(l)[0] === '') problems.push(`${where}: a decision row has an empty decision`);
    }
  });
  if (tableLine === 0) problems.push('Decisions has no table');
}

if (problems.length) {
  console.log('✗ STATUS.md does not keep its shape:');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}

console.log(`✓ STATUS.md keeps its shape (${rows} decision${rows === 1 ? '' : 's'}).`);
if (rows > MAX_DECISIONS) {
  console.log(`⚠ ${rows} decisions; the cap is ${MAX_DECISIONS}. Retire or drop some at the next close.`);
}
process.exit(0);
