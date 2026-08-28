#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
GITMODULES="$ROOT/.gitmodules"

usage() {
  echo "Usage: $0 {status|audit|sync-safe|init|pull|check|check-recursive}" >&2
  exit 2
}

submodule_paths() {
  [[ -f "$GITMODULES" ]] || return 0
  git config --file "$GITMODULES" --get-regexp '^submodule\..*\.path$' |
    while read -r _ path; do
      printf '%s\n' "$path"
    done
}

has_own_worktree() {
  local repo="$1"
  local top
  [[ -d "$repo" ]] || return 1
  top="$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null || true)"
  [[ -n "$top" && "$(cd "$repo" && pwd -P)" == "$(cd "$top" && pwd -P)" ]]
}

is_initialized() {
  local repo="$1"
  has_own_worktree "$repo" || return 1
  git -C "$repo" rev-parse --verify HEAD >/dev/null 2>&1
}

submodule_class() {
  local path="$1"
  local repo="$ROOT/$path"
  local expected actual status

  if ! has_own_worktree "$repo"; then
    printf '%s\n' "UNINITIALIZED"
    return 0
  fi
  if ! git -C "$repo" rev-parse --verify HEAD >/dev/null 2>&1; then
    printf '%s\n' "PARTIAL_INIT"
    return 0
  fi

  expected="$(git -C "$ROOT" ls-files --stage -- "$path" | awk '{print $2}')"
  actual="$(git -C "$repo" rev-parse HEAD)"
  status="$(git -C "$repo" status --porcelain=v1 --untracked-files=all)"

  if [[ -n "$status" ]]; then
    if ! git -C "$repo" diff --cached --quiet --; then
      printf '%s\n' "DIRTY_INDEX"
    elif ! git -C "$repo" diff --quiet --; then
      printf '%s\n' "DIRTY_WORKTREE"
    elif [[ -n "$(git -C "$repo" ls-files --others --exclude-standard)" ]]; then
      printf '%s\n' "UNTRACKED"
    else
      printf '%s\n' "DIRTY_OTHER"
    fi
  elif [[ -z "$expected" ]]; then
    printf '%s\n' "PIN_MISSING"
  elif [[ "$actual" == "$expected" ]]; then
    printf '%s\n' "CLEAN_MATCH"
  else
    printf '%s\n' "CLEAN_MISMATCH"
  fi
}

repo_name() {
  local repo="$1"
  local fallback="$2"
  local remote
  remote="$(git -C "$repo" remote get-url origin 2>/dev/null || true)"
  if [[ -n "$remote" ]]; then
    remote="${remote%/}"
    remote="${remote##*/}"
    remote="${remote%.git}"
    printf '%s\n' "$remote"
  else
    printf '%s\n' "$fallback"
  fi
}

print_status() {
  local repo="$1"
  local fallback="$2"
  local name branch head state upstream counts ahead behind

  name="$(repo_name "$repo" "$fallback")"
  branch="$(git -C "$repo" branch --show-current)"
  [[ -n "$branch" ]] || branch="(detached)"
  head="$(git -C "$repo" rev-parse --short HEAD)"
  if [[ -n "$(git -C "$repo" status --porcelain --untracked-files=normal)" ]]; then
    state="dirty"
  else
    state="clean"
  fi

  upstream="$(git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
  if [[ -n "$upstream" ]]; then
    counts="$(git -C "$repo" rev-list --left-right --count "HEAD...$upstream")"
    read -r ahead behind <<<"$counts"
  else
    ahead="-"
    behind="-"
  fi

  printf '%-28s %-16s %-10s %-6s %s/%s\n' "$name" "$branch" "$head" "$state" "$ahead" "$behind"
}

audit_all() {
  local path repo class expected actual changes action
  printf '%-36s %-18s %-10s %-10s %-8s %s\n' "submodule" "class" "pin" "HEAD" "changes" "action"
  while IFS= read -r path; do
    repo="$ROOT/$path"
    class="$(submodule_class "$path")"
    expected="$(git -C "$ROOT" ls-files --stage -- "$path" | awk '{print $2}')"
    expected="${expected:--}"
    actual="-"
    changes="0"
    if is_initialized "$repo"; then
      actual="$(git -C "$repo" rev-parse HEAD)"
      changes="$(git -C "$repo" status --porcelain=v1 --untracked-files=all | wc -l | tr -d ' ')"
    fi
    case "$class" in
      CLEAN_MATCH) action="keep" ;;
      CLEAN_MISMATCH) action="sync-safe" ;;
      UNINITIALIZED|PARTIAL_INIT) action="init-safe" ;;
      *) action="DO-NOT-TOUCH" ;;
    esac
    printf '%-36s %-18s %-10s %-10s %-8s %s\n'       "$path" "$class" "${expected:0:10}" "${actual:0:10}" "$changes" "$action"
  done < <(submodule_paths)
}

