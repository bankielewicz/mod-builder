#!/usr/bin/env bash
# Makes an edit's restore point (SPEC.md 8.5): a copy of the mod's folder as it stands, before the edit writes
# anything, without the mod's own .git and node_modules at its top.
# Usage: restore-point.sh <mod folder> <restore folder>
#   <mod folder>      the mod, absolute.
#   <restore folder>  where the copy goes, absolute; it must not exist yet, or be empty.
# Everything else at the mod's top is copied with what it holds: files whose names open with a dot, links as
# links, and a node_modules or .git folder further down (tests/node_modules is the mod's own). The restore
# folder is given the mod folder's mode. When every entry is copied, the file "<restore folder>.complete" is
# written beside it: put-back.sh uses no restore point that lacks it.
# Exit 0: the copy is made, and "restore point: <restore folder>" is printed. Exit 2: wrong arguments. Exit 1: it
# could not be made; what was copied so far is left where it is, with no ".complete" file, and nothing in the
# mod's folder is changed.
set -u
(($# == 2)) || { echo "usage: restore-point.sh <mod folder> <restore folder>" >&2; exit 2; }
mod=${1%/}
restore=${2%/}
[[ $mod == /* && $restore == /* ]] || { echo "restore-point: both folders are named from the root" >&2; exit 2; }
[[ -d $mod && ! -L $mod ]] || { echo "restore-point: $mod is no folder" >&2; exit 1; }
# Whether a path is the mod's folder or lies under it: asked of each folder above it that exists, by what it is
# and not by how it is spelled, so that a link, "..", a doubled slash or another letter case can't hide it.
under_mod() {
  local at=$1
  while [[ -n $at && $at != / ]]; do
    [[ -e $at && $at -ef $mod ]] && return 0
    at=${at%/*}
  done
  return 1
}
under_mod "$restore" && { echo "restore-point: $restore is inside the mod's folder" >&2; exit 1; }
if [[ -e $restore || -L $restore ]]; then
  [[ -d $restore && ! -L $restore && -r $restore && -z $(ls -A -- "$restore") ]] || { echo "restore-point: $restore is already there and is not an empty folder" >&2; exit 1; }
fi
[[ ! -e $restore.complete && ! -L $restore.complete ]] || { echo "restore-point: $restore.complete is already there" >&2; exit 1; }
mkdir -p -- "$restore" || { echo "restore-point: $restore could not be made" >&2; exit 1; }
mode=$(stat -c %a -- "$mod" 2>/dev/null || stat -f %Lp -- "$mod" 2>/dev/null) || mode=
[[ -z $mode ]] || chmod "$mode" -- "$restore" || { echo "restore-point: $restore could not be given the mod folder's mode" >&2; exit 1; }
shopt -s dotglob nullglob
for entry in "$mod"/*; do
  name=${entry##*/}
  [[ $name == .git || $name == node_modules ]] && continue
  cp -a -- "$entry" "$restore/" || { echo "restore-point: $entry could not be copied; the restore point is not complete" >&2; exit 1; }
done
: > "$restore.complete" || { echo "restore-point: $restore.complete could not be written" >&2; exit 1; }
echo "restore point: $restore"
