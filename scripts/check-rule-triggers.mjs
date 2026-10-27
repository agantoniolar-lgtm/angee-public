#!/usr/bin/env node
/**
 * check-rule-triggers.mjs — every rule in CLAUDE.md must name a trigger that actually exists.
 *
 * ── Why this exists (2026-08-09, Capability 1) ────────────────────────────────────────
 * A rule written in CLAUDE.md is a sentence. A trigger is a thing that runs. The gap
 * between the two is where this kit's documented failures live:
 *
 *   - A rule requiring the deploy to be verified after every push had no trigger at all.
 *     Measured 2026-07-28: check-deploy-status.sh ran ZERO times across five commits.
 *   - `verify-evals` declared itself complete on 2026-07-22 without producing a single
 *     eval, because nothing checked that its declared output existed.
 *
 * Both are the same defect: a rule whose enforcement depends on someone remembering.
 * This script makes that defect visible and fails the build on it.
 *
 * ── What it checks (STATIC) ───────────────────────────────────────────────────────────
 * That each rule NAMES a trigger, and that the named trigger EXISTS in this repo — the
 * hook file is present and contains the command, the workflow is present, the skill
 * directory is there. It does NOT check that the trigger ran for a given commit; that's
 * a DYNAMIC question, answered by the artifact each trigger writes (see the
 * `verification` column). Keeping the two apart is deliberate: a repo can have a
 * perfectly wired hook that nobody's run yet, and that's a different problem than a rule
 * with nothing behind it.
 *
 * ── Trigger grammar ───────────────────────────────────────────────────────────────────
 *   hook:<name>:<substring>    a git hook (.husky/<name> or .githooks/<name>) containing <substring>
 *   claude-hook:<Event>:<text> a Claude Code hook: .claude/settings.json declares <Event> (e.g.
 *                              SubagentStop) and some command under it contains <text>. Read from
 *                              .claude/settings.json ONLY — never settings.local.json, which is not
 *                              versioned, so a rule satisfied by it would be green on one machine
 *                              and red in CI. Named `claude-hook:` beside `hook:` (git) because what
 *                              distinguishes them is who executes them, not which file holds them.
 *   ci:<file>:<substring>      .github/workflows/<file> containing <substring>
 *   skill:<name>[:<step>]      .claude/skills/<name>/SKILL.md exists. <step> is free text; a
 *                              <step> that looks like a path is rejected — that is `script:` backwards.
 *   script:<path>:<skill>      a file at <path>, AND .claude/skills/<skill>/SKILL.md names it
 *   owner:<what>               a human trigger, declared on purpose (e.g. the owner walks the UI).
 *                              Reported separately — honest, not silently counted as automated.
 *   none                       an admitted gap. Always a defect; that is the point.
 *
 * Exit codes:
 *   0  every rule names a trigger that exists
 *   1  at least one rule has a missing, malformed, or absent trigger
 *   2  CLAUDE.md or its rules table could not be found/parsed
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repoRoot = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const claudeMd = join(repoRoot, 'CLAUDE.md');

const RULES_HEADING = /^##\s+Reglas\b|^##\s+Rules\b/i;

function fail(msg, code = 2) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

if (!existsSync(claudeMd)) fail(`There is no CLAUDE.md at ${repoRoot}`);

const lines = readFileSync(claudeMd, 'utf8').split('\n');

// Find the rules table: the first markdown table after the Rules heading.
let inRules = false;
const rows = [];
for (const line of lines) {
  if (RULES_HEADING.test(line)) { inRules = true; continue; }
  if (inRules && /^##\s/.test(line)) break;          // next section ends the table
  if (!inRules) continue;
  // A rule row starts with | R<digits> |
  if (/^\|\s*R\d+\s*\|/.test(line)) {
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 4) {
      fail(`Fila mal formada (se esperaban 4 columnas): ${line.trim()}`);
    }
    const [id, rule, trigger, verification] = cells;
    rows.push({ id, rule, trigger: stripCode(trigger), verification: stripCode(verification) });
  }
}

function stripCode(s) {
  return s.replace(/`/g, '').trim();
}

if (rows.length === 0) {
  fail('Could not find the rules table in CLAUDE.md (is the "## Rules" section missing?)');
}

/** Resolve a hook by name across the two layouts the kit supports. */
function hookPath(name) {
  for (const dir of ['.husky', '.githooks']) {
    const p = join(repoRoot, dir, name);
    // isFile: `hook:` with an empty or dot name resolves to the directory itself, which exists —
    // and then readFileSync threw EISDIR, dumping a Node stack trace where this script has a
    // prose finding format for everything else.
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

// Does this read as a file path rather than as a step? Deliberately not "any slash": a step
// like `paso 2/3` or `fase 1/2` is legitimate free text, and rejecting it told its author to
// write `script:paso 2/3:<skill>`, an instruction that makes no sense. And deliberately not a
// fixed extension list either: that let `check-pendings.bash`, `.cjs` and `.rb` through, so the
// guard only covered whichever languages someone had thought to list. The rule: a step with a
// SPACE in it is prose and passes; otherwise it is a path when any segment carries an extension.
function looksLikeAPath(step) {
  if (/\s/.test(step)) return false;
  // An extension ends in letters. A trailing `.<digits>` is a number, not a file type: `paso-3.2`,
  // `fase-1.2`, `v1.2` and `v2.0.1` are steps, and rejecting them told their author to write
  // `script:paso-3.2:<skill>`, which then fails for a different reason. A project numbering its
  // steps by subsection — the way this repo numbers its own — could not commit.
  return step.split('/').some((seg) => /[^./]\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(seg));
}

// A trigger names something IN this repo, in the place its own type keeps it: a workflow lives
// directly in .github/workflows/, a hook directly in .husky/ or .githooks/, a skill directly in
// .claude/skills/, and a script anywhere inside the tree. None is ever reached by walking out
// with `..` or from an absolute path. Applied to EVERY segment that becomes part of a path:
// guarding only the script's own path left the caller's name — `script:x.mjs:../../otro/skill` —
// reading a SKILL.md from another repository, and passing green.
function escapesRepo(p, { allowSubdirs = false } = {}) {
  if (!p) return false;
  if (p.startsWith('/')) return true;
  const parts = p.split('/');
  if (parts.includes('..')) return true;
  return !allowSubdirs && parts.length > 1;
}

function checkTrigger(trigger) {
  if (trigger === 'none' || trigger === '' || trigger === '—') {
    return { ok: false, kind: 'none', detail: 'the rule names no trigger at all' };
  }

  const [kind, ...rest] = trigger.split(':');

  switch (kind) {
    case 'hook': {
      const [name, ...needleParts] = rest;
      const needle = needleParts.join(':');
      if (!name || name === '.') {
        return { ok: false, kind: 'malformado', detail: 'malformed: `hook:` names no hook' };
      }
      if (escapesRepo(name)) {
        return { ok: false, kind: 'malformado', detail: `malformed: "${name}" is not a hook name in .husky/ or .githooks/` };
      }
      const p = hookPath(name);
      if (!p) return { ok: false, kind, detail: `hook "${name}" does not exist (neither .husky/ nor .githooks/)` };
      if (needle && !readFileSync(p, 'utf8').includes(needle)) {
        return { ok: false, kind, detail: `hook "${name}" exists but does not run "${needle}"` };
      }
      return { ok: true, kind, detail: p.replace(repoRoot + '/', '') };
    }
    // A Claude Code hook is not a git hook: it lives in `.claude/settings.json` and Claude Code
    // runs it, so `hook:` cannot see it. Before this type existed, the only honest way to write
    // such a rule was `owner:`, which declares manual something that runs on its own — and that
    // is the degradation R28 exists to stop, arriving through a gap in the grammar instead of
    // through carelessness. The four failures below are four different repairs, so they are four
    // different messages: a missing file is an install, bad JSON is a syntax fix, a missing event
    // is a new block, and a missing command is one edited line.
    case 'claude-hook': {
      const [event, ...needleParts] = rest;
      const needle = needleParts.join(':');
      // An empty or blank event is a defect in the RULE, not an unmet rule: nothing is being
      // claimed, so there is nothing to repair in the project. Reported as malformed, the way
      // `hook:`/`ci:`/`skill:` report their own empty names.
      if (!event || !event.trim()) {
        return {
          ok: false,
          kind: 'malformado',
          detail: 'malformed: `claude-hook:` names no event — write `claude-hook:<Event>:<text the command contains>`, e.g. `claude-hook:SubagentStop:collect-subagent.mjs`',
        };
      }
      // And an empty text is the two-part form `ci:` and `hook:` still tolerate for history's
      // sake. This type is new, so it has no such history to preserve — and §4c of
      // SETUP_CHECKLIST records what that tolerance costs: a row that goes green over a file
      // whose only mention of the command is a comment. A `claude-hook:` row names its command.
      if (!needle.trim()) {
        return {
          ok: false,
          kind: 'malformado',
          detail: `malformed: \`claude-hook:${event}\` names no command — the event alone would go green over a hook that runs something else entirely. Write \`claude-hook:${event}:<text the command contains>\`.`,
        };
      }
      const settingsPath = join(repoRoot, '.claude', 'settings.json');
      if (!existsSync(settingsPath) || !statSync(settingsPath).isFile()) {
        return {
          ok: false,
          kind,
          detail: `there is no .claude/settings.json, so no Claude Code hook is declared at all — the repair is that FILE, not the "${event}" block inside it (settings.local.json is deliberately not read: it is not versioned, so it would be green here and red in CI)`,
        };
      }
      let settings;
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      } catch (err) {
        return {
          ok: false,
          kind,
          detail: `.claude/settings.json exists but does not parse as JSON (${err.message}) — the hook may well be written in there; what has to be repaired first is the syntax`,
        };
      }
      const hooks = settings && typeof settings === 'object' && !Array.isArray(settings)
        && settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks)
        ? settings.hooks
        : {};
      if (!Object.prototype.hasOwnProperty.call(hooks, event)) {
        return { ok: false, kind, detail: `.claude/settings.json declares no "${event}" hook` };
      }
      // Walked defensively rather than indexed: every level of this shape is hand-written JSON,
      // and a matcher that is not an array, or an entry with no `hooks`, must read as "nothing
      // runs the command" — not as a Node stack trace where this script has prose everywhere else.
      const commands = [];
      const matchers = Array.isArray(hooks[event]) ? hooks[event] : [];
      for (const matcher of matchers) {
        const entries = Array.isArray(matcher?.hooks) ? matcher.hooks : [];
        for (const entry of entries) {
          // `type` is checked, not assumed: Claude Code only runs an entry whose type is
          // exactly "command". A block pasted by hand after the installer reported a conflict
          // is the likely way a wrong type gets in, and without this the rule went green over
          // an entry that never fires — the green-while-broken shape this table exists to stop.
          if (entry?.type === 'command' && typeof entry?.command === 'string') commands.push(entry.command);
        }
      }
      if (!commands.some((c) => c.includes(needle))) {
        // A fifth cause needs a fifth message. When the command IS there and only its `type`
        // is wrong, the message above sends the reader to a file where they can see that exact
        // string in a `command:` key, and the checker is what looks broken. The repair here is
        // one word, and it is not the repair the other message describes.
        const mistyped = [];
        for (const matcher of matchers) {
          const entries = Array.isArray(matcher?.hooks) ? matcher.hooks : [];
          for (const entry of entries) {
            if (typeof entry?.command === 'string' && entry.command.includes(needle) && entry?.type !== 'command') {
              mistyped.push(String(entry?.type));
            }
          }
        }
        if (mistyped.length > 0) {
          return {
            ok: false,
            kind,
            detail: `"${event}" declares a command that runs "${needle}", but its type is "${mistyped[0]}" and Claude Code only runs entries whose type is exactly "command" — that one word is the repair`,
          };
        }
        return {
          ok: false,
          kind,
          detail: `"${event}" is declared in .claude/settings.json, but no command under it runs "${needle}"`,
        };
      }
      return { ok: true, kind, detail: `.claude/settings.json  →  ${event} runs "${needle}"` };
    }
    case 'ci': {
      const [file, ...needleParts] = rest;
      const needle = needleParts.join(':');
      // Empty or `.` names the DIRECTORY, which always exists — the row then reports green having
      // looked at no file at all. Same defect `isFile()` closed for `script:`. It is not academic:
      // the kit's own template ships `ci:{{SECRET_SCAN_WORKFLOW}}`, one placeholder, and a setup
      // that resolves it empty leaves the table's only security rule certified by a directory.
      if (!file || file === '.') {
        return { ok: false, kind: 'malformado', detail: 'malformed: `ci:` names no workflow file' };
      }
      if (escapesRepo(file)) {
        return { ok: false, kind: 'malformado', detail: `malformed: "${file}" is not a workflow filename in .github/workflows/` };
      }
      const p = join(repoRoot, '.github', 'workflows', file);
      if (!existsSync(p) || !statSync(p).isFile()) return { ok: false, kind, detail: `no existe .github/workflows/${file}` };
      if (needle && !readFileSync(p, 'utf8').includes(needle)) {
        return { ok: false, kind, detail: `${file} existe pero no contiene "${needle}"` };
      }
      return { ok: true, kind, detail: `.github/workflows/${file}` };
    }
    case 'skill': {
      const [name] = rest;
      // An empty segment is malformed, never "close enough". `skill:` with no name would
      // otherwise stat `.claude/skills//SKILL.md`, and `skill:open-session:` would silently
      // read as the plain two-segment form — a trailing colon is a half-written trigger, and
      // reading it as the shorter one hides the edit somebody left unfinished.
      if (!name) return { ok: false, kind: 'malformado', detail: 'malformed: `skill:` names no skill' };
      if (escapesRepo(name)) {
        return { ok: false, kind: 'malformado', detail: `malformed: "${name}" is not a skill name in .claude/skills/` };
      }
      if (rest.length > 1 && rest[rest.length - 1] === '') {
        return { ok: false, kind: 'malformado', detail: `malformed: "${trigger}" ends in an empty segment` };
      }
      // `<step>` is free text on purpose — `skill:commit:paso 3` is a documented form and stays
      // green. But a step that looks like a PATH is not a step: it is somebody writing the
      // `script:` trigger backwards, and `skill:` verifies nothing about it. That exact shape
      // was printed as the new syntax in this capability's own scope doc, so the person most
      // likely to write it is the one migrating a project by copying from there.
      const step = rest.slice(1).join(':');
      if (step && looksLikeAPath(step)) {
        return {
          ok: false,
          kind: 'malformado',
          detail:
            `\`skill:${name}:${step}\` names a path where a step goes — \`skill:\` only checks that ` +
            `the skill exists,\n       so the file is never verified, even if it is missing.\n` +
            `       Write it the other way round: \`script:${step}:${name}\`.`,
        };
      }
      const p = join(repoRoot, '.claude', 'skills', name, 'SKILL.md');
      if (!existsSync(p)) return { ok: false, kind, detail: `skill "${name}" does not exist` };
      return { ok: true, kind, detail: `.claude/skills/${name}/SKILL.md` };
    }
    case 'script': {
      // Same rule as `skill:`: a trailing colon is half an edit, not the older short form.
      if (rest.length > 1 && rest[rest.length - 1] === '') {
        return { ok: false, kind: 'malformado', detail: `malformed: "${trigger}" ends in an empty segment` };
      }
      // The caller is the LAST segment, so a path containing ':' still resolves whole.
      const caller = rest.length > 1 ? rest[rest.length - 1] : '';
      const path = rest.length > 1 ? rest.slice(0, -1).join(':') : rest.join(':');

      if (!path) {
        return { ok: false, kind, detail: 'malformed: `script:` names no file' };
      }
      // Shape first: a `script:` with no caller is the pre-0.30.0 form, and it is the whole
      // reason this rule type existed while verifying nothing. Say how to fix it, because the
      // projects reading this message are the ones running an older kit.
      if (!caller) {
        return {
          ok: false,
          kind,
          detail:
            `\`script:${path}\` names no caller — this is the old form, and it only ever checked ` +
            `that the file exists.\n       Write it as \`script:${path}:<skill>\`, naming the skill ` +
            `whose SKILL.md runs it (e.g. open-session).\n` +
            `       If nothing in .claude/skills/ runs it because the trigger is the APPLICATION ` +
            `itself — a\n       startup guard, a module that refuses to load — then this grammar has ` +
            `no form for it yet.\n       Do not reach for \`owner:\` to clear the red: it passes ` +
            `unconditionally and verifies nothing,\n       which turns a real guard into a row that ` +
            `can never fail.\n       Nor to plain \`skill:<name>\`: that only checks the skill exists, so the script goes` +
            `\n       back to being unverified — one word shorter than the fix, and the fix's opposite.`,
        };
      }

      // A trigger points at something IN this repo. `script:../otro/check.mjs:open-session` resolves
      // to a file outside it and used to pass — nobody writes that on purpose, but it is the shape a
      // bad migration takes when a path is wrong and a red row needs clearing.

      if (escapesRepo(path, { allowSubdirs: true })) {
        return { ok: false, kind: 'malformado', detail: `malformed: "${path}" points outside this repository — a trigger names a file inside it` };
      }
      if (escapesRepo(caller)) {
        return { ok: false, kind: 'malformado', detail: `malformed: "${caller}" is not a skill name in .claude/skills/` };
      }

      // isFile, not just exists: `existsSync` says yes to a DIRECTORY, and a directory name
      // like `scripts` or `src` appears in almost any SKILL.md — so `script:scripts:open-session`
      // used to pass, verifying nothing. A silent green in the one check whose whole job is to
      // refuse silent greens.
      const target = join(repoRoot, path);
      const scriptExists = existsSync(target) && statSync(target).isFile();
      const skillMd = join(repoRoot, '.claude', 'skills', caller, 'SKILL.md');
      const skillExists = existsSync(skillMd);

      // Report every missing piece at once. Fixing one at a time, guided by a checker that
      // only names the first, is how a two-part defect takes two rounds to close.
      if (!skillExists) {
        const also = scriptExists ? '' : `, and the script ${path} is not there either`;
        return { ok: false, kind, detail: `skill "${caller}" does not exist${also}` };
      }
      if (!scriptExists) {
        return { ok: false, kind, detail: `script ${path} does not exist (skill "${caller}" is there)` };
      }

      // Compared by FILENAME, not by full path: skills name their scripts inconsistently —
      // `open-session` writes `scripts/check-deploy-verified.mjs` but `check-deploy-status.sh`,
      // and `setup` writes `check-rule-triggers.mjs` with no prefix. Demanding the literal path
      // would put those skills in false red today. A script's filename is already unique here.
      const filename = path.split('/').pop();
      // Whole-token match, not `includes`: with a plain substring test, a row naming
      // `otro/pendings.mjs` passed on a SKILL.md that mentions `check-pendings.mjs`, certifying
      // a different file in a different directory. The comment justifying filename-over-path
      // assumed filenames are unique here — true for equal names, useless against suffixes.
      const mentioned = new RegExp(`(^|[^\\w.-])${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-]|\\.[A-Za-z0-9])`);
      if (!mentioned.test(readFileSync(skillMd, 'utf8'))) {
        return {
          ok: false,
          kind,
          detail:
            `${path} is delivered, but skill "${caller}" never names it.\n` +
            `       A script on disk that its declared caller does not even mention is the case this check exists\n` +
            `       to catch. Note what this proves and what it does not: the check reads the SKILL.md for the\n` +
            `       filename, so it can tell you the caller never mentions it — it cannot tell you the caller runs it.`,
        };
      }
      return { ok: true, kind, detail: `${path}  ←  .claude/skills/${caller}/SKILL.md` };
    }
    case 'owner': {
      // `owner:` with nothing after it declares nobody. It used to pass with a generic label,
      // which is the one thing a human trigger must not do: its legitimacy is naming who.
      const who = rest.join(':').trim();
      if (!who) return { ok: false, kind: 'malformado', detail: 'malformed: `owner:` names nobody — say who does it' };
      return { ok: true, kind, detail: who };
    }
    default:
      // Red, never green — and the message names the likeliest cause, which is not a typo. A
      // trigger type is added to the kit and then copied into a project's own CLAUDE.md before
      // that project updates its `scripts/`: the row is correct, the checker is the old one.
      // `claude-hook:` is the case that made this concrete (0.36.x), and whatever comes after it
      // will arrive the same way. Silence in either direction is the worst answer available: a
      // green would certify a rule nothing read, and a bare "unknown type" sends someone to
      // rewrite a row that was right.
      return {
        ok: false,
        kind: 'malformado',
        detail:
          `tipo de disparo desconocido: "${kind}" — this checker knows hook, claude-hook, ci, skill, script, owner and none.\n` +
          `       Before rewriting the row: a type this checker does not know is usually a rule copied from a NEWER\n` +
          `       kit than the one installed here. Update the kit (\`.ae-kit-version\` against the kit's \`VERSION\`) and\n` +
          `       run this again. If the kit is already current, then the type really is a typo.`,
      };
  }
}

