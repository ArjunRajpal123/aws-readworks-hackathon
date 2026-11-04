#!/usr/bin/env bash
# Full offline regression run for Sound Along. No AWS calls, no Polly cost.
#
#   .kiro/skills/regression-test/scripts/run_regression.sh            # all gates
#   .kiro/skills/regression-test/scripts/run_regression.sh python     # one gate
#   gates: python golden limits frontend cdk
#
# Exits non-zero if any selected gate fails; prints a summary table.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SKILL="$REPO/.kiro/skills/regression-test/scripts"
cd "$REPO"

if [[ -x "$REPO/.venv-etl/bin/python" ]]; then
  PY=("$REPO/.venv-etl/bin/python" -m pytest)
elif command -v uv >/dev/null; then
  PY=(uv run --with pytest --with openpyxl pytest)
else
  echo "need .venv-etl or uv to run pytest" >&2; exit 2
fi

GATES=("$@")
[[ ${#GATES[@]} -eq 0 ]] && GATES=(python golden limits frontend cdk)
declare -A RESULT
LOGDIR="$(mktemp -d /tmp/sa-regression.XXXXXX)"

run_gate() {
  local name="$1"; shift
  echo "=== [$name] $*"
  if "$@" >"$LOGDIR/$name.log" 2>&1; then
    RESULT[$name]=PASS; tail -n 3 "$LOGDIR/$name.log"
  else
    RESULT[$name]=FAIL; tail -n 40 "$LOGDIR/$name.log"
  fi
}

for gate in "${GATES[@]}"; do
  case "$gate" in
    python)   run_gate python "${PY[@]}" etl/tests lambda/tests -q -p no:cacheprovider ;;
    golden)   run_gate golden "${PY[@]}" "$SKILL" -q -p no:cacheprovider ;;
    limits)   if [[ -d .kiro/skills/etl-limit-test/scripts ]]; then
                run_gate limits "${PY[@]}" .kiro/skills/etl-limit-test/scripts -q -p no:cacheprovider
              else RESULT[limits]=SKIP; fi ;;
    frontend) run_gate frontend bash -c "cd frontend && npx vite build --outDir '$LOGDIR/dist' --emptyOutDir" ;;
    cdk)      # Synth needs an account id for bucket names; a dummy keeps it offline.
              run_gate cdk bash -c "cd infra/cdk && npx tsc --noEmit && \
                CDK_DEFAULT_ACCOUNT=\${CDK_DEFAULT_ACCOUNT:-123456789012} \
                CDK_DEFAULT_REGION=\${CDK_DEFAULT_REGION:-us-west-2} \
                npx cdk synth -q -o '$LOGDIR/cdk.out'" ;;
    *) echo "unknown gate: $gate" >&2; RESULT[$gate]=FAIL ;;
  esac
done

echo
echo "gate       result   log"
fail=0
for gate in "${GATES[@]}"; do
  printf "%-10s %-8s %s\n" "$gate" "${RESULT[$gate]:-?}" "$LOGDIR/$gate.log"
  [[ "${RESULT[$gate]:-FAIL}" == FAIL ]] && fail=1
done
exit $fail
