#!/usr/bin/env node
/**
 * emit-lessons.mjs — the return channel's push half: a project sends what it learned
 * back to the kit, as an issue, without sending anything about itself.
 *
 * ── The two guarantees, and why they are built this way ──────────────────────────────
 *
 * 1. CONSENT IS EXPLICIT, WITH NO DEFAULT. A project's engineering lessons are arguably
 *    its owner's, not the kit's. "Yes" by default makes every client a donor without
 *    knowing it; "no" by default kills the channel silently. So the answer must be on
 *    record in `.ae-kit-contrib`, and anything else — missing, blank, unreadable —
 *    refuses to emit and says so. Absence is not consent.
 *
 * 2. DE-IDENTIFICATION IS BY SCHEMA FIRST, AND BY A HUMAN GATE LAST. A closed set of
 *    fields, hard length caps, patterns that cannot appear, and a deny-list derived from
 *    THIS project (its git authors, its remote, its own name) rather than a generic regex
 *    of common names. A restricted schema is checkable; a reviewed paragraph is not.
 *
 *    A deny-list that cannot be DERIVED is a missing guarantee, not a satisfied one, and
 *    refuses to emit (exit 5). That distinction is the same one that makes the deploy
 *    checker withhold a green light when a check has not reported.
 *
 *    ⚠ WHY THE HUMAN GATE EXISTS, and why it is not belt-and-braces. This started as
 *    schema-only, on the reasoning that a closed schema is verifiable while a reviewed
 *    paragraph is not. That reasoning was right about the schema and wrong about the
 *    conclusion: the schema is verifiable, but the LIST OF FORBIDDEN PATTERNS is not
 *    provably complete. Two independent review rounds broke it eleven times — a zero-width
 *    space inside a name, a Cyrillic homoglyph, a soft hyphen, a UUID, a purely numeric
 *    id — and each round found holes in what the previous round had just repaired. The
 *    evasion space (Unicode forms, confusables, id formats) does not get exhausted by
 *    another patch. So the automated checks stay as the first filter, and the owner
 *    approves what actually leaves: nothing is sent without `--approved`.
 *
 * Nothing here proposes code to the kit. The payload is data: fixed fields with no room
 * for a diff. The owner reads the issue, decides, and writes any kit change themselves.
 *
 * Exit codes:
 *   0  emitted
 *   1  rejected by the schema or the deny-list — nothing was written or sent
 *   2  this project declared it does not contribute — a normal, silent outcome
 *   3  consent was never recorded, or is unreadable — the owner has to answer
 *   4  the payload file is missing or is not valid JSON
 *   5  the deny-list could not be derived — cannot guarantee de-identification
 *   6  validated, but the issue could not be opened — nothing left this machine
 *   7  validated and printed, waiting for the owner's approval — nothing sent
 *   8  unrecognized argument
 *   9  the content changed since it was approved — nothing sent
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
const payloadPath = args.find((a) => !a.startsWith('--'));
// slice(1).join('=') and not [1]: a path containing '=' was truncated at the first one,
// so the deny-list would have been derived from a different project while emission
// proceeded asserting the guarantee.
const repoRoot = resolve(
  (args.find((a) => a.startsWith('--repo-root=')) || '=.').split('=').slice(1).join('=') || '.'
);
const dryRun = args.includes('--dry-run');
// `--approved=<digest>`, never a bare flag. See the gate section at the bottom.
const approvedDigest = (args.find((a) => a.startsWith('--approved=')) || '').split('=')[1] || null;

// Any argument we don't understand aborts. A destructive default reached by silently
// discarding input is the exact failure this kit exists to eliminate — and the migrator
// in this same folder shipped with that bug.
const known = new Set(['--dry-run']);
for (const a of args) {
  if (a.startsWith('--') && !known.has(a) && !a.startsWith('--repo-root=') && !a.startsWith('--approved=')) {
    // Exit 8, not 4: collapsing "bad argument" into "bad payload" hid which of the two
    // happened, in a script whose own comment calls a silently discarded argument the
    // failure this kit exists to eliminate.
    console.error(`✗ Argumento no reconocido: ${a}`);
    if (a === '--approved') console.error('  The gate requires --approved=<digest>, not a bare flag.');
    process.exit(8);
  }
}

// ── The closed schema. Adding a field here is a deliberate act, never a convenience. ──
const CATEGORIES = [
  'regla-o-entrega-no-comprobada', // F1+F5 merged: the excavation found their instances identical
  'bug-silencioso',                // the system doesn't break, it lies
  'supuesto-heredado-falso',
  'scaffold-repetido',
  'artefacto-derivado-corrompido',
  'loop-o-relitigio',
  'decision-de-no-agregar',        // F8, asked in reverse — the phrasing that produced material
  'contexto-compartido-corrompio', // the same agent evaluating what it produced
];

const TEXT_FIELDS = { lesson: 300, proposed_change: 300, enforcing_mechanism: 200 };
const SCHEMA_FIELDS = new Set([
  'kit_version', 'category', ...Object.keys(TEXT_FIELDS),
  'owner_reported', 'evidence',
]);
const EVIDENCE_FIELDS = new Set([
  'files_touched_after_done', 'tests_added', 'status_reversals', 'sessions_carried',
]);

// Shapes that carry identity even with no name in them.
const FORBIDDEN = [
  [/[A-Za-z0-9_.-]*[/\\][A-Za-z0-9_.\\/-]+/, 'a file path'],
  [/\bT\d{2,4}\b/i, 'un id de task'],
  [/\b[\w-]+\.(jsx?|tsx?|d\.ts|mjs|cjs|json|ya?ml|toml|env|css|s[ac]ss|html?|sql|py|rb|go|rs|sh|ini|conf)\b/i, 'a file name'],
  [/\b(from|join|into|table|schema|update|insert)\s+["`']?\w+/i, 'un nombre de tabla'],
  [/https?:\/\/\S+/, 'a URL'],
  [/\b[\w.+-]+@[\w-]+\.\w+\b/, 'un correo'],
  // Opaque identifiers, in the three shapes they actually take. Splitting these apart
  // matters: one combined pattern either missed UUIDs (whose hyphens are word
  // boundaries) and numeric ids, or — when widened — rejected ordinary long Spanish
  // words like "responsabilidades", and a validator that rejects legitimate input
  // trains its operator to weaken it.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, 'un UUID'],
  [/\b\d{10,}\b/, 'un identificador numérico'],
  [/\b(?=[a-z0-9-]*\d)(?=[a-z0-9-]*[a-z])[a-z0-9-]{16,}\b/i, 'un identificador alfanumérico'],
  [/\b[a-z]{20,}\b/i, 'an opaque run of letters'],
  // Four-plus hyphenated chunks: the shape a hyphenated instance ref takes, and one no
  // Spanish sentence produces. Without it, hyphenating a ref slipped past all of the
  // above — the hyphens are word boundaries, so no single chunk was long enough.
  [/\b[a-z0-9]{3,}(-[a-z0-9]{3,}){3,}\b/i, 'un identificador segmentado'],
];

const fail = (msg, code = 1) => { console.error(`✗ ${msg}`); process.exit(code); };

function git(...a) {
  return execFileSync('git', ['-C', repoRoot, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// ── 1. Consent, before anything else is even read ────────────────────────────────────
const consentPath = join(repoRoot, '.ae-kit-contrib');
if (!existsSync(consentPath)) {
  fail(
    'Este proyecto no ha declarado si contribuye lecciones al kit.\n' +
    '  `.ae-kit-contrib` with `yes` or `no` is missing.\n' +
    '  There is no default on purpose: defaulting to "yes" turns a client into a donor\n' +
    '  without them knowing, and defaulting to "no" kills the channel silently. Ask the owner.',
    3
  );
}
// existsSync says nothing about readability: a directory, or a file with no read
// permission, threw here and exited 1 — the code this script documents as "rejected by
// the schema". The one case the docs promise to handle (unreadable) was the one that
// reported as something else entirely.
let consentRaw;
try {
  consentRaw = readFileSync(consentPath, 'utf8');
} catch (e) {
  fail(
    `\`.ae-kit-contrib\` existe pero no se pudo leer (${e.code || e.message}).\n` +
    `  No se interpreta ni se cae a un default.`,
    3
  );
}
const consent = consentRaw.trim().split('\n')[0].trim().toLowerCase();
if (consent === 'no') {
  console.log('○ This project declared it does not contribute to the kit. Nothing is emitted.');
  process.exit(2);
}
if (consent !== 'yes') {
  fail(
    `\`.ae-kit-contrib\` existe pero no dice ni \`yes\` ni \`no\`.\n` +
    `  Valor encontrado: ${JSON.stringify(consent.slice(0, 60))}\n` +
    `  No se interpreta ni se cae a un default.`,
    3
  );
}

// ── 2. The deny-list, derived from THIS project ──────────────────────────────────────
/**
 * Fold a string to the form both sides of the comparison are compared in.
 *
 * This is not cosmetic. Comparing raw bytes meant "Adrián" and "Adrian" were different
 * strings, and so were the NFC and NFD spellings of the SAME name — and macOS hands you
 * NFD routinely, so a leak needed no bad faith at all, just text that had passed through
 * the filesystem. Writing a Mexican name without accents is likewise the norm, not the
 * exception. The fixtures missed all of it because they only varied capitalization, which
 * happened to be the one normalization the code did apply: a suite confirming the single
 * case that was covered.
 */
