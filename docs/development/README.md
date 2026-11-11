# Developing mod-builder

How to run the plugin's own tests and typecheck. How changes are made is in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Its own tests and typecheck

From the repository's top folder:

```bash
claude plugin validate --strict plugins/mod-builder
claude plugin test plugins/mod-builder
node --test --test-timeout=120000 plugins/mod-builder/tests/*.test.mjs plugins/mod-builder/scripts/*.test.mjs
```

The typecheck is against the types of the installed build, which Claude Code writes when its built-in
`plugin-authoring` skill loads (load it once in any session first; they are never copied into this repository):

```bash
V=$(claude --version | cut -d' ' -f1)
T=$(ls "${CLAUDE_TMPDIR:-/tmp/claude-$(id -u)}"/bundled-skills/"$V"/*/plugin-authoring/types/claude-code.d.ts | head -1)
D=$(mktemp -d)
cat > "$D/tsconfig.json" <<EOF
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [], "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": ["$T", "$PWD/plugins/mod-builder/hooks", "$PWD/plugins/mod-builder/tests"]
}
EOF
(cd "$D" && npx -y -p typescript tsc --noEmit -p "$D/tsconfig.json")
```

It exits 0 and prints nothing when the module and its tests typecheck. (`head -1` takes the first types file
by name; the gate itself never picks one, and runs the typecheck against every distinct file.)