const results = rows.map(r => ({ ...r, check: checkTrigger(r.trigger) }));

const broken = results.filter(r => !r.check.ok);
const manual = results.filter(r => r.check.ok && r.check.kind === 'owner');
// A rule with no trigger is already reported as broken; don't also report it for the
// missing verification that follows from it. Only rules whose trigger EXISTS but whose
// evidence is undeclared are a separate, distinct defect.
const noVerification = results.filter(
  // The kit ships English templates, so `none` is what somebody writes in that column — and it
  // used to count as a declared verification. Same for `n/a` and the dash variants.
  r => r.check.ok && (!r.verification || ['—', '-', '–', 'ninguna', 'none', 'n/a', 'na'].includes(r.verification.trim().toLowerCase()))
);

console.log(`\n  Reglas declaradas: ${rows.length}   (${repoRoot.split('/').pop()})\n`);

for (const r of results) {
  const mark = r.check.ok ? (r.check.kind === 'owner' ? '○' : '✓') : '✗';
  console.log(`  ${mark} ${r.id.padEnd(4)} ${r.rule}`);
  console.log(`       disparo: ${r.trigger}  →  ${r.check.detail}`);
  if (noVerification.includes(r)) {
    console.log(`       ⚠ sin verificación declarada`);
  }
}

if (manual.length) {
  console.log(`\n  ○ ${manual.length} rule(s) with a declared human trigger — legitimate, but not automated:`);
  for (const r of manual) console.log(`      ${r.id} — ${r.check.detail}`);
}

if (broken.length === 0 && noVerification.length === 0) {
  console.log(`\n✓ Every rule names a trigger that exists, and every one declares its verification.\n`);
  process.exit(0);
}

console.error(`\n✗ Defectos encontrados:\n`);
for (const r of broken) {
  console.error(`  ${r.id} — ${r.rule}`);
  console.error(`     ${r.check.detail}`);
}
for (const r of noVerification) {
  console.error(`  ${r.id} — ${r.rule}`);
  console.error(`     the trigger exists, but the rule does not declare HOW it is verified that it ran`);
}
console.error(
  `\n  A rule with no trigger, or one that points at something absent, holds only if somebody` +
  `\n  remembers. That is exactly the failure mode this check blocks.\n`
);
process.exit(1);
