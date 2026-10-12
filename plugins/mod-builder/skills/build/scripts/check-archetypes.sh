#!/usr/bin/env bash
# Scaffolds every archetype into a temporary folder and runs validate and test on each,
# so a template change that breaks a generated mod fails here first.
#
#   bash check-archetypes.sh            # validate + test
#   TYPES=<claude-code.d.ts> bash check-archetypes.sh   # also typecheck with that d.ts
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=""
for archetype in band pane-command guard watcher command-only; do
  name="check-${archetype}"
  node "$here/scaffold.mjs" "$archetype" "$work" "$name" "Archetype check: it's \"$archetype\"." > /dev/null
  echo "== $archetype"
  claude plugin validate "$work/$name" > "$work/$name.validate" 2>&1 || { cat "$work/$name.validate"; failed="$failed $archetype(validate)"; }
  claude plugin test "$work/$name" > "$work/$name.test" 2>&1 || { cat "$work/$name.test"; failed="$failed $archetype(test)"; }
  tail -3 "$work/$name.test" | head -2
  if [ -n "${TYPES:-}" ]; then
    sed "s#__TYPES__#$TYPES#; s#__MOD__#$work/$name#g" "$here/../templates/tsconfig.check.json" > "$work/$name.tsconfig.json"
    npx -y -p typescript@5.6 tsc -p "$work/$name.tsconfig.json" || failed="$failed $archetype(tsc)"
  fi
done

if [ -n "$failed" ]; then
  echo "FAILED:$failed"
  exit 1
fi
echo "all archetypes pass"
