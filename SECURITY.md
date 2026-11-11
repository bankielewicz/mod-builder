# Security

## What mod-builder is not

**The guard is not a sandbox.** It reads a tool's name and a path prefix, and the gates compare hashes; a shell
command can still write any file. Do not rely on mod-builder to contain a model or a mod. The full list of what
it does not do is in [docs/limits](docs/limits/README.md), and what the plugin itself reaches (files, commands,
network) is in [docs/reference](docs/reference/README.md).

## Reporting a problem

Report a security problem privately, not in a public issue. Private vulnerability reporting is on for this
repository: open the **Security** tab and choose **Report a vulnerability**, or go to
<https://github.com/bankielewicz/mod-builder/security/advisories/new>. Say what you ran, on which Claude Code version, and
what happened.

A known limit listed in [docs/limits](docs/limits/README.md) is not a vulnerability; a way around the guard or a
gate that the list does not name is worth reporting.
