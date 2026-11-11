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
#   scaffold.sh --check-hooks <mod folder> <mod name>
#   scaffold.sh --again-hooks <mod folder> <mod name>
#     The same two for hooks/ alone (SPEC.md 9.17): hooks/hooks.json and hooks/register.tsx. Nothing under tests/
#     is compared, listed or written: at Red the tests are the build's to change, and hooks/ is still the template.
# Every check and every laying-again also looks, in the whole mod, for source outside hooks/ and tests/ (SPEC.md
# 9.17, point 4): a file whose name ends in .ts, .tsx, .mts, .cts, .js, .jsx, .mjs or .cjs. Scaffold may add a
# contract, so a declaration file under types/ (.d.ts, .d.mts, .d.cts) is none; and what the mod does not own is
# not looked into or is let be: its own .git and node_modules at the top, and the one index.d.ts Claude Code
# writes in each folder under .claude-plugin/types/. A link outside hooks/ and tests/ is source whatever its
# name: what it points at could be. Each is printed as "source: <path>", after the lines above; a check that finds one exits
# 1, and --again and --again-hooks print them and delete nothing.
# Whatever reads the output may stop reading early: everything is worked out before the first line is printed,
# nothing runs beside the script, and its temporary folder is used by it alone and removed when it ends.
set -u
mode=lay
scope=all
if [[ ${1-} == --check || ${1-} == --again || ${1-} == --check-hooks || ${1-} == --again-hooks ]]; then
  flag=$1
  mode=${flag#--}
  [[ $mode == *-hooks ]] && scope=hooks
  mode=${mode%-hooks}
  shift
  (($# == 2)) || { echo "usage: scaffold.sh $flag <mod folder> <mod name>" >&2; exit 2; }
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
folders=(hooks tests)
if [[ $scope == hooks ]]; then
  laid=(hooks/hooks.json hooks/register.tsx)
  folders=(hooks)
fi
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
# The temporary folder goes before the first line is printed: a reader that stops reading ends the script where
# it prints, and nothing is left behind then.
tidy() {
  rm -r -- "$staged"
  trap - EXIT
}
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
# Everything under the folders asked about that is not a folder and not one of the laid files, by its path from
# the mod, sorted as bytes, one to a line in "$staged/.extras"; a link is listed and never followed. A folder that
# can't be read through is listed itself, as "<folder> (it can't be read)": what it holds is not known, so it is
# never passed over. Each step ends before the next begins: nothing here runs beside the script.
list_extras() {
  local folder path one known
  : >"$staged/.extras"
  for folder in "${folders[@]}"; do
    [[ -d "$mod/$folder" && ! -L "$mod/$folder" ]] || continue
    if ! find "$mod/$folder" -mindepth 1 ! -type d -print0 >"$staged/.found" 2>/dev/null; then
      printf '%s\n' "$folder (it can't be read)" >>"$staged/.extras"
      continue
    fi
    LC_ALL=C sort -z "$staged/.found" >"$staged/.sorted"
    while IFS= read -r -d '' path; do
      path=${path#"$mod/"}
      known=0
      for one in "${laid[@]}"; do [[ $path == "$one" ]] && known=1; done
      ((known == 1)) || printf '%s\n' "$path" >>"$staged/.extras"
    done <"$staged/.sorted"
  done
}
# The mod's source outside hooks/ and tests/, one path from the mod to a line in "$staged/.sources", sorted as
# bytes; a link is listed by its name and never followed. When a folder of the mod can't be read through, what it
# holds is not known, and the line "<the mod> (a folder can't be read)" says so.
list_sources() {
  local path
  : >"$staged/.sources"
  [[ -d "$mod" && ! -L "$mod" ]] || return 0
  # The search runs from inside the mod with paths from it: find reads a -path as a pattern, and the mod's own
  # path may hold a character a pattern gives meaning to.
  if ! (cd -- "$mod" && find . -mindepth 1 \( -path ./.git -o -path ./node_modules -o -path ./hooks -o -path ./tests \) -prune -o ! -type d \( -type l -o -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \) -print0) >"$staged/.found" 2>/dev/null; then
    printf '%s\n' "the mod (a folder can't be read)" >>"$staged/.sources"
    return 0
  fi
  LC_ALL=C sort -z "$staged/.found" >"$staged/.sorted"
  while IFS= read -r -d '' path; do
    path=${path#./}
    [[ $path == types/* && ( $path == *.d.ts || $path == *.d.mts || $path == *.d.cts ) ]] && continue
    # What Claude Code writes into a mod it loads: one index.d.ts in each folder under .claude-plugin/types/.
    [[ $path == .claude-plugin/types/*/index.d.ts && $path != .claude-plugin/types/*/*/index.d.ts ]] && continue
    printf '%s\n' "$path" >>"$staged/.sources"
  done <"$staged/.sorted"
}
# What the script says is gathered here, and printed once, when everything is done. A reader that has stopped
# reading gets no complaint: where the caller has the broken pipe ignored, the write fails without a word, and
# the exit code is still the script's own.
said=()
say() {
  printf '%s\n' "$@" 2>/dev/null || true
}
if [[ $mode == check ]]; then
  for folder in "${folders[@]}"; do
    if [[ -L "$mod/$folder" ]]; then said+=("changed: $folder"); fi
  done
  for file in "${laid[@]}"; do
    if [[ ! -e "$mod/$file" && ! -L "$mod/$file" ]]; then
      said+=("missing: $file")
    elif [[ -L "$mod/$file" || ! -f "$mod/$file" ]] || ! cmp -s -- "$staged/$file" "$mod/$file"; then
      said+=("changed: $file")
    fi
  done
  list_extras
  while IFS= read -r path; do said+=("extra: $path"); done <"$staged/.extras"
  list_sources
  while IFS= read -r path; do said+=("source: $path"); done <"$staged/.sources"
  tidy
  if ((${#said[@]} > 0)); then
    say "${said[@]}"
    exit 1
  fi
  say "as laid: ${laid[*]}"
  exit 0
fi
if [[ $mode == again ]]; then
  for folder in "${folders[@]}"; do
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
  for file in "${laid[@]}"; do said+=("wrote $mod/$file"); done
  list_extras
  while IFS= read -r path; do said+=("extra: $path"); done <"$staged/.extras"
  list_sources
  while IFS= read -r path; do said+=("source: $path"); done <"$staged/.sources"
  tidy
  say "${said[@]}"
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
tidy
for file in "${files[@]}"; do said+=("wrote $mod/$file"); done
say "${said[@]}"
