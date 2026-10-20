#!/usr/bin/env node
/**
 * Install (or remove) the local dsh-intelligent-ui checkout in a DSH profile's patch layer.
 *
 * Use this for development from this repository. A published package uses the
 * DSH bundle flow instead (`dsh plugin --profile web add <package>`); do not mix
 * both installs in one profile because they declare the same loader row id.
 *
 *   node scripts/install.mjs                 # install into the `web` profile
 *   node scripts/install.mjs --dry-run       # show the edit, change nothing
 *   node scripts/install.mjs --uninstall     # remove the managed block
 *   node scripts/install.mjs --profile tui   # another profile
 *
 * The edit is one managed insert block appended to
 * `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:
 *
 *   # >>> dsh-intelligent-ui managed block >>> ...
 *   - insert:
 *       - id: intelligent-ui
 *         name: /absolute/path/to/dsh-intelligenct-ui/lib/index.js
 *   # <<< dsh-intelligent-ui managed block <<<
 *
 * DSH composes the profile at boot, so a restart is required afterwards; this
 * script never restarts the service itself.
 */
import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BEGIN = '# >>> dsh-intelligent-ui managed block >>> do not edit; remove the whole block to uninstall'
const END = '# <<< dsh-intelligent-ui managed block <<<'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const options = { profile: 'web', dryRun: false, uninstall: false, home: process.env.DSH_HOME ?? resolve(homedir(), '.dsh') }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--uninstall') options.uninstall = true
    else if (arg === '--profile') options.profile = argv[++i] ?? options.profile
    else if (arg === '--home') options.home = argv[++i] ?? options.home
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function managedBlock(entry) {
  return [
    BEGIN,
    '- insert:',
    '    - id: intelligent-ui',
    `      name: ${entry}`,
    '',
    END,
    '',
  ].join('\n')
}

/** Locate the position of the managed block (including its trailing blank line). */
function findBlock(text) {
  const begin = text.indexOf(BEGIN)
  if (begin === -1) return undefined
  const end = text.indexOf(END, begin)
  if (end === -1) throw new Error('managed block start found without its end marker; fix cordis.patch.yml by hand')
  const after = text.indexOf('\n', end) + 1
  return { begin, end: after }
}

const options = parseArgs(process.argv.slice(2))
const patchFile = resolve(options.home, 'profiles', options.profile, 'cordis.patch.yml')
const entry = resolve(root, 'lib', 'index.js')

try {
  await access(entry)
} catch {
  console.error(`install: ${entry} is missing — run \`node scripts/build.mjs\` first.`)
  process.exit(1)
}

let text
try {
  text = await readFile(patchFile, 'utf8')
} catch {
  console.error(`install: no profile patch at ${patchFile}. Is profile "${options.profile}" initialized?`)
  process.exit(1)
}

const existing = findBlock(text)
let next
if (options.uninstall) {
  if (existing === undefined) {
    console.log(`install: nothing to remove from ${patchFile}`)
    process.exit(0)
  }
  next = `${text.slice(0, existing.begin)}${text.slice(existing.end)}`.replace(/\n{3,}/g, '\n\n')
} else {
  const block = managedBlock(entry)
  if (existing !== undefined) {
    next = `${text.slice(0, existing.begin)}${block}${text.slice(existing.end)}`
  } else {
    const separator = text.endsWith('\n') ? '\n' : '\n\n'
    next = `${text}${separator}\n${block}`
  }
}

if (next === text) {
  console.log(`install: already up to date — ${patchFile}`)
  process.exit(0)
}

if (options.dryRun) {
  console.log(`install: would write ${patchFile}:\n`)
  console.log(options.uninstall ? '(remove managed block)' : managedBlock(entry))
  process.exit(0)
}

const backupDir = resolve(options.home, 'backups', `dsh-intelligent-ui-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(backupDir, { recursive: true })
await copyFile(patchFile, resolve(backupDir, 'cordis.patch.yml'))
await writeFile(patchFile, next, 'utf8')

console.log(`install: ${options.uninstall ? 'removed from' : 'installed into'} ${patchFile}`)
console.log(`install: backup at ${backupDir}`)
console.log('')
console.log('Restart the process that serves the DSH Web UI for the composed profile to load the plugin:')
console.log('  foreground `dsh web`: Ctrl+C, then run `dsh web` again')
console.log('  launchd/systemd service: restart that unit')
console.log('  DSH Desktop: quit and reopen the app')
console.log('The current page disconnects during the restart; reopen it from the URL the restart prints.')
console.log('')
console.log('Intelligent UI starts OFF: use the UI switch in the composer')
console.log('(or /iui session | /iui global). It then registers render_ui and its ~8.5K-token prompt.')
console.log('/iui off turns it back off; the choice survives restarts.')