/**
 * Confusables that render identically to a Latin letter. Not a complete table — no such
 * table is complete — but it closes the cheap, common evasions.
 */
const CONFUSABLES = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ѕ: 's', ԁ: 'd',
  ν: 'v', ο: 'o', ρ: 'p', α: 'a', ε: 'e', ι: 'i', κ: 'k', τ: 't', υ: 'u',
};

const fold = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    // Format characters — zero-width space/joiner, soft hyphen, bidi marks — survive
    // NFKD untouched, and a single one inside a name defeated the entire deny-list.
    // They arrive on their own through browsers, PDFs and terminal copy/paste, so this
    // needed no bad faith at all.
    .replace(/[\p{Cf}​-‍﻿­]/gu, '')
    .toLowerCase()
    .replace(/[Ѐ-ӿͰ-Ͽ]/g, (c) => CONFUSABLES[c] || c);

function buildDenyList() {
  const terms = new Set();
  /** Returns how many terms it actually contributed — "the source answered" is not the
   *  same claim as "the source produced something to compare against". */
  const add = (s) => {
    const before = terms.size;
    // Split on '.' and '-' too. A repo slug like `plataforma-socios` was only ever stored
    // whole, so the client's name written the way a person writes it — with a space —
    // never matched, and the repo slug is usually the most reliable source of that name.
    for (const tok of String(s).split(/[\s,<>()[\]{}"'|/\\@:;.\-_]+/)) {
      const t = fold(tok.trim());
      if (t.length >= 4 && !/^\d+$/.test(t)) terms.add(t);
    }
    const whole = fold(String(s).trim());
    if (whole.length >= 4 && /[.\-_]/.test(whole)) terms.add(whole);
    return terms.size - before;
  };

  // Track WHICH sources actually answered. "The list is non-empty" is not the same claim
  // as "the derivation ran": a folder name alone satisfied the old length check, so a
  // directory with no git and no CLAUDE.md sailed through asserting a guarantee nobody
  // had computed. The guard has to measure what it says it measures.
  let derived = 0;

  try {
    const authors = git('log', '--format=%an%n%ae', '-n', '400');
    // Commits authored entirely by a bot contribute only the bot's own name, most of
    // which is in STOP — so the history "answered" while the human owner's name never
    // entered the list at all. Counting contributed terms, not replies, is what makes
    // exit 5 fire in that case instead of asserting a guarantee nobody computed.
    if (authors) { let n = 0; for (const l of authors.split('\n')) n += add(l); if (n > 0) derived++; }
  } catch { /* no history */ }
  try { const r = git('config', '--get', 'remote.origin.url'); if (r && add(r) > 0) derived++; } catch { /* no remote */ }

  const claudeMd = join(repoRoot, 'CLAUDE.md');
  if (existsSync(claudeMd)) {
    const text = readFileSync(claudeMd, 'utf8');
    const h1 = text.match(/^#\s+(.+)$/m);
    // Only the proper name, not the whole heading: taking all of
    // "# Something — Reglas de operación" banned the word "reglas", and almost every
    // honest lesson about this kit says "reglas". A validator that rejects legitimate
    // input trains its operator to weaken it, and that is where the real guarantee dies.
    if (h1 && add(h1[1].split(/[—–:|]/)[0]) > 0) derived++;
    for (const d of text.match(/\b[a-z0-9-]+\.(com|mx|net|org|io|dev|app|ai)\b/gi) || []) add(d);
  }

  // The directory name is a weak signal (it is often a generic checkout folder), so it
  // goes in the list but never counts as a source that answered.
  try { add(repoRoot.split('/').pop()); } catch { /* unreachable */ }

  // Words too generic to be identifying — keeping them would reject every honest payload.
  const STOP = new Set([
    'github', 'gitlab', 'https', 'http', 'main', 'origin', 'test', 'user', 'name',
    'none', 'null', 'true', 'false', 'claude', 'code', 'noreply', 'users', 'home',
    'reglas', 'operacion', 'proyecto', 'plataforma',
  ]);
  for (const s of STOP) terms.delete(s);
  return { terms: [...terms], derived };
}

const { terms: denyList, derived } = buildDenyList();
if (derived === 0) {
  fail(
    "Could not derive this project's deny-list.\n" +
    '  Ninguna fuente respondió: sin historial de git, sin remoto y sin CLAUDE.md.\n' +
    '  Without it there is no way to claim the payload is de-identified — and a missing\n' +
    '  guarantee is not a satisfied one. Nothing is emitted.',
    5
  );
}
if (denyList.length === 0) {
  fail('The deny-list came out empty even though a source responded. Nothing is emitted.', 5);
}

// ── 3. The payload ───────────────────────────────────────────────────────────────────
if (!payloadPath || !existsSync(payloadPath)) {
  fail(`Payload file not found: ${payloadPath || '(none given)'}`, 4);
}
let payload;
try {
  payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
} catch (e) {
  fail(`El payload no es JSON válido: ${e.message}`, 4);
}

const lessons = Array.isArray(payload.lessons) ? payload.lessons : null;
if (!lessons) fail('El payload debe traer un arreglo `lessons` (puede ir vacío).', 1);

// An empty payload is emitted, never skipped: "nothing to report" and "never ran" have to
// stay distinguishable, or the channel's silence becomes unreadable.
const problems = [];

lessons.forEach((lesson, i) => {
  const where = `lecciones[${i}]`;

  // A non-object element used to reach Object.keys() and throw, so a malformed JSON
  // exited with the code documented as "rejected by the schema" — reporting a crash as
  // if the schema had decided something.
  if (typeof lesson !== 'object' || lesson === null || Array.isArray(lesson)) {
    problems.push(`${where}: no es un objeto de lección.`);
    return;
  }

  for (const key of Object.keys(lesson)) {
    if (!SCHEMA_FIELDS.has(key)) {
      problems.push(`${where}: campo \`${key}\` fuera del esquema — el esquema es lista blanca.`);
    }
  }

  if (!CATEGORIES.includes(lesson.category)) {
    problems.push(`${where}: categoría desconocida \`${lesson.category}\`.`);
  }
  if (typeof lesson.owner_reported !== 'boolean') {
    problems.push(`${where}: \`owner_reported\` tiene que ser booleano.`);
  }

  if (lesson.evidence !== undefined) {
    if (typeof lesson.evidence !== 'object' || lesson.evidence === null || Array.isArray(lesson.evidence)) {
      problems.push(`${where}: \`evidence\` tiene que ser un objeto de contadores.`);
    } else {
      for (const [k, v] of Object.entries(lesson.evidence)) {
        if (!EVIDENCE_FIELDS.has(k)) problems.push(`${where}: \`evidence.${k}\` fuera del esquema.`);
        else if (!Number.isInteger(v) || v < 0) problems.push(`${where}: \`evidence.${k}\` tiene que ser un entero ≥ 0 — sólo cuentas, nunca texto.`);
      }
    }
  }

  for (const [field, cap] of Object.entries(TEXT_FIELDS)) {
    const value = lesson[field];
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${where}: \`${field}\` falta o va vacío.`);
      continue;
    }
    if (value.length > cap) {
      problems.push(`${where}: \`${field}\` excede ${cap} caracteres — el tope es lo que impide que quepa una cita.`);
    }
    for (const [re, what] of FORBIDDEN) {
      if (re.test(value)) problems.push(`${where}: \`${field}\` contiene ${what}.`);
    }
    const lower = fold(value);
    for (const term of denyList) {
      if (lower.includes(term)) {
        problems.push(`${where}: \`${field}\` contiene "${term}", que está en la deny-list derivada de este proyecto.`);
      }
    }
  }
});

if (problems.length > 0) {
  console.error('✗ El payload no sale. Hallazgos:\n');
  for (const p of problems) console.error(`  · ${p}`);
  console.error(
    '\n  Nada se escribió ni se envió: no existe un payload parcialmente saneado.\n' +
    '  Reescribe la lección en términos generales — si no se puede decir sin nombrar\n' +
    '  algo de este proyecto, probablemente no es una lección para el kit.'
  );
  process.exit(1);
}

// ── 4. Emit ──────────────────────────────────────────────────────────────────────────
const kitVersion = existsSync(join(repoRoot, '.ae-kit-version'))
  ? (readFileSync(join(repoRoot, '.ae-kit-version'), 'utf8').match(/\d+\.\d+\.\d+/) || ['desconocida'])[0]
  : 'desconocida';

const body = [
  `**kit:** ${kitVersion}`,
  `**lecciones:** ${lessons.length}`,
  '',
  ...(lessons.length === 0 ? ['_Sin lecciones esta sesión._'] : lessons.flatMap((l, i) => [
    `### ${i + 1}. \`${l.category}\``,
    `- **Lección:** ${l.lesson}`,
    `- **Cambio propuesto:** ${l.proposed_change}`,
    `- **Mecanismo que lo haría cumplir:** ${l.enforcing_mechanism}`,
    `- **Reportado por el dueño:** ${l.owner_reported ? 'sí' : 'no'}`,
    ...(l.evidence ? [`- **Evidencia:** ${Object.entries(l.evidence).map(([k, v]) => `${k}=${v}`).join(', ')}`] : []),
    '',
  ])),
].join('\n');

// `logs/lessons/`, not `logs/`. Until 0.36.0 this report landed straight in `logs/`, where
// `check-log-layout.mjs` — the other half of the same kit — refused it as "neither a session
// log nor the deploy-checks log". Two scripts of one kit contradicting each other left every
// project that emits lessons with a red verifier it could do nothing about. The folder is
// created here, and only here, because nothing is written until the payload has passed:
// a rejected run must leave no trace at all, not even an empty folder.
const outDir = join(repoRoot, 'logs', 'lessons');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'lesson-payload.md');
writeFileSync(outPath, body);

