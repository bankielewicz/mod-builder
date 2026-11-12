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

Set `TMPDIR` to a folder of the run's own for the node tests, so that nothing is left in the system's:

```bash
export TMPDIR=$(mktemp -d)
```

Each test file makes its temporary folders through `tempDir` (`scripts/test-helpers.mjs`), under one
`mod-builder-run-*` folder for its process, and removes that folder when it ends, pass or fail; one test
(`scripts/leaves-nothing.test.mjs`) runs every other node test file and fails when a run leaves anything, so it
also fails whenever another node test fails. A new test that needs a temporary folder uses `tempDir`, never
`mkdtemp` on the bare temporary folder.

A long `TMPDIR` breaks the command sandbox of a `claude` session started under it ("Failed to create bridge
sockets"): start a live session to try the plugin with `TMPDIR` unset (`env -u TMPDIR claude --plugin-dir ...`).

A helper in a test file that checks a state uses an assertion (`expect` or `assert`), never a thrown `Error`:
Red means "fails by assertion", and a helper that throws makes that untrue (`SPEC.md` 9.32).

Two of the rules tests run a real TypeScript compiler on the `tsconfig.json` the plugin writes for an edit's
test files (`tests/mod-builder-logic-edit-file-roots.test.mjs`). They use the compiler the environment variable
`MOD_BUILDER_TSC` names, else `tsc` when it is on the path, and are reported as skipped when there is neither.


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
