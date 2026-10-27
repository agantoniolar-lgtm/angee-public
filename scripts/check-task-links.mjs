#!/usr/bin/env node
/**
 * check-task-links.mjs — a relationship between two pieces of work points at something
 * that exists, and neither side can be closed in silence leaving the other hanging.
 *
 * ── The failure this removes ─────────────────────────────────────────────────────────
 * Relationships between work items existed already — they just lived in prose, inside a
 * note, where nothing could check them. Four real shapes of it were on record here: a
 * backlog row that was the measured leftover of an active task; two defects blocking a
 * criterion of a third task; a defect whose redesign was another task. Every one of them
 * was true, written down, and invisible to every check in the repo.
 *
 * A relationship nobody verifies is tomorrow's drift: when one side closes, nothing
 * reclaims the other. That is the failure mode this kit names `regla-o-entrega-no-
 * comprobada` — a rule that exists and nobody enforces. It already happened in a
 * consuming project, where an escalated pending was left ownerless by a task that got
 * dropped, its mention counter switched off, waiting on nobody.
 *
 * ── What it does not reach YET ───────────────────────────────────────────────────────
 * `resolves:` currently accepts only pendings from PENDINGS.md. The approved model also
 * has it pointing at an entry in the lessons ledger, with the same verification applied to
 * both — but that ledger arrives with the PENDINGS split, and building against a target
 * that has no shape yet would guess it. The limit is dated here and in the error message
 * rather than written as a rule, so that widening it later is an extension and not a
 * contradiction of something this file already told people.
 *
 * ── What it does NOT do, deliberately ────────────────────────────────────────────────
 * It never propagates a closure. Closing a pending because its task reached `done` would
 * guess the intent — maybe the task shipped and the decision still stands open. What is
 * built here is that you cannot close in silence: you close the other side, or you remove
 * the field. Both are decisions; neither is the oversight.
 *
 * ── Errors versus warnings ───────────────────────────────────────────────────────────
 * An error means a claim on disk contradicts another claim on disk, and a human has to
 * pick which one is true. A warning means the state is consistent but something changed
 * that the reader wants to know — a lifted block is news, not a fault. Warnings never
 * affect the exit code: a check that blocks commits over news teaches people to bypass it.
 *
 * Usage:  check-task-links.mjs [repoRoot]
 *
 * Exit codes:
 *   0  every link points at something that exists, and nothing closed in silence
 *   1  at least one broken or contradictory link
 *   2  tasks/ is missing, or a task file is malformed (the generator reports the detail)
 */

import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { readTasks, idList } = await import(join(here, 'task-frontmatter.mjs'));
// A project with no PENDINGS.md declares the pendings pieces in `.ae-kit-excluded`, and
// the natural line to write excludes `pendings-table.mjs` alongside `check-pendings.mjs`
// — it is visibly a pendings file. The installer obeys, and this import then died with a
// ten-line Node stack trace and exit 1, which this script's own header documents as
// "a broken link". A hook that blocks commits with an unactionable trace is how people
// learn to use --no-verify. Missing module = that half of the check is not installed.
let readPendings = () => null;
let OWNERS = null, PENDING_STATES = null, isLive = () => false;
try {
  ({ readPendings, OWNERS, STATES: PENDING_STATES, isLive } =
    await import(join(here, 'pendings-table.mjs')));
} catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  console.log(`\n  · pendings-table.mjs no está instalado — los pendientes no se revisan.`);
  console.log(`    Los enlaces entre tasks sí. Si eso no es deliberado, revisa .ae-kit-excluded.`);
}

const root = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || process.cwd());

const read = readTasks(root);
if (!read) {
  console.error(`✗ ${join(root, 'tasks')}/ does not exist — has the one-file-per-task migration run yet?`);
  process.exit(2);
}
const { tasks, broken, retired } = read;

// A malformed or retired-state file is not this script's story to tell: the generator
// already reports it, with the migration instructions attached. Carrying on regardless
// would judge links against a task list known to be incomplete — and report a clean run
// off a partial read, which is the false green this whole check exists against.
if (broken.length || retired.length) {
  console.error(`\n✗ ${broken.length + retired.length} archivo(s) de task no se pudieron leer, así que los`);
  console.error(`  enlaces no se revisaron: juzgarlos contra una lista incompleta daría un verde falso.`);
  console.error(`  Corre \`generate-task-index.mjs\`, que reporta el detalle y cómo arreglarlo.\n`);
  process.exit(2);
}

const pendingsRead = readPendings(root);
const pendings = pendingsRead ? pendingsRead.rows : [];
const pendingById = new Map(pendings.map((p) => [p.id, p]));
const taskById = new Map(tasks.map((t) => [t.id, t]));