console.log(`✓ Payload validado — ${lessons.length} lección(es), kit ${kitVersion}.`);
console.log(`  Escrito en ${outPath}`);
if (dryRun) {
  console.log('  (--dry-run: no se abrió issue)');
  process.exit(0);
}

// ── The human gate ───────────────────────────────────────────────────────────────────
// It binds an approval to CONTENT, not to a run. The first version took a bare
// `--approved`, and the two-run flow re-read the payload from disk each time — so
// editing the file between the two runs published text nobody had seen, with no signal
// that anything had changed. It also never printed the body it was asking about ("show
// them the content above" — above was a one-line summary), and never said which repo it
// was about to publish to. A gate that doesn't show what it's gating isn't one.
// OJO: este destino NO es el mismo que el de install.sh ni el de check-kit-current.mjs.
// Aquellos van a `angee`, el artefacto del que un proyecto instala. Una lección es material
// de DESARROLLO: se abre como issue en el taller, `ae-setup`, que es donde vive el diario de
// obra y donde alguien puede trabajarla. `angee` se publica sin historia y no tiene dónde
// recibirla. Por eso la variable es propia y no `AE_KIT_REPO`: compartirla mandaría las
// lecciones al repo equivocado en cuanto alguien apuntara el instalador a otro sitio.
const KIT_DEV_REPO = process.env.AE_KIT_DEV_REPO || 'agantoniolar-lgtm/ae-setup';
const digest = createHash('sha256').update(`${KIT_DEV_REPO}\n${body}`).digest('hex').slice(0, 16);

