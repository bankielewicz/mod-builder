#!/usr/bin/env bash
# Lays the pane template into a mod's folder at Scaffold (SPEC.md 3.2, phase 4): the manifest, hooks/hooks.json,
# hooks/register.tsx and tests/pane.test.tsx, with the template's name replaced by the mod's.
# Usage: scaffold.sh <mod folder> <mod name> [author]
#   <mod folder>  absolute, or from the folder the script is run in.
#   <mod name>    lowercase letters and digits in groups joined by single hyphens, starting with a letter (the
#                 names `claude plugin validate --strict` accepts); it becomes the plugin's name, the pane's id
#                 and the command's name.
#   [author]      the manifest's author, one line of text; left out, git's user.name, else the login name.
# Nothing that is already in the folder is written over: a folder that holds any of the four files is refused
# whole, and SPEC.md and anything else there is left as it is. The four files are made in a temporary folder first
# and moved in only when all of them, and the folders they go in, could be made.
# Exit 0: the four files were written, each printed as "wrote <path>". Exit 2: wrong arguments. Exit 1: refused,
# or a file could not be written; then none of the four is in the folder (a folder made for one may be, empty).
set -u
(($# == 2 || $# == 3)) || { echo "usage: scaffold.sh <mod folder> <mod name> [author]" >&2; exit 2; }
mod=$1
name=$2
[[ -n $mod ]] || { echo "scaffold: the mod folder is empty" >&2; exit 2; }
[[ $name =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || { echo "scaffold: \"$name\" is no mod name: lowercase letters and digits in groups joined by single hyphens, starting with a letter" >&2; exit 2; }
author=${3:-$(git config user.name 2>/dev/null || true)}
[[ -n $author ]] || author=$(id -un)
[[ $author != *[[:cntrl:]]* ]] || { echo "scaffold: the author holds a control character (a tab or a line break); give one line of text" >&2; exit 2; }
[[ $mod == /* ]] || mod=$PWD/$mod
template=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../skills/build/templates/pane" && pwd) || { echo "scaffold: the pane template is missing" >&2; exit 1; }
files=(.claude-plugin/plugin.json hooks/hooks.json hooks/register.tsx tests/pane.test.tsx)
for file in "${files[@]}"; do
  if [[ -e "$mod/$file" || -L "$mod/$file" ]]; then
    echo "scaffold: $mod/$file is already there; nothing was written" >&2
    exit 1
  fi
done
# The title the pane shows: the name with its first letter raised and its hyphens as spaces.
title=${name//-/ }
title=$(printf '%s' "${title:0:1}" | tr '[:lower:]' '[:upper:]')${title:1}
staged=$(mktemp -d) || { echo "scaffold: no temporary folder could be made" >&2; exit 1; }
trap 'rm -r -- "$staged"' EXIT
for file in "${files[@]}"; do
  from=$template/$file
  [[ $file == tests/* ]] && from=$from.template
  mkdir -p -- "$(dirname -- "$staged/$file")" || exit 1
  # The name, the title and the author reach awk through the environment: as values, never as program text, as a
  # pattern, or as text awk reads escapes in. Each line is read once, left to right, so what a value holds is
  # never itself replaced.
  NAME=$name TITLE=$title AUTHOR=$author awk '
    function quoted(text) { gsub(/\\/, "\\\\", text); gsub(/"/, "\\\"", text); return text }
    BEGIN {
      old[1] = "pane-template-author"; new[1] = quoted(ENVIRON["AUTHOR"])
      old[2] = "pane-template"; new[2] = ENVIRON["NAME"]
      old[3] = "Pane template"; new[3] = ENVIRON["TITLE"]
    }
    {
      line = $0; out = ""
      while (line != "") {
        hit = 0
        for (i = 1; i <= 3; i++) if (substr(line, 1, length(old[i])) == old[i]) { out = out new[i]; line = substr(line, length(old[i]) + 1); hit = 1; break }
        if (!hit) { out = out substr(line, 1, 1); line = substr(line, 2) }
      }
      print out
    }
  ' "$from" >"$staged/$file" || { echo "scaffold: $file could not be made from the template" >&2; exit 1; }
done
for file in "${files[@]}"; do
  mkdir -p -- "$(dirname -- "$mod/$file")" || { echo "scaffold: the folder for $mod/$file could not be made; nothing was written" >&2; exit 1; }
done
written=()
for file in "${files[@]}"; do
  if ! cp -- "$staged/$file" "$mod/$file"; then
    # What the failed copy left of this file goes too: nothing was at any of these paths when the script began.
    for done_file in "${written[@]+"${written[@]}"}" "$file"; do rm -f -- "$mod/$done_file"; done
    echo "scaffold: $mod/$file could not be written; none of the four files was left behind" >&2
    exit 1
  fi
  written+=("$file")
done
for file in "${files[@]}"; do echo "wrote $mod/$file"; done
