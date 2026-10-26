#!/usr/bin/env bash
# issue-forge's fence (Change 0.10.0, #156): a PreToolUse command hook, run for every tool call in a session with
# issue-forge enabled. issue-forge's own tool.call hook is skipped for the calls of the agents it spawns (re-entry), so
# they are refused here instead. A call that isn't an issue-forge agent's passes at once. One that is fails closed: no
# fence file, a call it can't read, or an error of its own exits 2, which refuses the call. Plain bash, no other
# process. The rules are SPEC Change 0.10.0, item 3; scripts/fence-hook.test.mjs tests them.

# cat, not `read -d ''` (a byte at a time from a pipe: slow on a large Write) or `$(</dev/stdin)` (can't open a socket,
# which is what node hands a child for stdin). An empty read passes the call, which the module's preflight would see.
input=$(cat)

deny() {
  printf 'issue-forge: %s\n' "$1" >&2
  exit 2
}

# count KEY: how often "KEY": appears as a JSON key. Inside a string a quote is escaped (\"KEY\"), so it can't match.
count() {
  local re='"'"$1"'"[[:space:]]*:' rest=$input
  found=0
  while [[ $rest =~ $re ]]; do
    found=$((found + 1))
    rest=${rest#*"${BASH_REMATCH[0]}"}
  done
  return 0
}

# value KEY: the first string value of "KEY", still JSON-escaped.
value() {
  local re='"'"$1"'"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)"'
  got=
  if [[ $input =~ $re ]]; then got=${BASH_REMATCH[1]}; fi
  return 0
}

# unescape TEXT: \\ \" \/ \n \t \r undone; any other escape (\uXXXX) stays as it is.
unescape() {
  local v=$1
  v=${v//\\\\/$'\001'}
  v=${v//\\\"/\"}
  v=${v//\\\//\/}
  v=${v//\\n/$'\n'}
  v=${v//\\t/$'\t'}
  v=${v//\\r/$'\r'}
  out=${v//$'\001'/\\}
  return 0
}

count agent_id
((found == 0)) && exit 0
((found == 1)) || deny 'this call names more than one agent, so the fence refuses it; end your turn now.'
value agent_id
id=$got
count agent_type
((found <= 1)) || deny 'this call names more than one agent type, so the fence refuses it; end your turn now.'
value agent_type
type=$got

ours=0
if [[ $type =~ ^issue-forge-[0-9]+-(red|green|refactor)-[0-9]+$ || $type =~ ^issue-forge:(red|green|refactor)$ ]]; then ours=1; fi

fence="$HOME/.claude/issue-forge-data/fence"
safe='^[A-Za-z0-9_.:@-]+$'
file=
if [[ $id =~ $safe && -f "$fence/id/$id" ]]; then
  file="$fence/id/$id"
elif [[ $type =~ $safe && -f "$fence/name/$type" ]]; then
  file="$fence/name/$type"
fi
[[ -z $file ]] && ((!ours)) && exit 0

# From here the call is an issue-forge agent's. The bash check comes first, so the module's preflight (an agent with no
# fence file) gets it on an old bash and no agent starts (PR #162 review round 1, finding 2).
((BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 2))) || deny "the fence needs bash 4.2 or later (this is $BASH_VERSION); end your turn now."
[[ -z $file ]] && deny 'this agent has no fence file, so it may not call tools; end your turn now.'

# Anything that fails from here refuses the call.
trap 'exit 2' ERR

RETIRED='this run was stopped or restarted; end your turn now without further tool calls.'
line=
IFS= read -r line <"$file" || true
[[ $line == retired ]] && deny "$RETIRED"
[[ $line =~ ^live\ ([0-9]+)\ (.+)$ ]] || deny "this agent's fence file can't be read, so it may not call tools; end your turn now."
until=${BASH_REMATCH[1]}
root=${BASH_REMATCH[2]//\\//}
while [[ $root == *//* ]]; do root=${root//\/\//\/}; done
root=${root%/}
printf -v now '%(%s)T' -1
((now <= until)) || deny "$RETIRED"

count tool_name
((found == 1)) || deny "this call's tool can't be read, so the fence refuses it; end your turn now."
value tool_name
tool=$got

# A path the guard's own rules (guardAction) would refuse to place, or one that names the fence or the plugin.
protected() {
  local p=$1
  [[ $p == "$HOME/.claude/issue-forge-data"* || $p == "$HOME/.claude/settings"* ]] && return 0
  [[ -n $CLAUDE_PLUGIN_ROOT && ($p == "$CLAUDE_PLUGIN_ROOT" || $p == "$CLAUDE_PLUGIN_ROOT"/*) ]] && return 0
  return 1
}

# place PATH: sets placed, absolute, read against the root when relative; returns 1 for a path it can't place.
place() {
  local p=$1
  if [[ $p == /* || $p =~ ^[A-Za-z]:[\\/] ]]; then
    :
  elif [[ $p == \\* || $p == '~' || $p == '~/'* || $p == '~\'* || $p =~ ^[A-Za-z]: ]]; then
    return 1
  else
    p="$root/$p"
  fi
  p=${p//\\//}
  while [[ $p == *//* ]]; do p=${p//\/\//\/}; done
  placed=$p
  return 0
}

# hooks.json matches only the tools that can change something; a retired agent's reads are permitted by design.
case $tool in
  Edit | MultiEdit | Write | NotebookEdit)
    key=file_path
    [[ $tool == NotebookEdit ]] && key=notebook_path
    count "$key"
    ((found == 1)) || deny "this ${tool} call's path can't be read, so the fence refuses it; give one full path, starting $root/."
    value "$key"
    unescape "$got"
    target=$out
    place "$target" || deny "$target can't be placed in this run's folder $root; give the full path, starting $root/."
    [[ /$placed/ == */../* ]] && deny "$target has a .. segment; give the full path, starting $root/."
    protected "$placed" && deny "$target is the fence's or the plugin's own file; edit files in $root only."
    [[ $placed == "$root" || $placed == "$root"/* ]] || deny "$target is outside this run's folder $root; edit files there."
    exit 0
    ;;
  Bash) ;;
  # Matched because they can write, but there's no path in them to check: refused for issue-forge's own agents.
  PowerShell | EnterWorktree | ExitWorktree | mcp__*) deny "the fence can't check ${tool}, so it refuses it; use Edit, Write or Bash in $root." ;;
  *) exit 0 ;;
esac

count command
((found == 1)) || deny "this Bash call's command can't be read, so the fence refuses it; start it with cd '$root' && ."
value command
unescape "$got"
cmd=$out

# Each spelling of the root becomes one mark, so a root holding a blank stays one word.
mark=$'\002'
cmd=${cmd//"'$root'"/$mark}
cmd=${cmd//"\"$root\""/$mark}
cmd=${cmd//"$root"/$mark}
start="^cd[[:space:]]+$mark[[:space:]]*&&"
[[ $cmd =~ $start ]] || deny "start every Bash command with cd '$root' && (this one doesn't), and name no path outside that folder."
back='(^|[[:space:];&|])cd[[:space:]]+-([[:space:];&|]|$)'
[[ $cmd =~ $back ]] && deny "cd - leaves this run's folder $root; stay in it."

words=${cmd//[\'\"\`;|&<>()=]/ }
words=${words//[$'\n\t\r']/ }
read -r -a list <<<"$words" || true
# tidy PATH: placed, with // and /./ folded, so a protected name can't hide behind either.
tidy() {
  local p=$1
  while [[ $p == *//* ]]; do p=${p//\/\//\/}; done
  while [[ $p == */./* ]]; do p=${p//\/.\//\/}; done
  placed=$p
  return 0
}

PROTECTED="the fence's or the plugin's own files; leave them alone."
for w in "${list[@]}"; do
  shown=${w//$mark/$root}
  # Under the root, or relative to it: the protected names still apply (PR #162 review round 2, finding 3).
  if [[ $w == "$mark" || $w == "$mark"/* ]]; then
    [[ /${w#"$mark"}/ == */../* ]] && deny "$shown has a .. segment; stay in this run's folder $root."
    tidy "$shown"
    protected "$placed" && deny "this command names $shown, $PROTECTED"
    continue
  fi
  if [[ $w != /* && $w != '~'* && ! $w =~ ^[A-Za-z]: ]]; then
    tidy "$root/$w"
    protected "$placed" && deny "this command names $shown, $PROTECTED"
  fi
  [[ $w == "$mark"* ]] && deny "this command names $shown, outside this run's folder $root; name paths in it only."
  case $w in
    /dev/null | /dev/stdout | /dev/stderr) continue ;;
  esac
  if [[ $w == /* || $w =~ ^[A-Za-z]:[\\/] ]]; then deny "this command names $shown, outside this run's folder $root; name paths in it only."; fi
  [[ $w == '~'* ]] && deny "this command names $shown, outside this run's folder $root; name paths in it only."
  if [[ $w == *'$HOME'* || $w == *'${HOME}'* || $w == *'$OLDPWD'* || $w == *'${OLDPWD}'* ]]; then deny "this command names $shown, outside this run's folder $root; name paths in it only."; fi
  [[ /$w/ == */../* ]] && deny "$shown has a .. segment; stay in this run's folder $root."
  if [[ $w == *.claude/issue-forge-data* || $w == *.claude/settings* ]]; then deny "this command names $shown, the fence's or Claude Code's own files; leave them alone."; fi
done
exit 0
