/**
 * task-frontmatter.mjs — reading tasks/ and judging a task file well-formed, in one place.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 * The same reason `task-states.mjs` exists, one level up. That file made the list of
 * states single-sourced; this one does it for the checks performed ON a task file — that
 * its `id` matches its filename, that its `status` is one of the six, that a task waiting
 * on the owner says what it is waiting for.
 *
 * Those three lived inside `generate-task-index.mjs`. When a second script needed them,
 * the tempting move was to write them again there. This kit already paid for that once:
 * the generator and the migrator each carried their own copy of "which statuses are
 * active", and both encoded the same dangerous default — anything unrecognized is done.
 * A search by concept found the duplicate; a search by function name would not have.
 *
 * So the rule is imported, never re-implemented. A consumer that needs a different answer
 * changes it here, where every consumer sees the change.
 *
 * ── What this file deliberately does NOT know ────────────────────────────────────────
 * Anything about relationships between tasks (`resolves:`, `blocked_by:`). Those are
 * cross-file questions — they need every task and every pending read first — and they
 * live in `check-task-links.mjs`. This file answers only "is this ONE file well-formed?".
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { STATES, RETIRED, normalizeStatus } =
  await import(join(dirname(fileURLToPath(import.meta.url)), 'task-states.mjs'));

/**
 * The fields that hold a list of ids. Everything else is a scalar, and the difference
 * matters: the "several indented lines of one bare token ⇒ a list" rule was applied to
 * every key, so a `title:` wrapped as `Refactor` / `parser` came out of the reader as
 * `[Refactor, parser]` and went into the generated index that way. That no title in this
 * repo triggers it is an accident of Spanish — accents fail the bare-token pattern — and a
 * consuming project writing English has no such luck.
 */
const LIST_KEYS = new Set(['resolves', 'blocked_by']);

/**
 * Minimal frontmatter reader: `key: value` pairs between the first two `---` lines.
 *
 * It also understands the block form of a list, and that is not a nicety — it closes a
 * false green. This reader splits each line on the first `:`, so
 *
 *     resolves:
 *       - P001
 *
 * used to read as an EMPTY `resolves`, with the dashed lines dropped for having no colon.
 * A task in `done` whose pending was still open then passed with "0 links checked": the
 * link was not broken, it did not exist as far as the checker could see, and the report
 * was indistinguishable from a task with no fields at all. That is exactly the failure
 * `check-task-links.mjs` exists to prevent, reproduced inside its own reader.
 *
 * It matters because the dashed form is the one anybody who knows YAML writes first, and
 * the kit installs into projects whose authors do. So the block is collected and returned
 * in the inline spelling — reading it correctly beats refusing it.
 */
