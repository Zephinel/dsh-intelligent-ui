/**
 * Unit tests for the docs-facts guard itself.
 *
 * The guard matches numbers in context so a Host/Client swap or a stale count
 * in a neighbouring sentence fails the gate. These tests drive the pure
 * `verifyFacts(facts, read)` entry point with in-memory doc fixtures, proving
 * both the passing baseline and the failure cases the reviewer asked for.
 *
 * Run: node --test test/packaging/doc-facts-guard.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkDocFacts, runCli, verifyFacts } from '../../scripts/check-doc-facts.mjs'

const FACTS = {
  nodeTotal: 785,
  host: 305,
  client: 457,
  packaging: 23,
  browserSuites: 10,
  artifactEditChecks: 920,
  nestedRendererChecks: 75,
  imageExportChecks: 76,
  buildHostKb: 841,
  clientMb: 4.19,
  clientJsMb: 3.95,
  clientCssKb: 242.8,
  packFiles: 65,
  nonBuildUnpackedBytes: 3818208,
}

/**
 * Build the minimal doc set that satisfies every current-facts check.
 * @param overrides - per-file replacements for a failure-case test.
 * @returns files keyed by repository-relative path.
 */
function fixtureDocs(overrides = {}) {
  const facts = FACTS
  const node = `${facts.nodeTotal}/${facts.nodeTotal}`
  const nonBuild = `${facts.nonBuildUnpackedBytes.toLocaleString('en-US')}`
  const docs = {
    'README.md': `Node **${node}**（Host ${facts.host}、Client ${facts.client}、packaging ${facts.packaging}）；Artifact 区块编辑套件 **${facts.artifactEditChecks}** 条检查，嵌套编辑渲染套件 **${facts.nestedRendererChecks}** 条检查，图片导出 **${facts.imageExportChecks}** 条断言；浏览器 **${facts.browserSuites}/${facts.browserSuites}** 套件通过。`,
    'README.en.md': `**${node}** Node tests (Host ${facts.host}, Client ${facts.client}, packaging ${facts.packaging}); **${facts.artifactEditChecks}** checks in the Artifact block-editing suite, **${facts.nestedRendererChecks}** checks in the nested edit-renderer suite, **${facts.imageExportChecks}** image-export assertions; **${facts.browserSuites}/${facts.browserSuites}** browser suites passed.`,
    'docs/architecture.md': `## 分支验证\nNode **${node}**（Host **${facts.host}**、Client **${facts.client}**、packaging **${facts.packaging}**）；\`artifact-edit\` **${facts.artifactEditChecks} checks**；构建 host **${facts.buildHostKb} kB**、client **${facts.clientMb.toFixed(2)} MB**（js ${facts.clientJsMb.toFixed(2)} / css ${facts.clientCssKb.toFixed(1)} kB）。\n结构操作现在统一走「待执行队列 → 总预览 → Apply」流水线。`,
    'docs/architecture.en.md': `## Branch verification\nNode **${node}** (Host **${facts.host}**, Client **${facts.client}**, packaging **${facts.packaging}**); \`artifact-edit\` **${facts.artifactEditChecks} checks**; build host **${facts.buildHostKb} kB**, client **${facts.clientMb.toFixed(2)} MB** (js ${facts.clientJsMb.toFixed(2)} / css ${facts.clientCssKb.toFixed(1)} kB).`,
    'CHANGELOG.md': `## [Unreleased]\nNode **${node}**; Host **${facts.host}**, Client **${facts.client}**, packaging ${facts.packaging}; pack ${facts.packFiles} files; non-build ${nonBuild} bytes.`,
    'docs/verification.md': `# History\n\n## Old record\nNode 1/1\n\n## Newest record\nNode **${node}** = Host **${facts.host}** + Client **${facts.client}** + packaging **${facts.packaging}**；- N1：Host **${facts.host}**、Client **${facts.client}**、packaging ${facts.packaging}；\`artifact-edit\` **${facts.artifactEditChecks} checks**；构建 host ${facts.buildHostKb} kB、client ${facts.clientJsMb.toFixed(2)} MB（js ${facts.clientJsMb.toFixed(2)} / css ${facts.clientCssKb.toFixed(1)}）；浏览器 ${facts.browserSuites}/${facts.browserSuites}；pack ${facts.packFiles} files; non-build ${nonBuild} bytes。`,
    'docs/verification.en.md': `# History\n\n## Old record\nNode 1/1\n\n## Newest record\nNode **${node}** = Host **${facts.host}** + Client **${facts.client}** + packaging **${facts.packaging}**; - N1: Host **${facts.host}**, Client **${facts.client}**, packaging ${facts.packaging}; \`artifact-edit\` **${facts.artifactEditChecks} checks**; build host ${facts.buildHostKb} kB, client ${facts.clientJsMb.toFixed(2)} MB (js ${facts.clientJsMb.toFixed(2)} / css ${facts.clientCssKb.toFixed(1)}); browser ${facts.browserSuites}/${facts.browserSuites}; pack ${facts.packFiles} files; non-build ${nonBuild} bytes.`,
    'docs/limitations.md': '结构操作先进入本轮待执行队列，底部「应用」先显示总预览；选择其他修订即恢复可编辑。',
    'docs/limitations.en.md': 'Structural operations first enter the pending queue; **Apply** opens the total preview; selecting another revision restores editing.',
    'docs/usage.md': '结构操作先进入本轮待执行队列；点「应用」打开总预览；选择其他修订即恢复可编辑。',
    'docs/usage.en.md': 'Structural operations first enter the pending queue; **Apply** opens the total preview; selecting another revision restores editing.',
    'test/browser/README.md': `artifact-edit ${facts.artifactEditChecks} checks; nested-edit-renderer ${facts.nestedRendererChecks} checks; export-image ${facts.imageExportChecks} assertions.`,
    ...overrides,
  }
  return docs
}

