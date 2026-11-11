#!/usr/bin/env bash
# Puts a mod back as it was before a stopped edit (SPEC.md 8.5, 8.17). Nothing is deleted: the mod's folder as it
# is now is renamed, the restore point is copied to the mod's folder, and the mod's own .git and node_modules,
# which the restore point leaves out, are moved from the renamed folder into the restored one.
# Usage: put-back.sh <mod folder> <restore folder> <stopped folder>
#   <mod folder>      the mod, absolute.
#   <restore folder>  the edit's restore point, absolute, as restore-point.sh made it: "<restore folder>.complete"
#                     is beside it.
#   <stopped folder>  the name the mod's folder as it is now is given, absolute: in the folder that holds the mod,
#                     named "<the mod folder's name>.stopped-<anything>"; it must not exist yet.
# Exit 0: the mod is put back. Printed, one line each: "put back: <mod folder>", "kept: <stopped folder>", and
# "moved: <names>" for what was moved into the restored mod (".git", "node_modules"), or "moved: nothing".
# Exit 2: wrong arguments. Exit 1: refused before anything was renamed ("nothing was changed"), or it failed
# after: the line printed then says where the mod's files are.
set -u
(($# == 3)) || { echo "usage: put-back.sh <mod folder> <restore folder> <stopped folder>" >&2; exit 2; }
mod=${1%/}
restore=${2%/}
stopped=${3%/}
[[ $mod == /* && $restore == /* && $stopped == /* ]] || { echo "put-back: the three folders are named from the root" >&2; exit 2; }
refuse() { echo "put-back: $1; nothing was changed" >&2; exit 1; }
[[ -d $mod && ! -L $mod ]] || refuse "$mod is no folder"
[[ -d $restore && ! -L $restore ]] || refuse "the restore point $restore is no folder"
[[ -f $restore.complete && ! -L $restore.complete ]] || refuse "the restore point $restore is not complete ($restore.complete is missing)"
[[ ! -e $stopped && ! -L $stopped ]] || refuse "$stopped is already there"
# Whether a path is a folder or lies under it: asked of each folder above it that exists, by what it is and not by
# how it is spelled, so that a link, "..", a doubled slash or another letter case can't hide it.
under() {
  local at=$1
  while [[ -n $at && $at != / ]]; do
    [[ -e $at && $at -ef $2 ]] && return 0
    at=${at%/*}
  done
  return 1
}
under "$restore" "$mod" && refuse "the restore point is inside the mod's folder"
under "$mod" "$restore" && refuse "the mod's folder is inside the restore point"
# The stopped folder stands beside the mod, under the mod's name: a rename in one folder, never a copy elsewhere.
[[ ${stopped%/*} -ef ${mod%/*} && ${stopped##*/} == "${mod##*/}".stopped-?* ]] || refuse "$stopped is not beside the mod under the name ${mod##*/}.stopped-<stamp>"
mode=$(stat -c %a -- "$mod" 2>/dev/null || stat -f %Lp -- "$mod" 2>/dev/null) || mode=
mv -- "$mod" "$stopped" || refuse "$mod could not be renamed"
failed() { echo "put-back: $1. The mod as it was when stopped is in $stopped, and the restore point in $restore; $mod is not complete" >&2; exit 1; }
mkdir -- "$mod" || failed "$mod could not be made"
[[ -z $mode ]] || chmod "$mode" -- "$mod" || failed "$mod could not be given its mode"
shopt -s dotglob nullglob
for entry in "$restore"/*; do
  cp -a -- "$entry" "$mod/" || failed "$entry could not be copied"
done
moved=()
for name in .git node_modules; do
  if [[ -e $stopped/$name || -L $stopped/$name ]]; then
    [[ ! -e $mod/$name && ! -L $mod/$name ]] || failed "$mod/$name came from the restore point, so $stopped/$name was not moved"
    mv -- "$stopped/$name" "$mod/$name" || failed "$stopped/$name could not be moved"
    moved+=("$name")
  fi
done
echo "put back: $mod"
echo "kept: $stopped"
if ((${#moved[@]} > 0)); then (IFS=,; echo "moved: ${moved[*]}" | sed 's/,/, /g'); else echo "moved: nothing"; fi
