#!/usr/bin/env bash
# check-deploy-status.sh — poll a commit's remote CI/deploy status until it resolves.
#
# Used by the `ship` skill's step 5b: once a push lands, this polls GitHub for that SHA
# until every check resolves, then reports each one with its individual state.
#
# ── Why this reads TWO APIs ──────────────────────────────────────────────────────────
# The original version only called `/commits/{sha}/status` — the **Commit Status API**,
# which returns *classic statuses* only. GitHub Actions does NOT publish those; it
# publishes **check runs**, which live at `/commits/{sha}/check-runs`.
#
# The practical effect was a false green: against commit c3f2bb9 this script reported
# "✓ All checks passed" having seen exactly ONE check (Vercel), while the Checks API
# reported SIX — including `Supabase Preview` in `failure`. It never looked at
# `Lint + Tests` or `scan` (gitleaks) at all, so it could not have caught the broken
# deploy of 2026-07-22 that this script was written for. A check that only ever says
# "green" is worse than no check.
#
# So: both endpoints are queried and merged. Statuses AND check runs must all pass.
#
# ── Why the merged list is then DEDUPLICATED ─────────────────────────────────────────
# GitHub lets a failed job be re-run, and `/check-runs` returns **every attempt** for the
# commit — same name, one entry each, with its own conclusion. Counting that list straight
# means a job that failed twice and passed on the third try contributes TWO failures, and
# the script reports red on a commit GitHub shows as green.
#
# Measured on 026ff0b (2026-08-11): six check runs, four jobs. "Copiar kit/ a angee como
# release" appears three times — failure 19:30, failure 19:38, success 19:47. GitHub kept
# the 19:47 attempt; this script counted two failures and exited 1.
#
# The question this script answers is: **is the LAST attempt of EACH job green?** So the
# list is reduced to one entry per (source, name), keeping the greatest id — see "Why the
# key is the id alone" below for why `started_at` is not used at all. Grouping by commit
# would be a no-op: the query is already per-SHA, so everything returned belongs to one.
#
# The reduction happens inside `collect()`, on purpose, so that the wait loop and the
# expected-checks comparison see the clean list too. Deduplicating in the final counting
# loop instead would leave a stale `queued` attempt able to hold the loop open on a job
# that already resolved.
#
# ⚠️ Known limitation, accepted deliberately: two GENUINELY DIFFERENT jobs sharing a name
# across two workflows would be merged into one, and if the discarded one failed, the
# result would be a false GREEN — worse than the false red this fixes. Telling that case
# apart from a re-run is not cheap (both arrive with different check-suite and run ids), so
# instead **every discard is reported**, naming the job. The fusion is never silent.
#
# ── Known-failing checks ─────────────────────────────────────────────────────────────
# Some checks are red for reasons already triaged and accepted (a preview environment
# that has been red since before this rule existed, say). Listing them in
# `.github/known-failing-checks.txt`
# (one name per line, `#` for comments) keeps them from blocking, but they are still
# printed, loudly, and the script exits 3 instead of 0 — so a tolerated failure never
# looks identical to a clean run. Nothing is silently swallowed.
#
# Requires: gh CLI, authenticated, run from inside the target git repo.
#
# Usage:
#   check-deploy-status.sh [sha] [max_attempts] [sleep_seconds]
#     sha            commit SHA to check — defaults to HEAD
#     max_attempts   how many polls before giving up — default 15
#     sleep_seconds  delay between polls — default 10 (default max wait ~2.5 min)
#
# Exit codes:
#   0  every check passed
#   1  at least one check failed (blocking — do not move on)
#   2  still unresolved after max_attempts (caller decides whether to keep waiting)
#   3  the only failures are listed in .github/known-failing-checks.txt

set -uo pipefail
# No "set -e": the polling loop deliberately tolerates transient `gh api` failures (e.g. the
# SHA not yet visible on the remote right after a push) instead of aborting the whole script.

# Always resolve to a real SHA: a caller passing "HEAD" (or a branch name) would otherwise
# write that literal into the ledger, and the ledger would stop matching any commit.
SHA="$(git rev-parse "${1:-HEAD}")"
MAX_ATTEMPTS="${2:-15}"
SLEEP_SECONDS="${3:-10}"

