#!/usr/bin/env node
/**
 * Hash the reviewed release-notes pair and verify the release-commit approval.
 *
 * The update prompt renders `release-notes/<version>.md` Highlights verbatim
 * from the tag-pinned raw file, so an unreviewed or silently edited notes file
 * must never reach npm. The release commit that gets tagged therefore carries
 * the owner's approval of the exact notes content:
 *
 *   Release-Notes-Review: sha256=<hash>
 *
 * `publish.yml` recomputes the hash from the tagged tree and refuses to publish
 * on a missing, duplicated or mismatched approval. Run this script after the
 * owner reviews the bullets to get the line for the release commit; the hash
 * covers the version plus both notes files, so a later edit (or a notes pair
 * copied from another version) invalidates the approval.
 *
 * Usage:
 *   node scripts/release-notes-approval.mjs                 # bullets + approval line
 *   node scripts/release-notes-approval.mjs --json          # {version, files, sha256}
 *   node scripts/release-notes-approval.mjs --verify        # check HEAD's commit body
 *   node scripts/release-notes-approval.mjs --verify --message "<text>"
 *   node scripts/release-notes-approval.mjs --verify --message-file <path>
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = path => readFileSync(join(root, path))
const pkg = JSON.parse(read('package.json'))
const version = pkg.version
const defaultFile = `release-notes/${version}.md`
const englishFile = `release-notes/${version}.en.md`

/** The trailing marker that one release commit must carry. */
const MARKER = /^Release-Notes-Review:\s*sha256=([0-9a-f]{64})\s*$/gm

/** Read the required notes file and the optional English notes file. */
function notesPair() {
  const english = (() => {
    try {
      return read(englishFile)
    } catch {
      return null
    }
  })()
  return { defaultBytes: read(defaultFile), englishBytes: english }
}

/**
 * Hash the version and the notes pair.
 * @returns {string} 64-character lowercase hex digest.
 */
function approvalHash() {
  const { defaultBytes, englishBytes } = notesPair()
  const hash = createHash('sha256')
  hash.update(`v${version}\n`)
  hash.update(defaultBytes)
  if (englishBytes !== null) {
    hash.update('\n---\n')
    hash.update(englishBytes)
  }
  return hash.digest('hex')
}

/**
 * Extract the bullets a reader sees in the update card.
 * @param {string} markdown - one release-notes file.
 * @returns {string[]} the `## Highlights` bullets, empty when the section is absent.
 */
function highlights(markdown) {
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => /^## Highlights\s*$/.test(line))
  if (start < 0) return []
  const bullets = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^## /.test(lines[index])) break
    if (lines[index].startsWith('- ')) bullets.push(lines[index].slice(2).trim())
  }
  return bullets
}

/** Read the release commit body: explicit text/file wins, otherwise the git HEAD commit. */
function releaseMessage(args) {
  if (args.message !== undefined) return args.message
  if (args.messageFile !== undefined) return readFileSync(args.messageFile, 'utf8')
  return execFileSync('git', ['show', '-s', '--format=%B', 'HEAD'], { cwd: root, encoding: 'utf8' })
}

/** Parse the CLI flags this script understands. */
function parseArgs(argv) {
  const args = { json: false, verify: false, message: undefined, messageFile: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') args.json = true
    else if (arg === '--verify') args.verify = true
    else if (arg === '--message') { args.message = argv[index + 1]; index += 1 }
    else if (arg === '--message-file') { args.messageFile = argv[index + 1]; index += 1 }
    else {
      console.error(`release-notes-approval: unknown argument ${JSON.stringify(arg)}`)
      process.exit(2)
    }
  }
  return args
}

/** Print a failure and exit non-zero so `publish.yml` stops before npm publish. */
function fail(message) {
  console.error(`release-notes-approval: ${message}`)
  process.exit(1)
}

const args = parseArgs(process.argv.slice(2))
const sha256 = approvalHash()

if (args.verify) {
  const message = releaseMessage(args)
  const matches = [...message.matchAll(MARKER)]
  if (matches.length === 0) {
    fail(`the release commit body has no "Release-Notes-Review: sha256=<hash>" line; `
      + `review the Highlights, run \`node scripts/release-notes-approval.mjs\` and put the printed line in the release commit`)
  }
  if (matches.length > 1) fail(`the release commit body has ${matches.length} Release-Notes-Review lines; keep exactly one`)
  const approved = matches[0][1]
  if (approved !== sha256) {
    fail(`the approved hash ${approved} does not match the tagged release notes (${sha256}); `
      + 'the notes changed after approval — review the current files and update the release commit')
  }
  console.log(`release-notes approval ok (v${version} sha256=${sha256})`)
  process.exit(0)
}

if (args.json) {
  console.log(JSON.stringify({
    version,
    files: [defaultFile, ...(notesPair().englishBytes === null ? [] : [englishFile])],
    sha256,
  }, null, 2))
  process.exit(0)
}

const { defaultBytes, englishBytes } = notesPair()
const bullets = highlights(defaultBytes.toString('utf8'))
if (bullets.length === 0) fail(`${defaultFile} has no "## Highlights" bullets to review`)
if (englishBytes !== null && highlights(englishBytes.toString('utf8')).length === 0) {
  fail(`${englishFile} has no "## Highlights" bullets to review`)
}
console.log(`release notes for v${version} (${defaultFile}${englishBytes === null ? '' : `, ${englishFile}`})`)
console.log('')
for (const bullet of bullets) console.log(`- ${bullet}`)
console.log('')
console.log('After the owner approves these bullets, add this line to the release commit body:')
console.log(`Release-Notes-Review: sha256=${sha256}`)