if (!approvedDigest) {
  // stderr, like every other refusal: on stdout, a run that sent nothing began with a ✓
  // and read as success to anything scanning output.
  console.error(`\n${'─'.repeat(70)}`);
  console.error('CONTENIDO EXACTO QUE SE PUBLICARÍA — léelo completo antes de aprobar:');
  console.error(`${'─'.repeat(70)}\n`);
  console.error(body);
  console.error(`${'─'.repeat(70)}`);
  console.error(`Destino: issue nuevo en ${KIT_DEV_REPO}`);
  console.error(
    `\n⏸ Falta la aprobación del dueño. Nada ha salido de esta máquina.\n\n` +
    `  Muéstrale el bloque de arriba VERBATIM — no un resumen — y sólo si lo aprueba:\n\n` +
    `    node ${process.argv[1].split('/').pop()} <payload> --repo-root=… --approved=${digest}\n\n` +
    `  El digest ata la aprobación a ESTE contenido y a ESE destino: si el payload cambia,\n` +
    `  el digest deja de coincidir y la corrida se detiene. Los checks automáticos son el\n` +
    `  primer filtro; la lista de patrones prohibidos no es demostrablemente completa, así\n` +
    `  que quien responde por lo que sale es una persona, no un regex.`
  );
  process.exit(7);
}

