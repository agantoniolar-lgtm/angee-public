/**
 * pendings-table.mjs — reading PENDINGS.md, and the closed lists it is judged against.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 * Same argument as `task-states.mjs` and `task-frontmatter.mjs`, and the third instance
 * of it: `check-pendings.mjs` parses this table to count mentions, and
 * `check-task-links.mjs` needs the identical parse to answer whether a task's `resolves:`
 * points at a pending that exists. Two parsers of one hand-written table drift the day
 * someone adds a column.
 *
 * ── The lists were comments, and that is exactly why one was wrong ───────────────────
 * `owner` and `state` had their valid values written in a comment at the top of
 * `check-pendings.mjs` — documented, never asserted. A consuming project wrote
 * `kit (ae-setup)` into 14 rows and nothing noticed, because a comment cannot fail. The
 * lists live here now as data, and `check-task-links.mjs` checks against them.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Who can actually close a pending. The point of the field is to name someone who can
 * act — so the closed list is short on purpose, and a value outside it (a team, a repo,
 * a tool) means the pending has no one and will sit there being counted forever.
 */
export const OWNERS = {
  'system': 'el proyecto lo puede cerrar por sí mismo',
  'project-owner': 'necesita una decisión o una acción que sólo el dueño puede tomar',
  'third-party': 'espera a alguien de fuera del proyecto',
};

/** `dropped` requires a written reason below the table — see the template's own note. */
export const STATES = ['open', 'escalated', 'resolved', 'dropped'];

/** A pending is still live — it counts, and something can still be waiting on it. */
export const isLive = (state) => state === 'open' || state === 'escalated';

/**
 * Parse the six-column table in PENDINGS.md.
 *
 * Returns { rows, malformed, skipped }, never exits: `check-pendings.mjs` treats an unparseable
 * table as fatal (it cannot count what it cannot read) while `check-task-links.mjs`
 * reports it alongside its other findings. Deciding here would force both to agree.
 *
 * Returns null when the file is absent — a distinct answer from "present and empty", and
 * the caller's to interpret: a project may legitimately not run this rule at all.
 */