# Resolved against the REPO ROOT, not the current directory. They used to be bare relative
# paths while the ledger already used the toplevel, so running from a subdirectory (a
# monorepo's `apps/web`, say) silently treated both as absent — and `expected-checks.txt`
# is the only thing standing between this script and a green verdict on a commit whose
# checks have not been published yet. Degrading to "file not found" with no message, in the
# unsafe direction, is precisely the silent failure this file exists to avoid.
REPO_ROOT="$(git rev-parse --show-toplevel)"
ALLOWLIST_FILE="${REPO_ROOT}/.github/known-failing-checks.txt"
EXPECTED_FILE="${REPO_ROOT}/.github/expected-checks.txt"

echo "Checking deploy/CI status for commit ${SHA}..."
echo "(reading both the Commit Status API and the Checks API — GitHub Actions only appears in the latter)"

# Where `dedupe` reports what it discarded, and where a truncated response is flagged.
# Both are rewritten on every poll, so they always describe the final answer rather than
# an intermediate one.
DEDUP_NOTICE="$(mktemp)"
TRUNC_NOTICE="$(mktemp)"
trap 'rm -f "$DEDUP_NOTICE" "$TRUNC_NOTICE"' EXIT

# ── Why these calls paginate ─────────────────────────────────────────────────────────
# `/check-runs` returns 30 entries per page by default. Without pagination the script
# treated the first page as the whole list, and a check that didn't fit simply did not
# exist for it: not counted as failed, not counted as pending, not reported. That is a
# false GREEN — the exact failure this file is supposed to prevent — and it gets worse the
# moment re-runs are common, because every extra attempt occupies a slot: 026ff0b already
# spent 6 entries on 4 jobs. So: `--paginate` with the largest page size, plus a guard
# below that compares what arrived against the `total_count` the API itself reports.
#
# Both emit "name<TAB>state<TAB>id<TAB>source". States are normalized to the check-run
# vocabulary: success | failure | pending | neutral | skipped | ...
# ⚠️ NO añadir `--slurp`: `gh` lo rechaza junto con `--jq` («the --slurp option is not
# supported with --jq or --template»), aborta antes de pedir nada y escribe el error a
# STDERR — que aquí va a /dev/null. El script se quedaría sin ver un solo check, en todos
# los sondeos y para siempre, reportando "¿está pusheado?" sobre commits verdes. Ocurrió:
# se escribió con `--slurp` y pasó las 25 pruebas, porque el doble de `gh` de la suite
# aceptaba la combinación que el binario real no admite.
#
# Sin `--slurp`, `--paginate` aplica el `--jq` a CADA página y concatena las salidas. Por eso
# las expresiones se escriben contra una página suelta, y la marca `##TOTAL##` se emite una
# vez por página (todas traen el mismo valor; abajo se toma la última).
# Both endpoints report `total_count`, so both get the same treatment: a marker line naming
# how many entries the API says exist, checked below against how many actually arrived.
# Symmetry is the point — guarding only one of the two leaves the other free to go dark and
# let a single source decide alone.
#
# The marker is emitted as a TWO-field line while data lines have four, and every reader
# below filters on the field count. Without that, a check literally named `##TOTAL##` would
# be read as the marker and its *state* taken as a count.
fetch_statuses() {
  gh api --paginate "repos/{owner}/{repo}/commits/${SHA}/status?per_page=100" \
    --jq '
      "##TOTAL-STATUS##\t" + ((.total_count // 0) | tostring),
      (.statuses[]? | [.context, .state, "0", "status"] | @tsv)
    ' 2>/dev/null
}

fetch_check_runs() {
  gh api --paginate "repos/{owner}/{repo}/commits/${SHA}/check-runs?per_page=100" \
    --jq '
      "##TOTAL-RUNS##\t" + ((.total_count // 0) | tostring),
      (.check_runs[]? | [.name, (if .status != "completed" then "pending" else (.conclusion // "unknown") end), (.id|tostring), "run"] | @tsv)
    ' 2>/dev/null
}

# Reduces the stream to one "name<TAB>state" line per job — the last attempt of each — and
# reports every discarded attempt on stderr as "name<TAB>count".
#
# ── Why the key is the id alone ──────────────────────────────────────────────────────
# GitHub's check-run ids grow with creation time, so among attempts OF THE SAME JOB the
# greatest id is always the newest. Verified against 20 real runs: the only orderings where
# id and `started_at` disagree are between DIFFERENT jobs created in the same batch, which
# never share a group here.
#
# Using `started_at` as the primary key looked equivalent and was not: an attempt that
# hasn't started yet has none, so a **freshly queued re-run** would lose to the old attempt
# that failed — and the script would write a permanent `exit 1` line for a job that was
# being retried at that very moment. Ordering by id makes that re-run win, the job reads as
# pending, and the script waits instead of recording a verdict.
#
# The id is zero-padded to a fixed width because the comparison is textual: without it "9"
# would sort above "10".
#
# Grouping includes the SOURCE, so a classic status never merges with a check run that
# happens to share its name. `/status` already returns one entry per context, so there is
# nothing to collapse on that side — merging across the two APIs would have been pure risk,
# and it compares instants of different things (`updated_at` vs `started_at`).
#
# Output order is first-appearance, not hash order, so two runs over the same input print
# the same thing.
dedupe() {
  awk -F'\t' '
    {
      key = $4 "\x1f" $1
      if (!(key in seen)) { order[++n] = key; name[key] = $1; seen[key] = 1 }
      else { discarded[key]++ }
      rank = sprintf("%020d", $3 + 0)
      if (!(key in best) || rank > bestrank[key]) { best[key] = $2; bestrank[key] = rank }
    }
    END {
      for (i = 1; i <= n; i++) {
        k = order[i]
        printf "%s\t%s\n", name[k], best[k]
        if (discarded[k] > 0) printf "%s\t%d\n", name[k], discarded[k] > "/dev/stderr"
      }
    }
  '
}

collect() {
  local raw total got
  raw="$({ fetch_statuses; fetch_check_runs; })"

  # ── The guard, applied to EACH source, for two ways of getting a partial answer ─────
  # (1) Fewer entries arrived than the API says exist — a truncated page.
  # (2) The call produced nothing at all: a 5xx, a secondary rate limit, or — most likely
  #     and most permanent — a fine-grained token missing `Checks: read` or
  #     `Commit statuses: read`. A token can hold one permission and not the other, which
  #     is why this runs per source: whichever half goes dark, the other must not be left
  #     deciding alone. Reporting "all checks passed" because the only source that answered
  #     happened to be green is the false green this whole file exists to prevent — and it
  #     would be written to an append-only ledger.
  #
  # The marker is what separates "the call did not answer" from "there genuinely are none":
  # a commit with zero entries still emits its marker, with value 0.
  : > "$TRUNC_NOTICE"
  local src marker tag total got
  for src in runs status; do
    if [[ "$src" == runs ]]; then marker="##TOTAL-RUNS##"; tag="run"
    else                          marker="##TOTAL-STATUS##"; tag="status"; fi
    total="$(awk -F'\t' -v m="$marker" 'NF == 2 && $1 == m {print $2}' <<< "$raw" | tail -1)"
    got="$(awk -F'\t' -v t="$tag" 'NF == 4 && $4 == t' <<< "$raw" | grep -c . || true)"
    if [[ -z "$total" ]]; then
      # No marker. Only worth flagging if something else DID arrive — otherwise this is the
      # ordinary "the SHA isn't on the remote yet" case, which the polling loop handles by
      # retrying and reports honestly on its own.
      [[ -n "$raw" ]] && printf '%s\tsin-respuesta\t%s\n' "$src" "$got" >> "$TRUNC_NOTICE"
    elif [[ "$total" -gt 0 && "$got" -lt "$total" ]]; then
      printf '%s\tparcial\t%s\t%s\n' "$src" "$got" "$total" >> "$TRUNC_NOTICE"
    fi
  done

  # `gh api` imprime el cuerpo del error en STDOUT cuando la API responde 4xx (p. ej. un SHA
  # que no existe), así que sin este filtro ese JSON entraba como si fuera un check con
  # nombre gigante y estado vacío — y se reportaba como fallo en vez de "no encontrado".
  # `NF == 4` is what separates data from the two-field markers — NOT a name comparison.
  # An earlier version also tested `$1 != "##TOTAL##"`, left over from when there was a
  # single marker; it did nothing once the markers were split and renamed, but it read as
  # if it were the protection, inviting a future reader to drop the field-count test as
  # redundant. Case H6 exercises the real one, with a check named like a marker.
  awk -F'\t' 'NF == 4 && $1 != "" && $2 != ""' <<< "$raw" \
    | dedupe 2>"$DEDUP_NOTICE"
}

# Checks que deben aparecer sí o sí (archivo opcional; sin él, no se exige ninguno).
expected=""
if [[ -f "$EXPECTED_FILE" ]]; then
  expected="$(grep -vE '^\s*(#|$)' "$EXPECTED_FILE" 2>/dev/null)"
fi

# Devuelve los checks esperados que TODAVÍA no aparecieron en la respuesta de GitHub.
missing_expected() {
  local seen="$1" name
  [[ -z "$expected" ]] && return 0
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    grep -qxF "$name" <<< "$seen" || echo "$name"
  done <<< "$expected"
}

lines=""; missing=""
for ((i = 1; i <= MAX_ATTEMPTS; i++)); do
  lines="$(collect)"
  # awk, no `grep -P`: BSD grep (macOS) no tiene -P, y ahí el grep fallaba en silencio
  # y el loop salía en el primer intento sin esperar a los checks que seguían corriendo.
  pending_count="$(awk -F'\t' '$2 == "pending"' <<< "$lines" | wc -l | tr -d ' ')"
  missing="$(missing_expected "$(awk -F'\t' '{print $1}' <<< "$lines")")"
  if [[ -z "$lines" ]]; then
    echo "  attempt ${i}/${MAX_ATTEMPTS}: no checks visible yet (SHA not on remote, or API error) — retrying"
  elif [[ -n "$missing" ]]; then
    # Sin esto, un check que todavía no publicó (Vercel lo hace solo al final de su
    # build) se leía como "no aplica", y el script daba verde antes de que esa fuente
    # opinara. Ahora espera a que aparezcan todos los declarados.
    echo "  attempt ${i}/${MAX_ATTEMPTS}: falta(n) por aparecer: $(tr '\n' ',' <<< "$missing" | sed 's/,$//')"
  elif [[ "$pending_count" -gt 0 ]]; then
    echo "  attempt ${i}/${MAX_ATTEMPTS}: ${pending_count} check(s) still running"
  else
    echo "  attempt ${i}/${MAX_ATTEMPTS}: all checks resolved"
    break
  fi
  [[ $i -lt $MAX_ATTEMPTS ]] && sleep "$SLEEP_SECONDS"
done

if [[ -z "$lines" ]]; then
  echo ""
  echo "⏳ No checks visible for ${SHA} after ${MAX_ATTEMPTS} attempts — is it pushed?"
  exit 2
fi

# A partial list cannot produce a verdict. Reporting green over it would be the false green
# this file exists to prevent, written into an append-only ledger — so this exits 2
# ("could not resolve"), never 0.
if [[ -s "$TRUNC_NOTICE" ]]; then
  echo ""
  echo "✗ Respuesta incompleta — NO se emite veredicto ni se escribe en la bitácora:"
  while IFS=$'\t' read -r g_src g_kind g_a g_b; do
    [[ -z "$g_src" ]] && continue
    api_name="check runs (Checks API)"
    [[ "$g_src" == status ]] && api_name="statuses clásicos (Commit Status API)"
    if [[ "$g_kind" == "sin-respuesta" ]]; then
      printf '  · %s: la consulta no devolvió nada, pero la otra fuente sí.\n' "$api_name"
      printf '    Error transitorio, límite de peticiones, o —lo más probable y lo único\n'
      printf '    permanente— un token sin permiso de lectura sobre esa API.\n'
    else
      printf '  · %s: llegaron %s de %s que la API dice que existen (paginación incompleta).\n' \
        "$api_name" "$g_a" "$g_b"
    fi
  done < "$TRUNC_NOTICE"
  echo "  Con una sola de las dos fuentes no se puede afirmar que el commit esté verde:"
  echo "  ese es exactamente el falso verde que este script existe para impedir."
  exit 2
fi

if [[ -n "$missing" ]]; then
  echo ""
  echo "⏳ Estos checks declarados en ${EXPECTED_FILE} nunca aparecieron:"
  sed 's/^/  · /' <<< "$missing"
  echo "  No es lo mismo que estén verdes: pueden seguir por publicar (Vercel lo hace al"
  echo "  final de su build) o la integración puede estar caída. Re-corre para seguir esperando."
  exit 2
fi

# Known-failing allowlist (optional file; missing file = empty list).
known=""
if [[ -f "$ALLOWLIST_FILE" ]]; then
  known="$(grep -vE '^\s*(#|$)' "$ALLOWLIST_FILE" 2>/dev/null)"
fi

# Report every merged attempt BEFORE the per-check list, so nothing is quietly folded away.
# A re-run is the ordinary case and needs no action; two different jobs sharing a name is a
# real misconfiguration. They are indistinguishable here without an extra API call per
# entry, so this names what happened and points at the cause without asserting it.
if [[ -s "$DEDUP_NOTICE" ]]; then
  echo ""
  echo "⚠ Intentos anteriores descartados — se conserva el más reciente de cada job:"
  while IFS=$'\t' read -r dname dcount; do
    [[ -z "$dname" ]] && continue
    printf '  · %s — %s intento(s) previo(s)\n' "$dname" "$dcount"
  done < "$DEDUP_NOTICE"
  echo "  Normal tras un re-run. Pero si alguno de esos nombres son en realidad DOS jobs"
  echo "  distintos en workflows distintos, aquí se fusionan en uno: renómbralos."
fi

echo ""
echo "Individual checks:"
failed=0; tolerated=0; pending=0
while IFS=$'\t' read -r name state; do
  [[ -z "$name" ]] && continue
  case "$state" in
    success|neutral|skipped)
      printf '  ✓ %s: %s\n' "$name" "$state" ;;
    pending)
      printf '  ⏳ %s: still running\n' "$name"; pending=$((pending + 1)) ;;
    *)
      if [[ -n "$known" ]] && grep -qxF "$name" <<< "$known"; then
        printf '  ⚠ %s: %s — KNOWN-FAILING (listed in %s), not blocking\n' "$name" "$state" "$ALLOWLIST_FILE"
        tolerated=$((tolerated + 1))
      else
        printf '  ✗ %s: %s\n' "$name" "$state"
        failed=$((failed + 1))
      fi ;;
  esac
done <<< "$lines"

# ── Record the outcome as an artifact (2026-08-09, Capability 1) ─────────────────────
# The script printing to a terminal is not evidence: scrollback disappears, and "it ran"
# becomes indistinguishable from "someone said it ran". One append-only line per SHA is
# what makes the dynamic question answerable later — and it's written by the tool, not by
# the agent's own narrative of the session (the F9 failure mode).
#
# `check-deploy-verified.mjs` reads this file to detect pushes that were never verified.
LEDGER="${REPO_ROOT}/logs/deploy-checks.md"
record() {
  local code="$1" summary="$2"
  mkdir -p "$(dirname "$LEDGER")"
  if [[ ! -f "$LEDGER" ]]; then
    {
      echo "# Deploy checks — one line per verified push"
      echo ""
      echo "Written by \`check-deploy-status.sh\`, never by hand. Append-only."
      echo ""
    } > "$LEDGER"
  fi
  printf '%s | %s | exit %s | %s\n' "$(date '+%Y-%m-%d %H:%M')" "$SHA" "$code" "$summary" >> "$LEDGER"
}

# The merge notice belongs in the LEDGER, not only on screen. The risk accepted for this
# feature was "homonymous jobs get merged, in exchange for every merge being announced" —
# and an announcement that dies with the scrollback is not the durable half of that trade.
# This project's own rule: the script printing to a terminal is not evidence; the
# append-only line per SHA is what makes the question answerable later.
merged_suffix=""
if [[ -s "$DEDUP_NOTICE" ]]; then
  merged_total="$(awk -F'\t' '{s += $2} END {print s + 0}' "$DEDUP_NOTICE")"
  merged_suffix=" (${merged_total} intento(s) previo(s) descartado(s))"
fi

echo ""
if [[ $failed -gt 0 ]]; then
  echo "✗ ${failed} check(s) failed for ${SHA} — treat as blocking, do not move on."
  record 1 "${failed} check(s) FAILED${merged_suffix}"
  exit 1
elif [[ $pending -gt 0 ]]; then
  echo "⏳ ${pending} check(s) still running after ${MAX_ATTEMPTS} attempts — re-run to keep waiting."
  # Deliberately NOT recorded: pending is not a terminal state, and a ledger line here
  # would let an unresolved push look accounted for.
  exit 2
elif [[ $tolerated -gt 0 ]]; then
  echo "⚠ Everything passed EXCEPT ${tolerated} known-failing check(s) — see the list above."
  echo "  Not blocking, but do not report this as a clean run."
  record 3 "passed except ${tolerated} known-failing${merged_suffix}"
  exit 3
else
  echo "✓ All checks passed for ${SHA}."
  record 0 "all checks passed${merged_suffix}"
  exit 0
fi
