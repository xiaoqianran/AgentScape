#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
GITMODULES="$ROOT/.gitmodules"

usage() {
  echo "Usage: $0 {status|init|pull|check}" >&2
  exit 2
}

submodule_paths() {
  [[ -f "$GITMODULES" ]] || return 0
  git config --file "$GITMODULES" --get-regexp '^submodule\..*\.path$' |
    while read -r _ path; do
      printf '%s\n' "$path"
    done
}

is_initialized() {
  local repo="$1"
  [[ -d "$repo" ]] && git -C "$repo" rev-parse --git-dir >/dev/null 2>&1
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
  local path repo expected actual url branch git_marker line marker

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

  while IFS= read -r path; do
    repo="$ROOT/$path"
    if [[ ! -d "$repo" ]]; then
      echo "FAIL  $path: directory missing"
      failures=$((failures + 1))
      continue
    fi
    if ! is_initialized "$repo"; then
      echo "FAIL  $path: not initialized"
      failures=$((failures + 1))
      continue
    fi

    expected="$(git -C "$ROOT" ls-files --stage -- "$path" | awk '{print $2}')"
    actual="$(git -C "$repo" rev-parse HEAD)"
    if [[ -z "$expected" || "$actual" != "$expected" ]]; then
      echo "FAIL  $path: HEAD $actual does not match pin ${expected:-missing}"
      failures=$((failures + 1))
    fi

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
    if [[ -z "$branch" && "$actual" == "$expected" ]]; then
      echo "ok    $path: detached at pinned HEAD"
    elif [[ "$actual" == "$expected" ]]; then
      echo "ok    $path: branch $branch at pinned HEAD"
    fi
  done < <(submodule_paths)

  if (( failures > 0 )); then
    echo "check failed: $failures problem(s)"
    return 1
  fi
  echo "check passed"
}

case "${1:-}" in
  status)
    status_all
    ;;
  init)
    git -C "$ROOT" submodule update --init --recursive
    ;;
  pull)
    pull_all
    ;;
  check)
    check_all
    ;;
  *)
    usage
    ;;
esac