/** Run the guard against the fixture (unknown files read as empty). */
function failuresFor(overrides) {
  const docs = fixtureDocs(overrides)
  return verifyFacts(FACTS, file => docs[file] ?? '')
}

test('the CLI-level checker rejects an inconsistent current-facts snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'doc-facts-cli-'))
  try {
    for (const [file, content] of Object.entries(fixtureDocs())) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), content)
    }
    const inconsistent = { ...FACTS, client: FACTS.client - 1 }
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs/current-facts.json'), JSON.stringify(inconsistent))
    const failures = checkDocFacts(root)
    assert.equal(failures.some(failure => failure.startsWith('docs/current-facts.json')), true, 'the checker must not filter out a bad facts snapshot')
    const messages = []
    assert.equal(runCli(root, { log: () => {}, error: message => messages.push(String(message)) }), 1, 'the CLI entry point must exit 1')
    assert.equal(messages.some(message => message.includes('docs/current-facts.json')), true, 'the CLI must report the bad facts snapshot')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the current fixture passes every check', () => {
  assert.deepEqual(failuresFor({}), [])
})

test('a Host/Client swap in the README fails instead of matching bare numbers', () => {
  const readme = fixtureDocs()['README.md'].replace(`Host ${FACTS.host}、Client ${FACTS.client}`, `Host ${FACTS.client}、Client ${FACTS.host}`)
  const failures = failuresFor({ 'README.md': readme })
  assert.equal(failures.some(failure => failure.includes('Host/Client/packaging split')), true, 'the context check must name the split')
})

test('a Host/Client swap in the newest verification record fails', () => {
  const en = fixtureDocs()['docs/verification.en.md'].replace(`Host **${FACTS.host}** + Client **${FACTS.client}**`, `Host **${FACTS.client}** + Client **${FACTS.host}**`)
  const failures = failuresFor({ 'docs/verification.en.md': en })
  assert.equal(failures.some(failure => failure.includes('latest record')), true)
  const bullet = fixtureDocs()['docs/verification.en.md'].replace(`Host **${FACTS.host}**, Client **${FACTS.client}**`, `Host **${FACTS.client}**, Client **${FACTS.host}**`)
  assert.equal(failuresFor({ 'docs/verification.en.md': bullet }).some(failure => failure.includes('swaps Host/Client')), true)
  const changelog = fixtureDocs()['CHANGELOG.md'].replace(`Host **${FACTS.host}**, Client **${FACTS.client}**`, `Host **${FACTS.client}**, Client **${FACTS.host}**`)
  assert.equal(failuresFor({ 'CHANGELOG.md': changelog }).some(failure => failure.includes('swaps Host/Client')), true)
})

test('bare numbers without their context do not satisfy the split', () => {
  const failures = failuresFor({ 'README.en.md': `Node 785/785 ${FACTS.host} ${FACTS.client} ${FACTS.packaging} 920 75 76 10/10` })
  assert.equal(failures.some(failure => failure.includes('Host/Client/packaging split')), true)
})

test('a stale limitation sentence fails with a stale-wording message', () => {
  const failures = failuresFor({ 'docs/limitations.md': '结构操作会直接关闭当前草稿（`markSubmitted`）。' })
  assert.equal(failures.some(failure => failure.includes('stale wording')), true)
})

test('a stale usage send sentence fails', () => {
  const failures = failuresFor({ 'docs/usage.en.md': 'The pending requests only produce a new revision when you send normally. total preview pending queue' })
  assert.equal(failures.some(failure => failure.includes('only produce a new revision when you send normally')), true)
})

test('a wrong image-export assertion count fails in the README', () => {
  const readme = fixtureDocs()['README.en.md'].replace(`**${FACTS.imageExportChecks}** image-export`, '**66** image-export')
  const failures = failuresFor({ 'README.en.md': readme })
  assert.equal(failures.some(failure => failure.includes('image export 76 assertions')), true)
})

test('a stale browser README count fails', () => {
  const failures = failuresFor({ 'test/browser/README.md': 'artifact-edit 566 checks; nested-edit-renderer 75 checks; export-image 76 assertions.' })
  assert.equal(failures.some(failure => failure.includes('566 checks')), true)
  assert.equal(failures.some(failure => failure.includes('920 checks')), true)
})

test('a wrong node total in the architecture pair fails', () => {
  const architecture = fixtureDocs()['docs/architecture.md'].replace('785/785', '779/779')
  const failures = failuresFor({ 'docs/architecture.md': architecture })
  assert.equal(failures.some(failure => failure.includes('Node total 785/785')), true)
})

test('an inconsistent facts snapshot is rejected before any doc is read', () => {
  const failures = verifyFacts({ ...FACTS, client: 999 }, () => '')
  assert.equal(failures.length, 1)
  assert.match(failures[0], /docs\/current-facts\.json/)
})
