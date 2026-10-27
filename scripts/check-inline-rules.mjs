#!/usr/bin/env node
/**
 * check-inline-rules.mjs — find business rules reimplemented inline, away from the pure
 * function that already owns them.
 *
 * ── The bug this is shaped around ────────────────────────────────────────────────────
 * A rule lived as a tested pure function. A second surface re-derived the same rule
 * inline. The search for consumers went by FUNCTION NAME, so the duplicate — which
 * shares no identifier with the function — came back clean. The rule was right; the map
 * of where it lived was wrong, and the two copies drifted.
 *
 * ── How it looks for it ──────────────────────────────────────────────────────────────
 * Not by name. By FINGERPRINT: the distinctive string literals a rule is written in
 * terms of — status values, field names, category keys. A file that mentions several of
 * one function's literals while never importing that function is either re-deriving the
 * rule or about to.
 *
 * ── Honest about what this is ────────────────────────────────────────────────────────
 * A heuristic, not a proof. It will flag files that legitimately share vocabulary, and
 * it cannot see a rule expressed purely in numbers or structure. It is deliberately
 * cheap: the alternative — a real duplicate-logic analysis — costs more than the class
 * of bug it prevents, and this catches the shape that actually shipped.
 *
 * False positives are handled the way this kit handles every tolerated failure: an
 * allowlist file with a reason, never a silently loosened threshold.
 *
 * Usage:  check-inline-rules.mjs [repoRoot] [--lib src/lib] [--min 3]
 * Exit:   0 nothing suspicious (or everything found is allowlisted)
 *         1 at least one un-allowlisted suspicion
 *         2 could not scan (no lib dir)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, basename, extname } from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const root = resolve(positional[0] || process.cwd());
const libDir = join(root, flag('lib', 'src/lib'));
const MIN_SHARED = Number(flag('min', 3));
const ALLOWLIST = join(root, '.github', 'known-inline-rules.txt');

const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

if (!existsSync(libDir)) {
  console.error(`✗ The pure-logic directory does not exist: ${relative(root, libDir) || libDir}`);
  console.error(`  Pass it with --lib <path> if this project keeps it somewhere else.`);
  process.exit(2);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out);
    } else if (CODE_EXT.has(extname(e.name))) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/** String literals distinctive enough to fingerprint a rule. */
function literalsOf(src) {
  const found = new Set();
  for (const m of src.matchAll(/['"]([a-zA-Z][a-zA-Z0-9_]{3,})['"]/g)) found.add(m[1]);
  return found;
}

// ── 1. Fingerprint each exported pure function ──────────────────────────────────────
const libFiles = walk(libDir).filter((f) => !/\.test\./.test(basename(f)));
const rules = [];

for (const file of libFiles) {
  const src = readFileSync(file, 'utf8');
  // Split on exported function declarations; each chunk is one function's body-ish.
  const parts = src.split(/export\s+(?:async\s+)?function\s+/);
  for (let i = 1; i < parts.length; i++) {
    const name = parts[i].match(/^([A-Za-z0-9_]+)/)?.[1];
    if (!name) continue;
    const lits = literalsOf(parts[i]);
    if (lits.size >= MIN_SHARED) {
      rules.push({ name, file: relative(root, file), literals: lits });
    }
  }
}

if (rules.length === 0) {
  console.log(`○ No pure function with enough literals to fingerprint in ${relative(root, libDir)}.`);
  process.exit(0);
}

// ── 2. Look for those fingerprints outside, in files that never import the function ──
const allFiles = walk(join(root, 'src')).filter(
  (f) => !f.startsWith(libDir) && !/\.test\./.test(basename(f))
);

const allowed = existsSync(ALLOWLIST)
  ? readFileSync(ALLOWLIST, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  : [];

const suspicions = [];
for (const file of allFiles) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  for (const rule of rules) {
    if (new RegExp(`\\b${rule.name}\\b`).test(src)) continue; // imports/uses it — fine
    const shared = [...rule.literals].filter((l) => new RegExp(`['"]${l}['"]`).test(src));
    if (shared.length >= MIN_SHARED) {
      const key = `${rel} :: ${rule.name}`;
      if (allowed.includes(key)) continue;
      suspicions.push({ key, rel, rule, shared });
    }
  }
}

console.log(`\n  Funciones puras huelleadas: ${rules.length}   ·   archivos revisados: ${allFiles.length}\n`);

if (suspicions.length === 0) {
  console.log(`✓ No file re-derives a pure function's vocabulary without calling it.\n`);
  process.exit(0);
}

for (const s of suspicions) {
  console.error(`  ✗ ${s.rel}`);
  console.error(`      shares ${s.shared.length} literals with ${s.rule.name}() (${s.rule.file}) and never calls it`);
  console.error(`      → ${s.shared.slice(0, 6).join(', ')}${s.shared.length > 6 ? '…' : ''}`);
}
console.error(
  `\n✗ ${suspicions.length} posible(s) regla reimplementada inline.` +
  `\n  Review each one: either call the pure function, or — if it genuinely is something` +
  `\n  else — record it in .github/known-inline-rules.txt as "<file> :: <function>" with a` +
  `\n  reason. Searching by function name never finds these: an inline copy shares no identifier.\n`
);
process.exit(1);
