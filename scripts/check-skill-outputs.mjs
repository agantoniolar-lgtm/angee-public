#!/usr/bin/env node
/**
 * check-skill-outputs.mjs — every skill must name its output as a locatable artifact.
 *
 * ── Why (2026-08-09, Capability 1) ────────────────────────────────────────────────────
 * Every SKILL.md already ends with an `## Output` section, and nothing ever checked that
 * what it describes exists. On 2026-07-22 `verify-evals` was recorded as complete having
 * produced no rubric, no threshold, no scorecard, no evals directory — in the one
 * AI-native project running this kit, with an LLM pipeline live in production. Nobody
 * could tell, because there was nothing to go looking for.
 *
 * A skill is otherwise "done" because the agent says it's done. That is the same
 * self-assessment failure the kit already refuses to accept in code review, moved from
 * the code to the process.
 *
 * So each skill declares, in a machine-readable block, WHAT it leaves behind and WHERE.
 * That block is what the next skill in the chain checks before it starts, and what the
 * project owner opens instead of asking the agent how it went.
 *
 * ── Required shape ────────────────────────────────────────────────────────────────────
 * A fenced ```yaml block containing `output:` and, per entry, a `kind:` of:
 *   file        — a path that must exist (`path:` required)
 *   task-entry  — recorded in the task file itself: status, done-when, open blockers
 *   task-log    — appended to the task's task log (`logs/tasks/<id>.md`); needs an
 *                 `event:` naming one of the seven types in task-log-ontology.md
 *   chat        — an explicit report to the project owner (legitimate, but never alone
 *                 for a skill that also produces durable work)
 * plus `must_contain:` describing what makes it non-empty.
 *
 * Exit codes:
 *   0  every skill declares a well-formed output contract
 *   1  at least one skill is missing it or declares it malformed
 *   2  no skills directory found
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();

// Support both a project layout (.claude/skills) and the kit's own (kit/.claude/skills).
const candidates = [
  join(root, '.claude', 'skills'),
  join(root, 'kit', '.claude', 'skills'),
];
const skillsDir = candidates.find(existsSync);

if (!skillsDir) {
  console.error(`✗ No se encontró un directorio de skills bajo ${root}`);
  process.exit(2);
}

const VALID_KINDS = new Set(['file', 'task-entry', 'task-log', 'chat']);

// The seven event types of ae-kit-templates/task-log-ontology.md. Copied, not imported
// from task-log.mjs, on purpose: this check has to run in a project whose task-log
// scripts are missing, and it must not break because they are. test-skill-outputs.sh
// compares this list with the parser's, so the two copies cannot drift apart unseen.
const EVENT_TYPES = ['review-round', 'finding', 'fix', 'measurement', 'decision', 'adversarial-cases', 'note'];

const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const problems = [];
const ok = [];

for (const name of skills) {
  const path = join(skillsDir, name, 'SKILL.md');
  if (!existsSync(path)) {
    problems.push([name, 'no tiene SKILL.md']);
    continue;
  }
  const text = readFileSync(path, 'utf8');

  const block = text.match(/```ya?ml\s*\n([\s\S]*?)```/g)?.find((b) => /^\s*output:/m.test(b));

  if (!block) {
    problems.push([name, 'declares no ```yaml block with `output:` — its deliverable is not locatable']);
    continue;
  }

  const kinds = [...block.matchAll(/kind:\s*([a-z-]+)/g)].map((m) => m[1]);
  if (kinds.length === 0) {
    problems.push([name, 'the output block declares no `kind:`']);
    continue;
  }
  const bad = kinds.filter((k) => !VALID_KINDS.has(k));
  if (bad.length) {
    problems.push([name, `kind desconocido: ${bad.join(', ')} (válidos: ${[...VALID_KINDS].join(', ')})`]);
    continue;
  }
  // A `task-log` entry has to say which kind of event it writes, and it has to be one of
  // the seven: an invented type would be rejected by the appender at run time, after the
  // work it records is already done.
  const logEntries = block.split(/-\s+kind:/).filter((s) => /^\s*task-log\b/.test(s));
  const badEvents = logEntries
    // Its own key line only — `event:` quoted inside a must_contain does not count — and a
    // quoted value is the same value in YAML.
    .map((s) => s.match(/^\s*event:\s*["']?([A-Za-z-]+)["']?\s*$/m)?.[1] ?? '(none)')
    .filter((e) => !EVENT_TYPES.includes(e));
  if (badEvents.length) {
    problems.push([name, `a task-log output names no valid \`event:\` (${badEvents.join(', ')}); valid: ${EVENT_TYPES.join(', ')}`]);
    continue;
  }
  // A `file` entry without a path is a promise with no address.
  const fileEntries = block.split(/-\s+kind:/).filter((s) => /^\s*file/.test(s));
  const pathless = fileEntries.filter((s) => !/path:/.test(s));
  if (pathless.length) {
    problems.push([name, `un output de tipo file no declara \`path:\``]);
    continue;
  }
  if (!/must_contain:/.test(block)) {
    problems.push([name, 'no output declares `must_contain:` — an empty file would satisfy the contract']);
    continue;
  }
  ok.push([name, kinds.join(', ')]);
}

console.log(`\n  Skills revisados: ${skills.length}   (${skillsDir.replace(root + '/', '')})\n`);
for (const [name, kinds] of ok) console.log(`  ✓ ${name.padEnd(16)} → ${kinds}`);
for (const [name, why] of problems) console.log(`  ✗ ${name.padEnd(16)} → ${why}`);

if (problems.length === 0) {
  console.log(`\n✓ Cada skill nombra su entrega como artefacto localizable.\n`);
  process.exit(0);
}
console.error(
  `\n✗ ${problems.length} skill(s) sin contrato de entrega verificable.` +
  `\n  A skill that cannot name its output as an artifact is under-designed:` +
  `\n  it is declared done because the agent says so, and nobody can check it afterwards.\n`
);
process.exit(1);
