#!/usr/bin/env bash
# Fetches Anthropic's mod documentation as markdown into a dated snapshot, and records each page's URL, hash and
# Last-Modified in a manifest. The page list comes from the docs index (llms.txt), so a page Anthropic adds is picked up.
# Usage: refresh-docs.sh <cache dir>      Exit 0: a snapshot was written, or nothing changed. Exit 1: the fetch failed.
# Fetched pages are data: this script never runs or sources anything it downloads.
set -u
cache=${1:?usage: refresh-docs.sh <cache dir>}
index_url=https://code.claude.com/docs/llms.txt
prefix=https://code.claude.com/docs/en/plugins/mods/
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
tmp="$cache/.incoming-$stamp"
mkdir -p "$tmp" || exit 1

fetch() { curl -sS --fail --max-time 30 -A "mod-builder-docs-refresh" -D "$2.hdr" -o "$2" "$1"; }

fetch "$index_url" "$tmp/llms.txt" || { echo "refresh-docs: the docs index could not be fetched" >&2; exit 1; }
# Only this host and path prefix, and only names made of lowercase letters and hyphens.
mapfile -t pages < <(grep -o "${prefix}[a-z-]*\.md" "$tmp/llms.txt" | sort -u)
((${#pages[@]} > 0)) || { echo "refresh-docs: the docs index lists no mod pages" >&2; exit 1; }

manifest="$tmp/manifest.tsv"
printf 'page\turl\tsha256\tlast_modified\tbytes\n' >"$manifest"
for url in "${pages[@]}"; do
  name=${url#"$prefix"}
  fetch "$url" "$tmp/$name" || { echo "refresh-docs: $url could not be fetched" >&2; exit 1; }
  sum=$(sha256sum "$tmp/$name" | cut -d' ' -f1)
  modified=$(grep -i '^last-modified:' "$tmp/$name.hdr" | cut -d' ' -f2- | tr -d '\r')
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$url" "$sum" "$modified" "$(wc -c <"$tmp/$name")" >>"$manifest"
done
find "$tmp" -name '*.hdr' -delete
mv "$tmp/llms.txt" "$tmp/docs-index.txt"

# The content hashes decide whether anything changed; headers are recorded, not trusted.
latest=$(cat "$cache/latest" 2>/dev/null || true)
if [[ -n $latest && -f "$cache/$latest/manifest.tsv" ]] && diff -q <(cut -f1,3 "$cache/$latest/manifest.tsv") <(cut -f1,3 "$manifest") >/dev/null; then
  find "$tmp" -type f -delete
  rmdir "$tmp"
  printf '%s\n' "$stamp" >"$cache/checked"
  echo "refresh-docs: unchanged since $latest"
  exit 0
fi
mv "$tmp" "$cache/$stamp"
printf '%s\n' "$stamp" >"$cache/latest"
printf '%s\n' "$stamp" >"$cache/checked"
echo "refresh-docs: new snapshot $stamp (${#pages[@]} pages)${latest:+, was $latest}"