if (approvedDigest !== digest) {
  console.error(
    `✗ El contenido cambió desde que se aprobó.\n` +
    `  Aprobado: ${approvedDigest}\n` +
    `  Actual:   ${digest}\n` +
    `  No se envía nada. Vuelve a correr sin --approved, muestra el contenido nuevo,\n` +
    `  y pide aprobación otra vez.`
  );
  process.exit(9);
}

try {
  const url = execFileSync('gh', [
    'issue', 'create', '--repo', KIT_DEV_REPO,
    '--title', `lecciones · kit ${kitVersion} · ${lessons.length}`,
    '--body', body,
  ], { encoding: 'utf8', timeout: 30_000 }).trim();
  console.log(`  Issue abierto: ${url}`);
} catch {
  // Exit 6, not 0. Returning "emitted" when nothing left the machine meant an
  // unauthenticated `gh` would let every session report green forever while the channel
  // silently carried nothing — the same "could not do it is not the same as did it"
  // standard the rest of the kit applies. Non-blocking, but it must be reportable.
  console.error(
    `○ No se pudo abrir el issue en ${KIT_DEV_REPO} (sin red, sin \`gh\`, sin permisos, o timeout).\n` +
    `  El payload quedó validado en ${outPath}, pero NO salió de esta máquina.`
  );
  process.exit(6);
}
