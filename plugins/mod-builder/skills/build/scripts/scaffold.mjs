#!/usr/bin/env node
// Scaffolds a mod from the templates: the common files plus one archetype.
//
//   node scaffold.mjs <archetype> <mods-folder> <name> "<description>" ["<author>"] ["<license>"]
//
// license: an SPDX identifier such as MIT, written into plugin.json only when given.
//
// archetype: band | pane-command | guard | watcher | command-only
// Refuses to write into a folder that already holds files, so it never
// overwrites a mod. Prints every file it wrote.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ARCHETYPES = ['band', 'pane-command', 'guard', 'watcher', 'command-only']
const here = dirname(fileURLToPath(import.meta.url))
const templates = resolve(here, '../templates')

const [archetype, modsDir, name, description, author = 'Unknown', license = ''] = process.argv.slice(2)

function fail(message) {
  console.error(`scaffold: ${message}`)
  process.exit(1)
}

if (!ARCHETYPES.includes(archetype ?? '')) fail(`archetype must be one of ${ARCHETYPES.join(', ')}`)
if (!modsDir) fail('missing mods folder')
if (!/^[a-z][a-z0-9-]{1,40}$/.test(name ?? '')) fail('name must be kebab-case, 2-41 characters, starting with a letter')
if (!description) fail('missing description')

const title = name
  .split('-')
  .map(word => word[0].toUpperCase() + word.slice(1))
  .join(' ')
// __DESCRIPTION__, __AUTHOR__ and __LICENSE__ sit inside JSON strings; __DESCRIPTION_JS__ is a whole JS string literal.
const inJson = text => JSON.stringify(text).slice(1, -1)
// No license given: its whole line goes, since a license is the person's choice and is never made up.
const withLicense = text => (license ? text.replaceAll('__LICENSE__', inJson(license)) : text.replace(/^.*__LICENSE__.*\n/gm, ''))
const fill = text =>
  withLicense(text)
    .replaceAll('__NAME__', name)
    .replaceAll('__TITLE__', title)
    .replaceAll('__DESCRIPTION_JS__', JSON.stringify(description))
    .replaceAll('__DESCRIPTION__', inJson(description))
    .replaceAll('__AUTHOR__', inJson(author))

const target = resolve(modsDir, name)
if (existsSync(target) && readdirSync(target).some(entry => entry !== 'SPEC.md')) {
  fail(`${target} already holds files; refusing to overwrite`)
}

/** source (under templates/) → destination (under the mod) */
const plan = [
  ['scaffold/.claude-plugin/plugin.json.tpl', '.claude-plugin/plugin.json'],
  ['scaffold/hooks/hooks.json.tpl', 'hooks/hooks.json'],
  ['scaffold/tsconfig.json.tpl', 'tsconfig.json'],
  ['scaffold/gitignore.tpl', '.gitignore'],
  [`archetypes/${archetype}/register.tsx.tpl`, 'hooks/register.tsx'],
  [`archetypes/${archetype}/logic.ts.tpl`, `hooks/${name}-logic.ts`],
  [`archetypes/${archetype}/logic.test.ts.tpl`, `tests/${name}-logic.test.ts`],
  [`archetypes/${archetype}/types.d.ts.tpl`, 'types/index.d.ts'],
  [`archetypes/${archetype}/ui.test.tsx.tpl`, 'tests/ui.test.tsx'],
  ['README.template.md', 'README.md'],
]

const written = []
for (const [from, to] of plan) {
  const source = join(templates, from)
  if (!existsSync(source) || !statSync(source).isFile()) continue
  const destination = join(target, to)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, fill(readFileSync(source, 'utf8')))
  written.push(to)
}

console.log(`scaffolded ${name} (${archetype}) in ${target}:`)
for (const file of written) console.log(`  ${file}`)
