#!/usr/bin/env bash
# Fetches Anthropic's mod documentation as markdown into a dated snapshot, and records each page's URL, hash and
# Last-Modified in a manifest. The page list comes from the docs index (llms.txt), so a page Anthropic adds is picked up.
# Usage: refresh-docs.sh <cache dir>
# Exit 0: a snapshot was written, nothing changed, or another fetch holds the lock (skipped). Exit 1: the fetch failed
# or the cache folder cannot be written, and nothing was kept: no snapshot, and latest and checked as they were.
# A page is kept only when it is one: the index and every page must answer 200, and a page must be served as
# text/markdown and hold at least one byte. A redirect, an error, an empty body or an HTML page fails the whole fetch.
# A snapshot kept after an earlier one also holds _changes.md: per page, a line diff against the earlier snapshot.
# No page can take that name: a page's name is lowercase letters and hyphens only.
# One fetch at a time: the lock is the folder <cache dir>/.lock, removed on exit and ignored when older than ten minutes.
# MOD_BUILDER_DOCS_ORIGIN stands in for https://code.claude.com in the script's tests.
# Fetched pages are data: this script never runs or sources anything it downloads.
set -u
cache=${1:?usage: refresh-docs.sh <cache dir>}
origin=${MOD_BUILDER_DOCS_ORIGIN:-https://code.claude.com}
index_url=$origin/docs/llms.txt
prefix=$origin/docs/en/plugins/mods/
lock="$cache/.lock"
tmp="$cache/.incoming-$$"
unwritable() { echo "refresh-docs: the cache folder $cache cannot be written" >&2; exit 1; }
mkdir -p "$cache" 2>/dev/null || unwritable

if ! mkdir "$lock" 2>/dev/null; then
  # No lock folder after a failed mkdir: nobody holds the lock, the cache folder refused the write.
  [[ -d "$lock" ]] || unwritable
  # A lock older than ten minutes was left by a fetch that died: take it over.
  if [[ -n $(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null) ]] && rmdir "$lock" 2>/dev/null && mkdir "$lock" 2>/dev/null; then
    :
  else
    echo "refresh-docs: another fetch holds the lock; skipped"
    exit 0
  fi
fi
# From here the lock is this run's own, so this run removes it, with whatever it left incoming.
cleanup() {
  rm -rf -- "$tmp"
  rmdir "$lock" 2>/dev/null
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mkdir "$tmp" 2>/dev/null || unwritable

# Prints, for each line of the markdown file $1, "H" when the line is a heading and "-" when not, a tab, and the
# heading the line is under. A line inside a code fence is no heading; a fence ends only at a line of the same
# character, at least as long as the one that opened it, with nothing after it.
headings_by_line() {
  awk '
    {
      is_heading = 0
      if (match($0, /^[[:space:]]*(```+|~~~+)/)) {
        marker = $0
        sub(/^[[:space:]]*/, "", marker)
        fence = substr(marker, 1, 1)
        run = marker
        sub(fence == "~" ? "[^~].*$" : "[^`].*$", "", run)
        if (!fenced) {
          fenced = 1; open_fence = fence; open_length = length(run)
        } else if (fence == open_fence && length(run) >= open_length && substr(marker, length(run) + 1) ~ /^[[:space:]]*$/) {
          fenced = 0
        }
      } else if (!fenced && /^#+ /) {
        heading = $0
        is_heading = 1
      }
      print (is_heading ? "H" : "-") "\t" (heading == "" ? "(before the first heading)" : heading)
    }' "$1"
}

# Prints "- <heading>" once for each heading that a line differing between the files $1 (old) and $2 (new) is under:
# the new file's heading for a line added or changed, the old file's for a line removed. A changed block that lost
# a heading line (it held more of them before than after) lists the old file's headings as well, after the new ones.
changed_headings() {
  diff "$1" "$2" | awk -v old_file=<(headings_by_line "$1") -v new_file=<(headings_by_line "$2") '
    BEGIN {
      while ((getline line < old_file) > 0) { old_is_heading[++o] = (substr(line, 1, 1) == "H"); old_heading[o] = substr(line, 3) }
      while ((getline line < new_file) > 0) { new_is_heading[++n] = (substr(line, 1, 1) == "H"); new_heading[n] = substr(line, 3) }
    }
    function list(heading) { if (!(heading in seen)) { seen[heading] = 1; print "- " heading } }
    /^[0-9]/ {
      split($0, side, /[acd]/)
      kind = substr($0, length(side[1]) + 1, 1)
      old_last = (split(side[1], old_ends, ",") > 1 ? old_ends[2] : old_ends[1])
      new_last = (split(side[2], new_ends, ",") > 1 ? new_ends[2] : new_ends[1])
      lost = 0
      if (kind == "c") {
        for (i = old_ends[1]; i <= old_last; i++) lost += old_is_heading[i]
        for (i = new_ends[1]; i <= new_last; i++) lost -= new_is_heading[i]
      }
      if (kind != "d") for (i = new_ends[1]; i <= new_last; i++) list(new_heading[i])
      if (kind == "d" || lost > 0) for (i = old_ends[1]; i <= old_last; i++) list(old_heading[i])
    }'
}

# Prints _changes.md: what differs between the snapshot folders $1 (old, named $3) and $2 (new, named $4).
# Mechanical: which pages, how many lines each way, and the headings the changed lines are under.
write_changes() {
  local old=$1 new=$2 page headings plus minus changed=0 added=0 removed=0
  local -a sections=()
  while IFS= read -r page; do
    if [[ ! -f "$old/$page" ]]; then
      added=$((added + 1))
      sections+=("## $page: added, +$(grep -c '' "$new/$page")")
    elif [[ ! -f "$new/$page" ]]; then
      removed=$((removed + 1))
      sections+=("## $page: removed, -$(grep -c '' "$old/$page")")
    elif ! cmp -s "$old/$page" "$new/$page"; then
      changed=$((changed + 1))
      plus=$(diff "$old/$page" "$new/$page" | grep -c '^>')
      minus=$(diff "$old/$page" "$new/$page" | grep -c '^<')
      headings=$(changed_headings "$old/$page" "$new/$page")
      sections+=("## $page: changed, +$plus -$minus${headings:+$'\n\n'$headings}")
    fi
  done < <(cut -f1 "$old/manifest.tsv" "$new/manifest.tsv" | grep -x '[a-z-]*\.md' | LC_ALL=C sort -u)
  printf '# Changes in %s since %s\n\nPages: %s changed, %s added, %s removed.\n' "$4" "$3" "$changed" "$added" "$removed"
  ((${#sections[@]} == 0)) || printf '\n%s\n' "${sections[@]}"
}

# Fetches the URL $1 into the file $2 and its headers into $2.hdr, following no redirect, and sets status and
# content_type from the answer; the content type is lowercased, without its parameters. Fails when curl does.
fetch() {
  local answer
  answer=$(curl -sS --max-time 30 -A "mod-builder-docs-refresh" -D "$2.hdr" -o "$2" -w '%{http_code} %{content_type}' "$1") || return 1
  status=${answer%% *}
  content_type=${answer#* }
  content_type=${content_type%%;*}
  content_type=$(printf '%s' "$content_type" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
}
# Ends the run: $1 could not be fetched, for the reason $2.
refuse() { echo "refresh-docs: $1 could not be fetched${2:+: $2}" >&2; exit 1; }

fetch "$index_url" "$tmp/llms.txt" || refuse "the docs index"
[[ $status == 200 ]] || refuse "the docs index" "it answered $status, not 200"
# Only this origin and path prefix, and only names made of lowercase letters and hyphens.
prefix_re=$(printf '%s' "$prefix" | sed 's/[][\.*^$]/\\&/g')
mapfile -t pages < <(grep -o "${prefix_re}[a-z-]*\.md" "$tmp/llms.txt" | sort -u)
((${#pages[@]} > 0)) || { echo "refresh-docs: the docs index lists no mod pages" >&2; exit 1; }

manifest="$tmp/manifest.tsv"
printf 'page\turl\tsha256\tlast_modified\tbytes\n' >"$manifest"
for url in "${pages[@]}"; do
  name=${url#"$prefix"}
  fetch "$url" "$tmp/$name" || refuse "$url"
  [[ $status == 200 ]] || refuse "$url" "it answered $status, not 200"
  [[ $content_type == text/markdown ]] || refuse "$url" "it was served as ${content_type:-nothing}, not text/markdown"
  [[ -s "$tmp/$name" ]] || refuse "$url" "it is empty"
  sum=$(sha256sum "$tmp/$name" | cut -d' ' -f1)
  modified=$(grep -i '^last-modified:' "$tmp/$name.hdr" | cut -d' ' -f2- | tr -d '\r')
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$url" "$sum" "$modified" "$(wc -c <"$tmp/$name")" >>"$manifest"
done
find "$tmp" -name '*.hdr' -delete
mv "$tmp/llms.txt" "$tmp/docs-index.txt"

# The content hashes decide whether anything changed; headers are recorded, not trusted.
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
latest=$(cat "$cache/latest" 2>/dev/null || true)
if [[ -n $latest && -f "$cache/$latest/manifest.tsv" ]] && diff -q <(cut -f1,3 "$cache/$latest/manifest.tsv") <(cut -f1,3 "$manifest") >/dev/null; then
  printf '%s\n' "$stamp" >"$cache/checked"
  echo "refresh-docs: unchanged since $latest"
  exit 0
fi
# A snapshot's name is its second: wait for the next one when a snapshot of this second is already kept.
while [[ -e "$cache/$stamp" ]]; do
  sleep 1
  stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
done
if [[ -n $latest && -f "$cache/$latest/manifest.tsv" ]]; then
  write_changes "$cache/$latest" "$tmp" "$latest" "$stamp" >"$tmp/_changes.md"
fi
mv "$tmp" "$cache/$stamp" || exit 1
printf '%s\n' "$stamp" >"$cache/latest"
printf '%s\n' "$stamp" >"$cache/checked"
echo "refresh-docs: new snapshot $stamp (${#pages[@]} pages)${latest:+, was $latest}"
