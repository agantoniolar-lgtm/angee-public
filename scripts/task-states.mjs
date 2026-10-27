/**
 * task-states.mjs — the six task states, in one place.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 * The rule "which statuses are active" used to live in two scripts, written out twice.
 * A concept search found the second copy; a search by function name would not have, and
 * that is exactly how a rule gets fixed on one surface and left wrong on the other.
 *
 * More than deduplication, though: both copies encoded the same dangerous default —
 * anything not recognized was treated as finished. A consuming project invented
 * `status: backlog` because the kit offered no such state, and both scripts turned that
 * invention into the claim "done". One of the tasks hidden that way was a high-priority
 * bug.
 *
 * So the states live here, the list is closed, and the correct response to a value not
 * on it is to refuse — never to classify.
 */

/**
 * `index` is the whole classification: each state belongs to exactly one index, which is
 * what makes "every task appears exactly once, in exactly one index" true by
 * construction rather than by discipline. Adding a state here is a deliberate act.
 */
export const STATES = {
  'backlog':          { index: 'backlog', group: 'Sin scope escrito' },
  'todo':             { index: 'backlog', group: 'Con scope, esperando turno' },
  'in progress':      { index: 'active',  group: 'En construcción' },
  'waiting on owner': { index: 'active',  group: 'Esperando al dueño del proyecto' },
  'done':             { index: 'archive', group: 'Entregado' },
  'dropped':          { index: 'archive', group: 'Cancelado' },
};

/**
 * States this kit used to accept and no longer does.
 *
 * `in review` is retired rather than renamed because it meant three incompatible things
 * at once — a task genuinely awaiting the owner, a task scoped but not started, and a
 * task pushed there by `ship` with nothing to review. No single new state is a correct
 * translation, which is precisely why migration refuses to guess and asks instead.
 */
export const RETIRED = {
  'in review': {
    since: '0.29.0',
    why: 'significaba tres cosas incompatibles a la vez',
    options: ['waiting on owner', 'todo', 'done'],
  },
};

/**
 * `In Progress`, `in  progress` and `in progress ` are the same state written by three
 * different hands. Normalizing beats rejecting: the alternative is a hook that blocks a
 * commit over a capital letter, which teaches people to fight the tool. And
 * `waiting on owner` carries two internal spaces, so this is not hypothetical.
 */
export const normalizeStatus = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** The states a task can hold, formatted for an error message. */
export const validStates = () => Object.keys(STATES).map((s) => `\`${s}\``).join(' · ');