const errors = [];
const warnings = [];
const err = (where, what, how) => errors.push({ where, what, how });
const warn = (where, what) => warnings.push({ where, what });

// ── The pendings table itself: owner and state against their closed lists ────────────
//
// These two lists lived in a comment until today. A comment cannot fail, which is how 14
// rows in a consuming project came to name an owner that does not exist.
if (pendingsRead) {
  for (const m of pendingsRead.malformed) {
    err('PENDINGS.md', m.line ? `${m.why}: ${m.line}` : m.why, m.fix);
  }
  // Two rows claiming the same id: the Map below keeps the last, so the first silently
  // stops existing for every closure check. Hand-written tables get a row copy-pasted
  // when someone adds one, and the generator already guards the equivalent for tasks.
  const seenIds = new Set();
  for (const p of pendings) {
    if (seenIds.has(p.id)) {
      err('PENDINGS.md', `${p.id} aparece en dos filas`,
          'Un id pertenece a un solo pendiente. Renumera el segundo: si no, el primero deja de existir para toda comprobación de cierre.');
    }
    seenIds.add(p.id);
  }

  for (const p of pendings) {
    if (!OWNERS[p.owner]) {
      err(`PENDINGS.md ${p.id}`, `su \`owner\` es \`${p.owner}\`, que no es uno de los válidos`,
          `Elige uno: ${Object.entries(OWNERS).map(([k, v]) => `\`${k}\` (${v})`).join(' · ')}`);
    }
    if (!PENDING_STATES.includes(p.state)) {
      err(`PENDINGS.md ${p.id}`, `su \`state\` es \`${p.state}\`, que no es uno de los válidos`,
          `Elige uno: ${PENDING_STATES.map((s) => `\`${s}\``).join(' · ')}`);
    }
  }
}

// ── The links ────────────────────────────────────────────────────────────────────────

const isDone = (t) => t.status === 'done';
const isDropped = (t) => t.status === 'dropped';
const isClosed = (t) => isDone(t) || isDropped(t);

let linksChecked = 0;

for (const t of tasks) {
  const resolves = idList(t.resolves);
  const blockedBy = idList(t.blocked_by);

  // A repeated id is not a contradiction, so it is news rather than a fault — but it is
  // news worth having, because it usually means an edit was applied twice.
  for (const [field, ids] of [['resolves', resolves], ['blocked_by', blockedBy]]) {
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) warn(t.id, `nombra \`${id}\` dos veces en \`${field}:\` — se cuenta una`);
      seen.add(id);
    }
  }

  for (const id of new Set(resolves)) {
    linksChecked++;

    // Crossing the two fields makes a link that exists and means nothing. Caught before
    // the existence check, so the message says what is actually wrong instead of "no such
    // pending".
    //
    // The message states what `resolves:` resolves TODAY, and says so in those words. The
    // approved model is wider than this: it has `resolves:` also pointing at an entry in
    // the lessons ledger, which does not exist yet — it arrives with the PENDINGS split.
    // Writing "`resolves:` is for pendings" as a flat rule would publish a narrower model
    // than the one that was approved, and the error message is where a reader learns the
    // rule. So the limit is dated instead of stated as law.
    if (taskById.has(id)) {
      err(t.id, `\`resolves: ${id}\` apunta a un task, y hoy \`resolves:\` sólo alcanza a los pendientes de PENDINGS.md`,
          `Si lo que quieres decir es que ${id} lo bloquea, el campo es \`blocked_by:\`. ` +
          `(El modelo aprobado prevé además apuntar a una lección del ledger; ese destino todavía no existe.)`);
      continue;
    }

    const p = pendingById.get(id);
    if (!p && !OWNERS) {
      err(t.id, `declara \`resolves: ${id}\` y el lector de pendientes no está instalado`,
          'No se puede comprobar ese enlace. Instala `pendings-table.mjs`, o quita el campo.');
      continue;
    }
    if (!p) {
      err(t.id, `\`resolves: ${id}\` no existe en PENDINGS.md`,
          `Corrige el id, o quita el campo. Se buscó en ${join(root, 'PENDINGS.md')}.`);
      continue;
    }

    // Decision 4, `resolves:` half. The pending is the side that gets stranded, so the
    // verdict is read off the pending's state, not the task's alone.
    if (isDone(t) && isLive(p.state)) {
      err(t.id, `está en \`done\` y dice \`resolves: ${id}\`, que sigue \`${p.state}\``,
          `O se cierra el pendiente, o se quita el campo. Las dos son decisiones; ninguna es el olvido.`);
    } else if (isDropped(t) && p.state === 'escalated') {
      err(t.id, `quedó en \`dropped\` y ${id} sigue \`escalated\``,
          `Ese pendiente se quedó sin dueño y con su contador apagado. Reasígnalo o ciérralo.`);
    } else if (isDropped(t) && p.state === 'open') {
      warn(t.id, `quedó en \`dropped\` y ${id} sigue \`open\` — ese pendiente perdió a su candidato`);
    }
  }

  for (const id of new Set(blockedBy)) {
    linksChecked++;

    if (id === t.id) {
      err(t.id, 'se declara `blocked_by:` a sí mismo',
          'Un task no se bloquea a sí mismo. Quita el campo, o nombra al que de verdad lo bloquea.');
      continue;
    }

    if (pendingById.has(id)) {
      err(t.id, `\`blocked_by: ${id}\` apunta a un pendiente, y \`blocked_by:\` es para tasks`,
          `Si lo que quieres decir es que este task cierra ${id}, el campo es \`resolves:\`.`);
      continue;
    }

    const b = taskById.get(id);
    if (!b) {
      err(t.id, `\`blocked_by: ${id}\` no existe en tasks/`,
          `Corrige el id, o quita el campo. Se buscó en ${join(root, 'tasks')}/.`);
      continue;
    }

    // Decision 4, `blocked_by:` half.
    if (!isClosed(t) && isDone(b)) {
      warn(t.id, `su bloqueo se levantó: ${id} está en \`done\``);
    } else if (!isClosed(t) && isDropped(b)) {
      warn(t.id, `${id} lo bloquea y quedó en \`dropped\` — ese bloqueo puede no levantarse nunca`);
    } else if (isDone(t) && !isClosed(b)) {
      err(t.id, `está en \`done\` y sigue declarando \`blocked_by: ${id}\`, que no está cerrado`,
          `O el bloqueo no era real y sobra el campo, o esto no está terminado.`);
    }
  }
}

