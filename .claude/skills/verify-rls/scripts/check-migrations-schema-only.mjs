#!/usr/bin/env node
// Blocks new migrations that mix DDL (schema) with DML (real data).
//
// Why: a migration is tested against the sandbox first, then applied to production (see the
// verify-rls skill, section 2). If a migration mixes ALTER/CREATE with INSERT/UPDATE/DELETE/
// TRUNCATE that depends on real IDs or rows, testing it in the sandbox guarantees nothing —
// the sandbox has different data than production, so the same file can behave differently
// (or have no effect, or overwrite/delete real rows) when applied to prod. This has happened
// before in projects using this kit: historical migrations written before this rule existed
// mix both — they are NOT re-checked retroactively (only NEW files relative to a base ref
// are scanned, see modes below).
//
// Rule going forward: new migrations are schema-only (DDL). A one-off data fix runs as a
// separate script, outside the migrations folder, explicit and confirmed by the project
// owner — never folded into a versioned migration that can be replayed.
//
// DML inside a function/trigger body ($$...$$) does NOT count as a violation — it's
// programmed behavior that runs row-by-row when the trigger fires later, not an immediate
// mutation of real data when the migration itself is applied. It's explicitly stripped
// before scanning.
//
// Escape hatch: if a migration genuinely needs top-level DML (a rare, deliberately-reviewed
// case), add a `-- ALLOW-DML: <reason>` line anywhere in the file. The check passes but
// prints the reason so it stays visible in the commit/CI log.
//
// Modes:
//   --staged              (default, used by .husky/pre-commit) — files staged in git.
//   --diff-against <ref>  (used by CI) — files new/modified between <ref> and HEAD.
//                          If <ref> isn't valid (e.g. first push, before=0000...), doesn't
//                          block: prints a warning and passes clean instead of failing CI
//                          spuriously.
//
// WHERE THE MIGRATIONS LIVE — this check is about SQL migration files, not about any one
// hosting platform. The folder is resolved in this order, so nothing here assumes a vendor:
//
//   1. --migrations-dir <path>     explicit, wins over everything
//   2. MIGRATIONS_DIR env var      for CI, where passing args is awkward
//   3. autodetected               the first of the known conventions below that exists
//
// The autodetect list covers the common tools (Supabase, Prisma, Drizzle, Flyway, Rails,
// Django, golang-migrate, and a bare `migrations/`). If this project keeps them somewhere
// else, pass --migrations-dir or set the env var in the hook and the CI workflow — do not
// edit this list per project, or the file drifts from the kit's copy.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const KNOWN_MIGRATION_DIRS = [
  'supabase/migrations',
  'prisma/migrations',
  'drizzle',
  'db/migrate',
  'migrations',
  'sql/migrations',
];

function resolveMigrationsDir(argv) {
  const flagIndex = argv.indexOf('--migrations-dir');
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1];
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const found = KNOWN_MIGRATION_DIRS.find((dir) => existsSync(dir));
  // No migrations folder anywhere is not an error: a project can legitimately have no
  // database yet. The checks below simply match nothing and the run passes clean.
  return found ?? KNOWN_MIGRATION_DIRS[0];
}

const MIGRATIONS_DIR = resolveMigrationsDir(process.argv);
const DML_PATTERN = /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE|MERGE\s+INTO|COPY\s+\w+\s+FROM)/i;
const ALLOW_PATTERN = /--\s*ALLOW-DML:\s*(.+)/i;
const TRIGGER_EVENT_PATTERN = /\b(BEFORE|AFTER|INSTEAD\s+OF)\s+((?:INSERT|UPDATE|DELETE|TRUNCATE)(?:\s+OR\s+(?:INSERT|UPDATE|DELETE|TRUNCATE))*)\s+ON\b/gi;
// CREATE POLICY ... FOR {ALL|SELECT|INSERT|UPDATE|DELETE} [TO <role>] — the name of the
// command a policy covers, not a DML statement.
const POLICY_COMMAND_PATTERN = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/gi;

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

// Strips function/trigger bodies delimited by dollar-quoting ($$...$$ or $tag$...$tag$) —
// DML inside there is programmed behavior, not an immediate mutation.
function stripDollarQuotedBodies(sql) {
  return sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '');
}

// Strips trigger event clauses ("before update on", "after insert or update on") — these
// aren't DML statements, they're part of CREATE TRIGGER syntax.
function stripTriggerEventClauses(sql) {
  return sql.replace(TRIGGER_EVENT_PATTERN, '');
}

// Strips the command name a policy covers ("for update", "for insert to authenticated") —
// not a DML statement, part of CREATE POLICY syntax.
function stripPolicyCommands(sql) {
  return sql.replace(POLICY_COMMAND_PATTERN, '');
}

function isRealDml(fileContent) {
  const noComments = stripSqlComments(fileContent);
  const noFunctionBodies = stripDollarQuotedBodies(noComments);
  const noTriggerEvents = stripTriggerEventClauses(noFunctionBodies);
  const noPolicyCommands = stripPolicyCommands(noTriggerEvents);
  return DML_PATTERN.test(noPolicyCommands);
}

function getStagedMigrationFiles() {
  const out = execSync(
    `git diff --cached --name-only --diff-filter=ACM -- ${MIGRATIONS_DIR}/*.sql`,
    { encoding: 'utf8' }
  );
  return out.split('\n').filter(Boolean);
}

function getDiffMigrationFiles(baseRef) {
  if (!baseRef || /^0+$/.test(baseRef)) {
    console.warn(`[migrations-schema-only] invalid base ref ("${baseRef}") — likely the first push on this branch. Skipping the check, nothing to diff against.`);
    return null;
  }
  try {
    const out = execSync(
      `git diff --name-only --diff-filter=ACM ${baseRef} HEAD -- ${MIGRATIONS_DIR}/*.sql`,
      { encoding: 'utf8' }
    );
    return out.split('\n').filter(Boolean);
  } catch (err) {
    console.warn(`[migrations-schema-only] couldn't diff against "${baseRef}" (${err.message.split('\n')[0]}) — skipping the check instead of failing CI spuriously.`);
    return null;
  }
}

function main() {
  const diffIdx = process.argv.indexOf('--diff-against');
  const files = diffIdx !== -1
    ? getDiffMigrationFiles(process.argv[diffIdx + 1])
    : getStagedMigrationFiles();

  if (files === null || files.length === 0) {
    process.exit(0);
  }

  let failed = false;

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const allowMatch = raw.match(ALLOW_PATTERN);

    if (isRealDml(raw)) {
      if (allowMatch) {
        console.warn(`[migrations-schema-only] ${file}: DML explicitly allowed — ALLOW-DML: ${allowMatch[1].trim()}`);
        continue;
      }
      failed = true;
      console.error(`[migrations-schema-only] BLOCKED: ${file} contains top-level DML (INSERT/UPDATE/DELETE/TRUNCATE/MERGE/COPY) outside a function/trigger body.`);
      console.error(`  New migrations must be schema-only (DDL) — a one-off data fix goes in a separate script, not in ${MIGRATIONS_DIR}/.`);
      console.error('  If this migration genuinely needs DML (a deliberately-reviewed case), add a line: -- ALLOW-DML: <reason>');
    }
  }

  if (failed) {
    process.exit(1);
  }
}

main();
