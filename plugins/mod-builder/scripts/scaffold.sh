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
#
# Two more ways to run it, for a Scaffold that holds the template and nothing else (SPEC.md 9.4, 9.15). Both make
# the template's files for the name as above, and neither takes an author: the manifest is not theirs.
#   scaffold.sh --check <mod folder> <mod name>
#     Writes nothing in the mod. Compares what is under hooks/ and tests/ with what the template lays there, and
#     prints one line for each difference: "changed: <path>" (the file differs, or is a link or no plain file),
#     "missing: <path>", "extra: <path>" (anything else there that is not a folder). Exit 0 with one line,
#     "as laid: <the three paths>", when there is none; exit 1 with the lines; exit 2 for wrong arguments.
#   scaffold.sh --again <mod folder> <mod name>
#     Writes hooks/hooks.json, hooks/register.tsx and tests/pane.test.tsx as the template has them, over what is
#     there, each printed as "wrote <path>"; leaves the manifest and everything else; deletes nothing, and prints
#     "extra: <path>" for what else is under hooks/ and tests/. A link or a folder where one of the three goes is
#     refused, and then nothing is written. Exit 0: written. Exit 1: refused. Exit 2: wrong arguments.
set -u
mode=lay
if [[ ${1-} == --check || ${1-} == --again ]]; then
  mode=${1#--}
  shift
  (($# == 2)) || { echo "usage: scaffold.sh --$mode <mod folder> <mod name>" >&2; exit 2; }
fi
(($# == 2 || $# == 3)) || { echo "usage: scaffold.sh <mod folder> <mod name> [author]" >&2; exit 2; }
mod=$1
name=$2
[[ -n $mod ]] || { echo "scaffold: the mod folder is empty" >&2; exit 2; }
[[ $name =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || { echo "scaffold: \"$name\" is no mod name: lowercase letters and digits in groups joined by single hyphens, starting with a letter" >&2; exit 2; }
# The author goes into the manifest alone, which --check and --again leave: they ask for none.
if [[ $mode == lay ]]; then
  author=${3:-$(git config user.name 2>/dev/null || true)}
  [[ -n $author ]] || author=$(id -un)
else
  author=none
fi
[[ $author != *[[:cntrl:]]* ]] || { echo "scaffold: the author holds a control character (a tab or a line break); give one line of text" >&2; exit 2; }
[[ $mod == /* ]] || mod=$PWD/$mod
template=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../skills/build/templates/pane" && pwd) || { echo "scaffold: the pane template is missing" >&2; exit 1; }
files=(.claude-plugin/plugin.json hooks/hooks.json hooks/register.tsx tests/pane.test.tsx)
# What --check and --again are about: the files the template lays under hooks/ and tests/.
laid=(hooks/hooks.json hooks/register.tsx tests/pane.test.tsx)
if [[ $mode == lay ]]; then
  for file in "${files[@]}"; do
    if [[ -e "$mod/$file" || -L "$mod/$file" ]]; then
      echo "scaffold: $mod/$file is already there; nothing was written" >&2
      exit 1
    fi
  done
fi
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
# Everything under hooks/ and tests/ that is not a folder and not one of the three, by its path from the mod,
# sorted as bytes; a link is listed and never followed. A folder that can't be read through is listed itself, as
# "<folder> (it can't be read)": what it holds is not known, so it is never passed over.
extras() {
  local folder path one known
  for folder in hooks tests; do
    [[ -d "$mod/$folder" && ! -L "$mod/$folder" ]] || continue
    if ! find "$mod/$folder" -mindepth 1 ! -type d -print0 >"$staged/.found" 2>/dev/null; then
      printf '%s\n' "$folder (it can't be read)"
      continue
    fi
    while IFS= read -r -d '' path; do
      path=${path#"$mod/"}
      known=0
      for one in "${laid[@]}"; do [[ $path == "$one" ]] && known=1; done
      ((known == 1)) || printf '%s\n' "$path"
    done < <(LC_ALL=C sort -z "$staged/.found")
  done
}
if [[ $mode == check ]]; then
  differs=0
  for folder in hooks tests; do
    if [[ -L "$mod/$folder" ]]; then echo "changed: $folder"; differs=1; fi
  done
  for file in "${laid[@]}"; do
    if [[ ! -e "$mod/$file" && ! -L "$mod/$file" ]]; then
      echo "missing: $file"; differs=1
    elif [[ -L "$mod/$file" || ! -f "$mod/$file" ]] || ! cmp -s -- "$staged/$file" "$mod/$file"; then
      echo "changed: $file"; differs=1
    fi
  done
  while IFS= read -r path; do echo "extra: $path"; differs=1; done < <(extras)
  ((differs == 0)) || exit 1
  echo "as laid: ${laid[*]}"
  exit 0
fi
if [[ $mode == again ]]; then
  for folder in hooks tests; do
    if [[ -L "$mod/$folder" || ( -e "$mod/$folder" && ! -d "$mod/$folder" ) ]]; then
      echo "scaffold: $mod/$folder is a link or no folder; nothing was written" >&2
      exit 1
    fi
  done
  for file in "${laid[@]}"; do
    if [[ -L "$mod/$file" || ( -e "$mod/$file" && ! -f "$mod/$file" ) ]]; then
      echo "scaffold: $mod/$file is a link or no plain file; nothing was written" >&2
      exit 1
    fi
  done
  for file in "${laid[@]}"; do
    mkdir -p -- "$(dirname -- "$mod/$file")" || { echo "scaffold: the folder for $mod/$file could not be made" >&2; exit 1; }
  done
  for file in "${laid[@]}"; do
    cp -- "$staged/$file" "$mod/$file" || { echo "scaffold: $mod/$file could not be written" >&2; exit 1; }
  done
  for file in "${laid[@]}"; do echo "wrote $mod/$file"; done
  while IFS= read -r path; do echo "extra: $path"; done < <(extras)
  exit 0
fi
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