export function readPendings(root) {
  const file = join(root, 'PENDINGS.md');
  if (!existsSync(file)) return null;

  const rows = [];
  const malformed = [];
  const skipped = [];          // every row NOT counted, with the reason — never silent

  // Each malformed entry carries its OWN reason and fix. It used to be a bare string that
  // both consumers printed under one fixed label, «se esperaban 6 columnas» — so a row
  // with `~4` in `mentions`, which has all six columns, sent the reader to count pipes,
  // and the unclosed-fence report was announced as a malformed row while not being a row
  // at all. In a repo whose rule is that a finding must hold up from the output alone, a
  // message that misdiagnoses is a defect, not a cosmetic.
  const bad = (line, why, fix) => malformed.push({ line: line.trim(), why, fix });

  // The advice travels WITH the reason. It used to be one fixed line, written when the
  // only possible reason was the template's example row — so once rows could also be
  // skipped for being quoted inside a fence, it was telling the reader to fill in a row
  // that was correctly placed.
  const WHY = {
    fence: 'citada dentro de un bloque de código: se lee como ejemplo, no como tablero',
  };
  const HIDDEN_FIX = {
    fence: 'Si era una cita, está bien donde está. Si querías que contara, sácala del bloque de código.',
    template: 'Rellénala o bórrala: mientras siga así, no cuenta como pendiente.',
  };

  // ── What is data, and what is not ───────────────────────────────────────────────────
  // A pending row is any `| Pnnn |` line in the file that is not inside a fenced block.
  // There is no section boundary, on purpose, and the reason is worth keeping written
  // down because the boundary was tried twice and failed twice:
  //
  //   · "The table stops at the first line that isn't a row" truncated the table at any
  //     note written between two groups of rows — normal in a table kept by hand —
  //     silently dropping every pending below it, including an escalated one.
  //   · "The table stops at the first `##` heading" was worse, and silent in the same
  //     way. The kit's own template ENDS with `## Dropped, on purpose`, so a pending
  //     appended at the end of the file — the most ordinary edit there is — stopped being
  //     counted; and a `##` written ABOVE the table (a `## Tablero`, or the day Decisión 5
  //     splits this file into sections) put every row on the far side of the cut, so a
  //     board with an escalated pending reported "sin pendientes registrados" and exit 0.
  //     That is R22 switched off by the shape of the markdown.
  //
  // So the only thing excluded is a row quoted inside a fence — the "Resuelto" section
  // explains why a pending closed, and quoting the row as it stood is how that is written;
  // counted, it became a second P001 with a mention count that exists only in a quotation.
  // Everything else counts, and what stops a resolved row from being counted as live is
  // its `state` cell, which this file now validates as data rather than the section it
  // happens to sit under. A row repeated outside a fence — a quotation someone forgot to
  // fence — is caught by `check-task-links.mjs`, which already reports a duplicated id
  // and says why it hurts. Catching it a second time HERE, by skipping the repeat, was
  // tried and reverted: it disabled that upstream check, which is precisely the defect
  // this rewrite exists to remove.
  // ── What is not the board ───────────────────────────────────────────────────────────
  // A pending row is any `| Pnnn |` line that is not inside a fenced code block. Two
  // boundary rules were tried before this one and both dropped rows in silence: "the table
  // stops at the first line that isn't a row" truncated it at any note written between two
  // groups of rows, and "the table stops at the first `##`" was worse — the kit's template
  // ENDS with a `##`, so a pending appended at the end of the file stopped being counted,
  // and a `##` written above the table put every row on the far side of the cut.
  //
  // ── Why HTML comments are NOT handled here, deliberately ────────────────────────────
  // They were, for three rounds, and every round found a new way for a row to vanish or
  // for a dropped one to come back: `<!--` is ambiguous — it opens a comment, or it is
  // text somebody wrote inside a cell (pendings in this repo discuss parsers and markdown).
  // Distinguishing them means guessing, and guessing failed in both directions.
  //
  // The ambiguity was removed instead of resolved. No board hides rows inside a comment:
  // the template's comment is an INSTRUCTION to the writer, and it says to set the row's
  // `state` to `dropped` — the row stays in the table. So a row is a row wherever it sits,
  // notes live in the `notes` column, and a pending is retired through its `state`. That
  // convention is written in the template, not enforced by a parser trying to read minds.
  const rowRe = /^\s*\|\s*(P\d+)\s*\|/;
  let inFence = false;
  let fenceMarker = '';

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    // A fence is closed by the marker that opened it. One shared boolean let a ``` close a
    // block opened with ~~~, pairing them by accident and counting the rows quoted between
    // them as live pendings.
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) {
      if (!inFence) { inFence = true; fenceMarker = f[1]; }
      else if (f[1] === fenceMarker) { inFence = false; fenceMarker = ''; }
      continue;
    }

    // The "Resuelto" section quotes a row inside a fence to show how it stood when it
    // closed. Counted, that quotation became a second P001 carrying a mention count that
    // exists only inside a quotation. Excluded — and said, never silently.
    if (inFence) {
      const quoted = rowRe.exec(line);
      if (quoted) {
        skipped.push({ id: quoted[1], why: WHY.fence, fix: HIDDEN_FIX.fence });
      }
      continue;
    }

    const rowHere = rowRe.exec(line);

    // A row whose id cell never closes — `| P001 el texto | …`, one pipe short — used to
    // match nothing at all and land in neither `malformed` nor `skipped`: it simply did
    // not exist. It looks like a pending to every human who reads it, so it is reported.
    //
    // Indentation is tolerated for the same reason the fence test tolerates it: a table
    // indented two spaces is still a table, and refusing to see it produced «sin pendientes
    // registrados», exit 0, over a board holding an escalated pending.
    if (!rowHere) {
      if (/^\s*\|\s*P\d+[^|]/.test(line)) {
        bad(line, 'la celda del id nunca se cierra, así que la fila no se lee como fila',
            'Añade la tubería que falta después del id.');
      }
      continue;
    }

    const c = line.split('|').slice(1, -1).map((x) => x.trim());
    if (c.length < 6) {
      bad(line, `se esperaban al menos 6 columnas y se encontraron ${c.length}`, 'Revisa las tuberías de esa fila.');
      continue;
    }
    // `notes` is the seventh column and it is OPTIONAL, on purpose: it carries the working
    // notes that used to have nowhere to live except an HTML comment, and the repos already
    // running the kit have six-column boards. Putting it last means a six-column row is a
    // valid prefix of a seven-column one, so nothing has to be migrated to keep counting.
    const [id, text, owner, first, mentions, state, notes = ''] = c;

    // ── The one row that is scaffolding ─────────────────────────────────────────────
    // The kit's template ships an example row so the format is visible. Judged as data,
    // a project that copies the template as instructed cannot make its first commit.
    //
    // The discriminant is the PENDING TEXT, and only that. Two narrower rules were tried
    // and both deleted real work: skipping any line containing `{{` anywhere erased a
    // real pending whose text mentioned a placeholder, and testing the `owner` cell
    // erased a real pending — eight mentions, still open — written by someone who left
    // that one cell as the menu it looks like. If somebody wrote the pending down, the
    // pending is real; an unfilled cell next to it is an error worth shouting about, not
    // a reason to stop counting them.
    if (/^\{\{.*\}\}$/.test(text)) {
      skipped.push({ id, why: 'fila de ejemplo de la plantilla: su texto sigue sin escribirse',
                     fix: HIDDEN_FIX.template });
      continue;
    }

    // ── The column the whole rule rests on ──────────────────────────────────────────
    // `mentions` decided R22 through `Number(x) || 0`, so an empty cell, a `cinco`, a `~4`
    // or a `3?` all meant zero mentions FOREVER: a pending written that way can never
    // cross the escalation line, and the board says nothing. `owner` and `state` became
    // asserted data in this same change for exactly this reason; leaving the counting
    // column unchecked kept the defect alive in the one cell that carries the rule.
    if (!/^\d+$/.test(mentions)) {
      bad(line, `«${mentions}» no es un número de menciones, y esa celda es la que decide si algo escala`,
          'Escribe el número de sesiones en que se ha mencionado, en dígitos.');
      continue;
    }

    rows.push({
      id, text, owner, first, notes,
      mentions: Number(mentions),
      state: state.toLowerCase(),
    });
  }

  // ── "I read nothing" must not look like "there is nothing" ──────────────────────────
  // A fence opened and never closed swallows every row below it, and both consumers read
  // zero rows as zero pendings: `check-pendings.mjs` prints "sin pendientes registrados"
  // and exits 0. A board carrying an escalated pending then reports clean — R22 switched
  // off by a stray ``` , which is an ordinary markdown typo in a file that is DESIGNED to
  // contain fences (the "Resuelto" section quotes closed rows inside them).
  //
  // Reported as malformed rather than inferred from a row count: a project whose board is
  // legitimately empty must stay green, or the check earns a reputation for crying wolf
  // and the next real red gets ignored too.
  if (inFence) {
    bad('', 'un bloque de código (```) se abre y nunca se cierra, así que todo lo que viene debajo dejó de leerse',
        'Cierra la cerca con ``` donde termine la cita.');
  }

  return { rows, malformed, skipped };
}