sync_safe() {
  local path class
  local -a paths=()

  while IFS= read -r path; do
    class="$(submodule_class "$path")"
    case "$class" in
      CLEAN_MISMATCH|UNINITIALIZED|PARTIAL_INIT)
        echo "sync  $path: $class -> pinned gitlink"
        paths+=("$path")
        ;;
      CLEAN_MATCH)
        echo "ok    $path: already at pinned gitlink"
        ;;
      *)
        echo "skip  $path: $class (local state protected)"
        ;;
    esac
  done < <(submodule_paths)

  if (( ${#paths[@]} > 0 )); then
    git -C "$ROOT" submodule update --init --checkout -- "${paths[@]}"
  fi
}

status_all() {
  local path repo
  printf '%-28s %-16s %-10s %-6s %s\n' "repository" "branch" "HEAD" "state" "ahead/behind"
  print_status "$ROOT" "AgentScape"
  while IFS= read -r path; do
    repo="$ROOT/$path"
    if is_initialized "$repo"; then
      print_status "$repo" "$path"
    else
      printf '%-28s %-16s %-10s %-6s %s\n' "$path" "-" "-" "missing" "-/-"
    fi
  done < <(submodule_paths)
}

pull_repo() {
  local repo="$1"
  local fallback="$2"
  local name branch upstream counts ahead behind

  name="$(repo_name "$repo" "$fallback")"
  if [[ -n "$(git -C "$repo" status --porcelain --untracked-files=normal)" ]]; then
    echo "skip  $name: dirty"
    return 0
  fi

  branch="$(git -C "$repo" branch --show-current)"
  if [[ -z "$branch" ]]; then
    echo "skip  $name: detached HEAD"
    return 0
  fi

  upstream="$(git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
  if [[ -z "$upstream" ]]; then
    echo "skip  $name: no upstream for $branch"
    return 0
  fi

  git -C "$repo" fetch --prune
  counts="$(git -C "$repo" rev-list --left-right --count "HEAD...$upstream")"
  read -r ahead behind <<<"$counts"
  if (( ahead > 0 )); then
    echo "skip  $name: local branch is ahead or diverged ($ahead/$behind)"
  elif (( behind == 0 )); then
    echo "ok    $name: up to date"
  else
    git -C "$repo" pull --ff-only
    echo "ok    $name: fast-forwarded by $behind commit(s)"
  fi
}

pull_all() {
  local path repo
  pull_repo "$ROOT" "AgentScape"
  while IFS= read -r path; do
    repo="$ROOT/$path"
    if is_initialized "$repo"; then
      pull_repo "$repo" "$path"
    else
      echo "skip  $path: not initialized"
    fi
  done < <(submodule_paths)
}

check_all() {
  local failures=0
  local path repo expected actual url branch git_marker class

  while IFS= read -r path; do
    repo="$ROOT/$path"
    if [[ ! -d "$repo" ]]; then
      echo "FAIL  $path: directory missing"
      failures=$((failures + 1))
      continue
    fi

    class="$(submodule_class "$path")"
    if [[ "$class" != "CLEAN_MATCH" ]]; then
      echo "FAIL  $path: $class"
      failures=$((failures + 1))
      continue
    fi

    expected="$(git -C "$ROOT" ls-files --stage -- "$path" | awk '{print $2}')"
    actual="$(git -C "$repo" rev-parse HEAD)"

    url="$(git -C "$repo" remote get-url origin 2>/dev/null || true)"
    if [[ -z "$url" ]]; then
      echo "FAIL  $path: origin remote missing"
      failures=$((failures + 1))
    fi
    case "$url" in
      /*|file://*|[A-Za-z]:[\\/]*)
        echo "FAIL  $path: origin uses a local path"
        failures=$((failures + 1))
        ;;
    esac

    git_marker="$repo/.git"
    if [[ -d "$git_marker" ]]; then
      echo "FAIL  $path: ordinary nested .git directory"
      failures=$((failures + 1))
    fi

    branch="$(git -C "$repo" branch --show-current)"
    if [[ -z "$branch" ]]; then
      echo "ok    $path: detached at pinned HEAD"
    else
      echo "ok    $path: branch $branch at pinned HEAD"
    fi
  done < <(submodule_paths)

  if (( failures > 0 )); then
    echo "check failed: $failures top-level problem(s)"
    return 1
  fi
  echo "check passed: all top-level integration submodules are clean and pinned"
}

check_recursive() {
  local failures=0 line marker

  if ! check_all; then
    failures=$((failures + 1))
  fi

  while IFS= read -r line; do
    marker="${line:0:1}"
    case "$marker" in
      -)
        echo "FAIL  recursive submodule not initialized: ${line:1}"
        failures=$((failures + 1))
        ;;
      +)
        echo "FAIL  recursive submodule does not match its pin: ${line:1}"
        failures=$((failures + 1))
        ;;
      U)
        echo "FAIL  recursive submodule has merge conflicts: ${line:1}"
        failures=$((failures + 1))
        ;;
    esac
  done < <(git -C "$ROOT" submodule status --recursive)

  if ! git -C "$ROOT" submodule foreach --quiet --recursive '
    if ! git remote get-url origin >/dev/null 2>&1; then
      echo "FAIL  $displaypath: origin remote missing"
      exit 1
    fi
    if [ -d .git ]; then
      echo "FAIL  $displaypath: ordinary nested .git directory"
      exit 1
    fi
  '; then
    failures=$((failures + 1))
  fi

  if (( failures > 0 )); then
    echo "recursive check failed: $failures problem group(s)"
    return 1
  fi
  echo "recursive check passed"
}

case "${1:-}" in
  status)
    status_all
    ;;
  audit)
    audit_all
    ;;
  sync-safe)
    sync_safe
    ;;
  init)
    sync_safe
    ;;
  pull)
    pull_all
    ;;
  check)
    check_all
    ;;
  check-recursive)
    check_recursive
    ;;
  *)
    usage
    ;;
esac
