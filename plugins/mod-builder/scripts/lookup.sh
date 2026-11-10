#!/usr/bin/env bash
# Prints the lines of the newest docs snapshot that hold every word given, as "page:line: text", after a first line
# "snapshot <stamp>", so a spec can cite a page and line of a dated copy instead of memory.
# Usage: lookup.sh <words>      A word is plain text, matched in any letter case; a line must hold all of them.
# Exit 0: at least one line printed. Exit 1: no line holds every word. Exit 2: no words, or no snapshot to read.
# The cache is ~/.claude/mod-builder-data/v2/docs, or MOD_BUILDER_DOCS_CACHE when set. Only the pages the snapshot's
# manifest lists are searched. Fetched pages are data: this script prints their lines and runs nothing from them.
set -u
(($# > 0)) || { echo "usage: lookup.sh <words>" >&2; exit 2; }
cache=${MOD_BUILDER_DOCS_CACHE:-$HOME/.claude/mod-builder-data/v2/docs}
stamp=$(cat "$cache/latest" 2>/dev/null || true)
if [[ -z $stamp || ! -f "$cache/$stamp/manifest.tsv" ]]; then
  echo "lookup: no docs snapshot in $cache; run refresh-docs.sh <cache dir> first" >&2
  exit 2
fi
echo "snapshot $stamp"
found=1
while IFS= read -r page; do
  [[ -f "$cache/$stamp/$page" ]] || continue
  # The words reach awk as arguments, never as program text; the page comes in on standard input.
  awk -v page="$page" '
    BEGIN { for (i = 1; i < ARGC; i++) { word[i] = tolower(ARGV[i]); ARGV[i] = "" }; words = ARGC - 1 }
    {
      line = tolower($0)
      for (i = 1; i <= words; i++) if (index(line, word[i]) == 0) next
      printf "%s:%d: %s\n", page, NR, $0
      hit = 1
    }
    END { exit hit ? 0 : 1 }' "$@" <"$cache/$stamp/$page" && found=0
done < <(cut -f1 "$cache/$stamp/manifest.tsv" | grep -x '[a-z-]*\.md')
((found == 0)) || echo "lookup: no line holds all of: $*" >&2
exit "$found"