export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  const lines = m[1].split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const c = line.indexOf(':');
    if (c === -1) continue;              // a dash line consumed below, or a stray line
    if (/^\s*-\s/.test(line)) continue;  // `- foo: bar` — an item, not a key

    const key = line.slice(0, c).trim();
    let inline = line.slice(c + 1).trim();

    // An inline list broken across lines — `resolves: [P001,` / `  P002]` — is valid YAML
    // and the natural way to wrap a long one. Read line by line it became a single id
    // literally named `[P001`, so the checker blamed an id nobody wrote AND the second id
    // vanished with nothing said about it. Join until the bracket closes.
    //
    // Two things this loop must NOT do, both found by review:
    //   · Carry a per-item `# comment` into the joined value. It ate the comma and the
    //     closing bracket with it, so one id got blamed for not existing and the second
    //     vanished unmentioned — the same defect the dashed block strips comments to
    //     avoid, reappearing in the inline form.
    //   · Consume the rest of the frontmatter when the bracket never closes. `title`,
    //     `status` and `created` disappeared into the value, and the reader then blamed
    //     the missing `title:` on a file whose title is written and visible. An unclosed
    //     bracket is left as it stands: it still fails, but pointing at the real field.
    if (inline.startsWith('[') && !inline.includes(']')) {
      const parts = [inline];
      let j = i + 1;
      for (; j < lines.length && !parts[parts.length - 1].includes(']'); j++) {
        if (/^\s*[\w-]+\s*:/.test(lines[j])) break;   // a new key: the bracket never closed
        parts.push(lines[j].replace(/\s+#.*$/, '').trim());
      }
      if (parts[parts.length - 1].includes(']')) {
        inline = parts.map((p) => p.replace(/\s+#.*$/, '').trim()).join(' ');
        i = j - 1;
      }
    }

    if (inline) { out[key] = inline; continue; }

    // Empty value: look ahead for a dashed block belonging to this key.
    //
    // Blank lines between the key and its block are skipped rather than treated as the
    // end of it: YAML accepts them, and treating one as "no block" reintroduces the exact
    // silent green this reader was rewritten to remove — a `done` task whose pending is
    // still open, reported as having no fields at all. A blank line is not a statement.
    //
    // A per-item `# comment` is stripped HERE, per item. Stripping it later, off the
    // joined list, ate the comma, the next item and the closing bracket along with it:
    // one id got blamed for not existing and a second disappeared with nothing said.
    const items = [];
    let j = i + 1;
    let sawItem = false;
    for (; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;           // blank line: keep looking
      if (!/^\s*-\s*/.test(lines[j])) break;          // the block is over
      sawItem = true;
      items.push(lines[j].replace(/^\s*-\s*/, '').replace(/\s+#.*$/, '').trim());
    }
    if (sawItem) { out[key] = `[${items.join(', ')}]`; i = j - 1; continue; }

    // ── The other spelling of the same false green ──────────────────────────────────
    // The dashed block above was the first half of this fix. The second half is the form
    // with no dash at all — the key, then its value indented on the line below, which is
    // how anyone wraps a long value:
    //
    //     resolves:
    //       P001
    //
    // That read as an EMPTY field, and empty means "declared nothing". So a task in
    // `done` that said it closed a still-open pending passed with "0 links checked" and
    // exit 0 — the identical silent pass the dashed form produced, in the one spelling
    // the earlier fix did not cover. It is specifically `resolves:` and `blocked_by:`
    // that fail quietly here, because for them an empty value is a legitimate answer;
    // every other field would have been caught as a missing required one.
    //
    // A continuation line is indented and is not itself a `key:` line. Blank lines are
    // skipped for the same reason as above: a blank line is not a statement.
    //
    // ⚠️ A COMMENT LINE IS NOT A VALUE, and the first version of this loop treated it as
    // one. `title:` left empty with `# pendiente de escribir` written underneath — which
    // is what people write at exactly the moment they do NOT yet know the value — stopped
    // being reported as a missing required field and started generating an index row
    // titled `# pendiente de escribir`. Worse, the mandatory `waiting_on:` of `waiting on
    // owner` was satisfied by a comment, which is the state degrading back into the
    // catch-all that got `in review` retired. The dashed block above strips comments per
    // item and says why; this path was written beside it and did not inherit that.
    const cont = [];
    let k = i + 1;
    for (; k < lines.length; k++) {
      if (lines[k].trim() === '') continue;
      if (/^\s*#/.test(lines[k])) continue;         // a comment is not the value
      if (!/^\s+\S/.test(lines[k])) break;          // not indented: a new key, or the end
      // A nested key is `clave:` followed by a space or the end of the line. Cutting on
      // any `palabra:` read a wrapped value containing a URL — `waiting_on:` with a
      // github link underneath — as an EMPTY field, and the task was then reported for
      // not saying what it waits on, with the answer written and visible.
      //
      // Límite conocido y deliberado: una continuación cuya segunda línea empieza por
      // `palabra: algo` se sigue leyendo como clave anidada. En YAML real es ambiguo, y
      // adivinar sería peor que la regla.
      if (/^\s*[\w-]+:(\s|$)/.test(lines[k])) break;
      cont.push(lines[k].replace(/\s+#.*$/, '').trim());
    }

    // One id per line, no dashes and no commas, is the natural extension of the spelling
    // this reader just started accepting — and joining those with a space produced a
    // single invented id called `P001 P002`, so neither real link got checked and the
    // message blamed something nobody wrote. Bare tokens are a list; prose is a wrapped
    // value and still joins with a space.
    const bare = LIST_KEYS.has(key) && cont.length > 1 && cont.every((v) => /^[\w./-]+,?$/.test(v));
    if (cont.length) {
      out[key] = bare ? `[${cont.map((v) => v.replace(/,$/, '')).join(', ')}]` : cont.join(' ').trim();
      i = k - 1;
    } else out[key] = '';
  }
  return out;
}

/**
 * Read a frontmatter field that holds a list of ids.
 *
 * Three spellings mean the same thing and all three occur in practice, so all three are
 * accepted rather than corrected: `resolves: [P002, P003]`, `resolves: P002`, and the
 * field left empty. Rejecting a bare id over its missing brackets would block a commit on
 * punctuation — the same reason `normalizeStatus` normalizes instead of refusing.
 *
 * Absent and empty are the SAME answer here (no ids declared) and a different answer from
 * "declared and wrong", which is the caller's to report. Returns [] for both.
 */
export function idList(value) {
  if (value === undefined || value === null) return [];
  const inner = String(value).trim()
    .replace(/\s+#.*$/, '')                 // a trailing `# note` is a comment, not an id
    .replace(/^\[(.*)\]$/s, '$1');
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))  // quoting an id is punctuation
    .filter(Boolean);
}

/**
 * Read every task file under `root/tasks/`.
 *
 * Returns { tasks, broken, retired } rather than printing or exiting: one consumer stops
 * the world over a malformed file (the generator refuses to build an index from partial
 * data) and another wants to report it alongside its own findings. Deciding that here
 * would force both to agree.
 *
 * `tasks` carries the normalized status and the repo-relative `file`; `broken` and
 * `retired` carry enough for a message the reader can act on without opening the file.
 */
export function readTasks(root) {
  const tasksDir = join(root, 'tasks');
  if (!existsSync(tasksDir)) return null;

  const tasks = [];
  const broken = [];
  const retired = [];

  for (const name of readdirSync(tasksDir).sort()) {
    if (!name.endsWith('.md')) continue;
    const fm = frontmatter(readFileSync(join(tasksDir, name), 'utf8'));
    if (!fm) { broken.push([name, 'sin frontmatter']); continue; }

    let bad = false;
    for (const req of ['id', 'title', 'status', 'category', 'created']) {
      if (!fm[req]) { broken.push([name, `is missing "${req}" in its frontmatter`]); bad = true; break; }
    }
    if (bad) continue;

    // An id that disagrees with its filename makes the index link show one name and the
    // file carry another, with nothing to say which is the task's real identity. Two
    // tasks in a consuming project already drifted this way, unnoticed.
    const base = name.replace(/\.md$/, '');
    if (fm.id !== base) {
      broken.push([name, `declara \`id: ${fm.id}\`, que no coincide con el nombre de su archivo`]);
      continue;
    }

    const status = normalizeStatus(fm.status);

    if (RETIRED[status]) { retired.push([name, status, fm]); continue; }

    if (!STATES[status]) {
      broken.push([name, `tiene \`status: ${fm.status}\`, que no es uno de los seis estados`]);
      continue;
    }

    // A state that says "someone else has to decide" has to say WHAT gets decided.
    // Without it the state degrades back into the catch-all `in review` was, which is the
    // whole reason that one was retired.
    if (status === 'waiting on owner' && !fm.waiting_on) {
      broken.push([name, 'está en `waiting on owner` y no dice `waiting_on:` qué se espera']);
      continue;
    }

    tasks.push({ ...fm, status, file: `tasks/${name}` });
  }

  return { tasks, broken, retired };
}
