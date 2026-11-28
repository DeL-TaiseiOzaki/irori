#!/usr/bin/env bash
set -euo pipefail

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
head=$(git rev-parse --verify HEAD)

record_diff() {
  local metadata path
  # Inspect all paths, including both sides of a rename. Mode changes, additions and
  # deletions of the two records also get a full run.
  git diff --raw -z --no-renames "$base" "$head" -- > "$scratch/paths" || return 1
  [[ -s "$scratch/paths" ]] || return 1
  while IFS= read -r -d '' metadata && IFS= read -r -d '' path; do
    [[ "$metadata" =~ ^:100644\ 100644\ [0-9a-f]+\ [0-9a-f]+\ M$ ]] || return 1
    case "$path" in
      docs/STATUS.md|docs/HANDOFF.md) ;;
      *) return 1 ;;
    esac
  done < "$scratch/paths"
}

base=
case "$GITHUB_EVENT_NAME" in
  pull_request)
    # Compare the checked-out test merge against its actual first parent.
    if [[ "${PR_BASE_REF:-}" == main &&
          "${PR_BASE_SHA:-}" == "$(git rev-parse --verify HEAD^1 2>/dev/null)" &&
          "${PR_HEAD_SHA:-}" == "$(git rev-parse --verify HEAD^2 2>/dev/null)" &&
          -n "${PR_HEAD_SHA:-}" ]]; then
      base=$PR_BASE_SHA
    fi
    ;;
  push)
    if [[ "$GITHUB_REF" == refs/heads/main ]]; then
      base=${PUSH_BEFORE:-}
    fi
    ;;
esac

mode=full
if [[ "$head" == "$GITHUB_SHA" && "$base" =~ ^[0-9a-f]{40}$ ]] &&
   git merge-base --is-ancestor "$base" "$head" 2>/dev/null &&
   record_diff; then
  # Even a record-only push can be the next chance to build an unpublished preview.
  if [[ "$GITHUB_EVENT_NAME" == pull_request ]] ||
     { GITHUB_OUTPUT="$scratch/due" node scripts/release-policy.ts due "$head" > "$scratch/report" 2>&1 &&
       grep -qxF 'due=false' "$scratch/due"; }; then
    git diff --check "$base" "$head"
    mode=record-only
  fi
fi

echo "mode=$mode" >> "$GITHUB_OUTPUT"
echo "Desktop CI plan: $mode" >> "$GITHUB_STEP_SUMMARY"
