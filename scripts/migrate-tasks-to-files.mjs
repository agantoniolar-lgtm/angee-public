#!/usr/bin/env node
/**
 * migrate-tasks-to-files.mjs — split flat task trackers into one file per task.
 *
 * Reads the old layout (task entries as `### <id> — <title>` blocks inside TASKS.md,
 * TASKS_ARCHIVE.md, and any dated archive files) and writes tasks/<id>.md, each with
 * frontmatter the index generator can read.
 *
 * ── Why this is dry-run by default ───────────────────────────────────────────────────
 * This is a data migration over a project's entire work history — the one artifact that
 * cannot be rebuilt from code if it's mangled. It prints what it would do and writes
 * nothing until `--write` is passed, and it refuses to overwrite an existing task file.
 *
 * Verify the counts before and after. The number of `###` blocks going in must equal the
 * number of files coming out; anything else means an entry was dropped or merged, which
 * is exactly the silent corruption this whole capability exists to end.
 *
 * Usage:
 *   migrate-tasks-to-files.mjs [repoRoot] [--write] [--source FILE]...
 *     --source  add a source file (repeatable). Defaults to TASKS.md, TASKS_ARCHIVE.md,
 *               and every .md under tasks-archive/.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const root = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--source') || process.cwd());

// Reject anything unrecognised instead of ignoring it. Found in a real retrofit: a
// quoted `--source ...` string arrived as ONE argument, matched no known flag, was
// silently dropped, and the script fell back to its default source list — migrating
// 195 tasks instead of the intended 137. A destructive default reached by silently
// discarding input is the exact failure shape this kit exists to eliminate.
const KNOWN = new Set(['--write', '--source']);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) continue;
  if (!KNOWN.has(a)) {
    console.error(`✗ Argumento no reconocido: "${a}"`);
    console.error(`  Válidos: --write, --source <archivo> (repetible).`);
    console.error(`  Si venía entrecomillado, pásalo sin comillas: --source A.md --source B.md`);
    process.exit(2);
  }
  if (a === '--source' && (i + 1 >= args.length || args[i + 1].startsWith('--'))) {
    console.error(`✗ --source necesita un archivo después.`);
    process.exit(2);
  }
}

const explicit = args.reduce((acc, a, i) => (args[i - 1] === '--source' ? [...acc, a] : acc), []);

const sources = explicit.length
  ? explicit.map((s) => join(root, s))
  : [
      join(root, 'TASKS.md'),
      join(root, 'TASKS_ARCHIVE.md'),
      ...(existsSync(join(root, 'tasks-archive'))
        ? readdirSync(join(root, 'tasks-archive'))
            .filter((f) => f.endsWith('.md'))
            .map((f) => join(root, 'tasks-archive', f))
        : []),
    ].filter(existsSync);

if (sources.length === 0) {
  console.error(`✗ No se encontró ningún archivo fuente bajo ${root}`);
  process.exit(2);
}

const FIELD = /^-\s+(category|type|epic|priority|status|created|updated|branch|done)\s*:\s*(.*)$/i;

const tasks = [];
const perSource = [];

for (const src of sources) {
  const text = readFileSync(src, 'utf8');
  const lines = text.split('\n');
  let current = null;
  let count = 0;

  for (const line of lines) {
    const heading = line.match(/^###\s+(\S+)\s+—\s+(.+?)\s*$/);
    // Skip the template block most trackers carry as a commented-out example: its
    // heading looks exactly like a real entry, so a naive parse turns `{{task-id}}`
    // into a task file. Found migrating a real project.
    if (heading && /\{\{|\}\}/.test(heading[1] + heading[2])) continue;
    if (heading) {
      if (current) tasks.push(current);
      current = { id: heading[1], title: heading[2], fields: {}, body: [], source: basename(src) };
      count++;
      continue;
    }
    if (!current) continue;
    const f = line.match(FIELD);
    if (f && current.body.length === 0) {
      current.fields[f[1].toLowerCase()] = f[2].trim();
      continue;
    }
    current.body.push(line);
  }
  if (current) tasks.push(current);
  perSource.push([basename(src), count]);
}

console.log(`\n  Entradas encontradas por archivo:`);
for (const [name, n] of perSource) console.log(`    ${String(n).padStart(4)}  ${name}`);
console.log(`    ${String(tasks.length).padStart(4)}  TOTAL\n`);

// Duplicate ids across files are real (a task moved from active to archive and was left
// in both). Report rather than silently keeping the last one seen.
const seen = new Map();
const dupes = [];
for (const t of tasks) {
  if (seen.has(t.id)) dupes.push([t.id, seen.get(t.id).source, t.source]);
  else seen.set(t.id, t);
}
if (dupes.length) {
  console.error(`  ⚠ ${dupes.length} id(s) appear in more than one file — the FIRST occurrence is kept:`);
  for (const [id, a, b] of dupes) console.error(`      ${id}: ${a} y ${b}`);
  console.error(`    Review them: usually it means an entry was archived without removing it from active.\n`);
}

const outDir = join(root, 'tasks');
// Imported, not restated. This script used to carry its own copy of "which statuses are
// active" and, like the generator did, collapse everything else to `done` — turning a
// status it didn't recognize into the claim that the work was finished.
const { STATES, RETIRED, normalizeStatus, validStates } =
  await import(join(dirname(fileURLToPath(import.meta.url)), 'task-states.mjs'));

let written = 0, skipped = 0;
const unknown = [];
if (WRITE) mkdirSync(outDir, { recursive: true });

for (const t of seen.values()) {
  // An unreadable or unrecognized status is collected and reported, never guessed. The
  // old behaviour wrote `done` for anything it didn't know, which is how work that had
  // not started got filed as finished.
  const status = normalizeStatus(t.fields.status || '');
  if (!STATES[status]) unknown.push([t.id, t.fields.status || '(sin status)']);
  const fm = [
    '---',
    `id: ${t.id}`,
    `title: ${t.title}`,
    `category: ${t.fields.category || 'Dev'}`,
    `type: ${t.fields.type || ''}`,
    `epic: ${t.fields.epic || ''}`,
    `priority: ${t.fields.priority || ''}`,
    `status: ${STATES[status] ? status : 'REVISAR'}`,
    `created: ${t.fields.created || ''}`,
    `updated: ${t.fields.updated || t.fields.created || ''}`,
    '---',
    '',
    `# ${t.id} — ${t.title}`,
    '',
    ...t.body,
  ].join('\n').replace(/\n{4,}/g, '\n\n\n') + '\n';

  const dest = join(outDir, `${t.id}.md`);
  if (existsSync(dest)) { skipped++; continue; }
  if (WRITE) writeFileSync(dest, fm);
  written++;
}

console.log(`  Files ${WRITE ? 'written' : 'that would be written'}: ${written}`);
if (skipped) console.log(`  Skipped because they already existed: ${skipped}`);

// Reported loudly, and written as `REVISAR` in the file rather than resolved here. A
// migration that picks a state on the task's behalf writes a guess as a fact, and the
// one status that most needs deciding — the retired `in review` — meant three different
// things, so there is no correct automatic answer to give.
if (unknown.length) {
  console.error(`\n  ⚠ ${unknown.length} task(s) traen un status que no es uno de los seis.`);
  console.error(`    Quedaron con \`status: REVISAR\`, que el generador de índices rechaza`);
  console.error(`    a propósito: hay que abrir cada una y decidir en qué punto está.\n`);
  for (const [id, raw] of unknown) {
    const r = RETIRED[normalizeStatus(raw)];
    console.error(`      ${id}: "${raw}"${r ? ` — retirado en ${r.since}; elige entre ${r.options.join(', ')}` : ''}`);
  }
  console.error(`\n    Estados válidos: ${validStates()}\n`);
}

if (!WRITE) {
  console.log(`\n  Nothing was written. Review the counts above and run again with --write.`);
  console.log(`  Después: node scripts/generate-task-index.mjs\n`);
} else {
  // Leave a note in every source location explaining what happened to it. Without this,
  // the old files sit there looking authoritative — two sources of truth for the same
  // tasks, which is the state this migration exists to end. A reader six weeks later
  // cannot tell a live tracker from a migrated husk by looking at it.
  const dirs = [...new Set(sources.map((s) => s.replace(/\/[^/]+$/, '')))].filter((d) => d !== root);
  for (const dir of dirs) {
    const note = join(dir, 'README.md');
    if (existsSync(note)) continue;
    writeFileSync(
      note,
      `# ${basename(dir)} — historical only\n\n` +
        `The task entries that lived here were migrated to one file per task under \`tasks/\` ` +
        `on ${new Date().toISOString().slice(0, 10)} by \`scripts/migrate-tasks-to-files.mjs\`.\n\n` +
        `**Nothing here is a source of truth.** Whatever remains is kept for contrast if the ` +
        `migration ever looks wrong; the live record is \`tasks/\`, indexed by \`TASKS.md\` and ` +
        `\`TASKS_ARCHIVE.md\`, both generated. Files already migrated should be deleted rather ` +
        `than left alongside their replacements — two sources of truth for the same task is ` +
        `exactly what this migration removes.\n`
    );
    console.log(`  Nota dejada en ${note.replace(root + '/', '')}`);
  }
  console.log(`\n  Now regenerate the indexes: node scripts/generate-task-index.mjs`);
  console.log(`  And check that ${written} matches the TOTAL number of entries above.\n`);
}