// ── Cycles ───────────────────────────────────────────────────────────────────────────
//
// Reported as the whole cycle rather than as one guilty row: with A→B→A, neither row is
// wrong on its own and blaming either one sends the reader to fix the wrong file.
// Self-references are already reported above, with a message that fits them better.
{
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map(tasks.map((t) => [t.id, WHITE]));
  const stack = [];
  const reported = new Set();

  const visit = (id) => {
    color.set(id, GREY);
    stack.push(id);
    for (const next of new Set(idList(taskById.get(id).blocked_by))) {
      if (next === id || !taskById.has(next)) continue;
      if (color.get(next) === GREY) {
        const cycle = stack.slice(stack.indexOf(next)).concat(next);
        const key = [...cycle].sort().join('|');
        if (!reported.has(key)) {
          reported.add(key);
          err(cycle[0], `ciclo de bloqueo: ${cycle.join(' → ')}`,
              'Ninguno de los dos puede empezar. Rompe el ciclo quitando el `blocked_by:` que sobre.');
        }
      } else if (color.get(next) === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const t of tasks) if (color.get(t.id) === WHITE) visit(t.id);
}

// ── Report ───────────────────────────────────────────────────────────────────────────

console.log(`\n  Enlaces entre tasks y pendientes   (${root})\n`);

// Anything skipped gets said out loud. The parser exempts placeholder rows so a fresh
// project can commit, and an exemption nobody can see is how a real pending disappears
// from the count with the checker still reporting green.
if (pendingsRead && pendingsRead.skipped.length) {
  // The advice travels WITH the reason. It used to be one fixed line — "rellénala o
  // bórrala" — written when the only possible reason was the template's example row. Once
  // rows could also be skipped for sitting inside a comment or a fence, that line was
  // telling the reader to fill in a row somebody deliberately closed.
  for (const { id, why, fix } of pendingsRead.skipped) {
    console.log(`  · ${id} de PENDINGS.md no se revisó — ${why}`);
    if (fix) console.log(`      → ${fix}`);
  }
  console.log('');
}

for (const w of warnings) console.log(`  ⚠ ${w.where} — ${w.what}`);
if (warnings.length) console.log('');

if (errors.length) {
  // "N enlaces rotos" was wrong the moment this script also began judging the pendings
  // table: an invented `owner` is not a link. The heading names what the reader will
  // actually see below it.
  console.error(`✗ ${errors.length} problema(s) en los enlaces o en la tabla de pendientes:\n`);
  for (const e of errors) {
    console.error(`  · ${e.where} — ${e.what}`);
    console.error(`      ${e.how}\n`);
  }
  process.exit(1);
}

// The count is printed on success on purpose. "Nothing to report" and "nothing was
// examined" read identically otherwise, and a checker that passes because it found no
// input to check is a false green — the exact defect this repo's deploy-status suite had.
console.log(`✓ ${linksChecked} enlace(s) revisados en ${tasks.length} task(s) y ${pendings.length} pendiente(s).`);
console.log(`  Todos apuntan a algo que existe, y ningún lado se cerró dejando al otro colgado.\n`);
