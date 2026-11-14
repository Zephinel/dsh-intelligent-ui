#!/usr/bin/env node
/**
 * Check the current-state facts quoted by the README, architecture docs,
 * limitations/usage guides, the browser-suite README, the verification record
 * and CHANGELOG against docs/current-facts.json.
 *
 * Historical verification records intentionally keep their own numbers; this
 * checker only looks at the current README/architecture lines, the last
 * (newest) verification section and the CHANGELOG's current gate values.
 *
 * Numbers are matched **in context** (for example `Host 305` and `Client 451`,
 * never a bare `305`/`451` anywhere in the file), so a Host/Client swap or a
 * stale count in a neighbouring sentence fails instead of silently matching.
 * Negative guards pin wording that used to describe the pre-queue pipeline and
 * the browser README's stale check count.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Fragment that must NOT appear in a document (stale wording guard). */
function reject(failures, read, file, fragment) {
  if (read(file).includes(fragment)) failures.push(`${file}: stale wording ${JSON.stringify(fragment)}`)
}

/**
 * Verify already-read document texts against one facts snapshot.
 * @param facts - parsed docs/current-facts.json.
 * @param read - doc path → UTF-8 text reader.
 * @returns every mismatch; empty when the docs are current.
 */
export function verifyFacts(facts, read) {
  const failures = []
  const expect = (file, fragment) => {
    if (!read(file).includes(fragment)) failures.push(`${file}: missing ${JSON.stringify(fragment)}`)
  }
  const expectMatch = (file, pattern, label) => {
    if (!pattern.test(read(file))) failures.push(`${file}: missing ${label}`)
  }

  if (facts.host + facts.client + facts.packaging !== facts.nodeTotal) {
    return [`docs/current-facts.json: host ${facts.host} + client ${facts.client} + packaging ${facts.packaging} != nodeTotal ${facts.nodeTotal}`]
  }
  const node = `${facts.nodeTotal}/${facts.nodeTotal}`
  // No document may pair the Host and Client counts the wrong way round. The
  // contextual split regexes below catch the canonical sentences; this scan
  // also covers bullets such as the N1 record and the CHANGELOG summary.
  const assertNoSwappedAuthority = (file, text, label) => {
    const swapped = [
      new RegExp(`Host\\s*\\*{0,2}${facts.client}\\*{0,2}\\s*[、,+/|\\s]\\s*Client`),
      new RegExp(`Client\\s*\\*{0,2}${facts.host}\\*{0,2}\\s*[、,+/|\\s]\\s*Host`),
    ]
    if (swapped.some(pattern => pattern.test(text))) failures.push(`${file}: ${label} swaps Host/Client`)
  }

  // README pair: counts and their Host/Client/packaging context.
  for (const file of ['README.md', 'README.en.md']) {
    expectMatch(file, new RegExp(`\\*\\*${node}\\*\\*`), `Node total ${node}`)
    if (file === 'README.md') {
      expectMatch(file, new RegExp(`Host ${facts.host}、Client ${facts.client}、packaging ${facts.packaging}`), 'Host/Client/packaging split')
      expectMatch(file, new RegExp(`Artifact 区块编辑套件 \\*\\*${facts.artifactEditChecks}\\*\\* 条检查`), `artifact-edit ${facts.artifactEditChecks} checks`)
      expectMatch(file, new RegExp(`嵌套编辑渲染套件 \\*\\*${facts.nestedRendererChecks}\\*\\* 条检查`), `nested renderer ${facts.nestedRendererChecks} checks`)
      expectMatch(file, new RegExp(`图片导出 \\*\\*${facts.imageExportChecks}\\*\\* 条断言`), `image export ${facts.imageExportChecks} assertions`)
      expectMatch(file, new RegExp(`浏览器 \\*\\*${facts.browserSuites}/${facts.browserSuites}\\*\\* 套件通过`), `${facts.browserSuites}/${facts.browserSuites} browser suites`)
    } else {
      expectMatch(file, new RegExp(`Host ${facts.host}, Client ${facts.client}, packaging ${facts.packaging}`), 'Host/Client/packaging split')
      expectMatch(file, new RegExp(`\\*\\*${facts.artifactEditChecks}\\*\\* checks in the Artifact block-editing suite`), `artifact-edit ${facts.artifactEditChecks} checks`)
      expectMatch(file, new RegExp(`\\*\\*${facts.nestedRendererChecks}\\*\\* checks in the nested edit-renderer suite`), `nested renderer ${facts.nestedRendererChecks} checks`)
      expectMatch(file, new RegExp(`\\*\\*${facts.imageExportChecks}\\*\\* image-export assertions`), `image export ${facts.imageExportChecks} assertions`)
      expectMatch(file, new RegExp(`\\*\\*${facts.browserSuites}/${facts.browserSuites}\\*\\* browser suites`), `${facts.browserSuites}/${facts.browserSuites} browser suites`)
    }
  }

  // Architecture pair: newest branch verification line carries the live values.
  for (const file of ['docs/architecture.md', 'docs/architecture.en.md']) {
    expectMatch(file, new RegExp(`\\*\\*${node}\\*\\*`), `Node total ${node}`)
    if (file === 'docs/architecture.md') {
      expectMatch(file, new RegExp(`Host \\*\\*${facts.host}\\*\\*、Client \\*\\*${facts.client}\\*\\*`), 'Host/Client split')
      expectMatch(file, new RegExp(`结构操作现在统一走|artifact-edit\\*\\* 流水线`), 'current structure-pipeline section')
    } else {
      expectMatch(file, new RegExp(`Host \\*\\*${facts.host}\\*\\*`, 'i'), 'Host count')
      expectMatch(file, new RegExp(`Client \\*\\*${facts.client}\\*\\*`), 'Client count')
    }
    expectMatch(file, new RegExp(`artifact-edit\`? \\*\\*${facts.artifactEditChecks} checks\\*\\*`), `artifact-edit ${facts.artifactEditChecks} checks`)
    expectMatch(file, new RegExp(`host \\*\\*${facts.buildHostKb} kB\\*\\*`), `host build ${facts.buildHostKb} kB`)
    expectMatch(file, new RegExp(`client \\*\\*${facts.clientMb.toFixed(2)} MB\\*\\*`), `client build ${facts.clientMb.toFixed(2)} MB`)
    expectMatch(file, new RegExp(`css ${facts.clientCssKb.toFixed(1)} kB`), `client CSS ${facts.clientCssKb.toFixed(1)} kB`)
  }

  // CHANGELOG: current gate values and packaging sizes.
  for (const file of ['CHANGELOG.md']) {
    expect(file, node)
    expect(file, `${facts.packFiles} files`)
    expect(file, facts.nonBuildUnpackedBytes.toLocaleString('en-US'))
    assertNoSwappedAuthority(file, read(file), 'Host/Client split')
  }

  // Verification record: only the newest appended section must quote the gate.
  for (const file of ['docs/verification.md', 'docs/verification.en.md']) {
    const text = read(file)
    const headings = [...text.matchAll(/^## .*$/gm)]
    const heading = headings.length === 0 ? 0 : headings[headings.length - 1].index
    const latest = text.slice(heading)
    const required = [
      node,
      `${facts.artifactEditChecks} checks`,
      `${facts.buildHostKb} kB`,
      `${facts.clientCssKb.toFixed(1)}`,
      `js ${facts.clientJsMb.toFixed(2)}`,
      `${facts.browserSuites}/${facts.browserSuites}`,
      `${facts.packFiles}`,
      facts.nonBuildUnpackedBytes.toLocaleString('en-US'),
    ]
    for (const fragment of required) {
      if (!latest.includes(fragment)) failures.push(`${file} (latest record): missing ${JSON.stringify(fragment)}`)
    }
    const split = new RegExp(`Host \\*\\*${facts.host}\\*\\* \\+ Client \\*\\*${facts.client}\\*\\* \\+ packaging \\*\\*${facts.packaging}\\*\\*`)
    if (!split.test(latest)) failures.push(`${file} (latest record): missing Host/Client/packaging split in context`)
    assertNoSwappedAuthority(file, latest, 'latest record')
  }

  // Current-pipeline wording: limitations and usage must describe the queue →
  // save → total preview → Apply behaviour, never the removed immediate-apply
  // markSubmitted flow.
  for (const file of ['docs/limitations.md', 'docs/limitations.en.md']) {
    reject(failures, read, file, '结构操作会直接关闭当前草稿')
    reject(failures, read, file, 'Structural operations directly close the current draft')
  }
  for (const file of ['docs/limitations.md', 'docs/limitations.en.md', 'docs/usage.md', 'docs/usage.en.md']) {
    const current = file.endsWith('.en.md')
    expect(file, current ? 'pending queue' : '待执行队列')
    expect(file, current ? 'total preview' : '总预览')
    expect(file, current ? 'selecting another revision restores editing' : '选择其他修订即恢复可编辑')
  }
  reject(failures, read, 'docs/usage.md', '正常发送后才生成新修订')
  reject(failures, read, 'docs/usage.en.md', 'only produce a new revision when you send normally')

  // Browser-suite README: scenario counts and the no-bridge-scope claim.
  expectMatch('test/browser/README.md', new RegExp(`${facts.artifactEditChecks} checks`), `artifact-edit ${facts.artifactEditChecks} checks`)
  expectMatch('test/browser/README.md', new RegExp(`${facts.nestedRendererChecks} checks`), `nested renderer ${facts.nestedRendererChecks} checks`)
  expectMatch('test/browser/README.md', new RegExp(`${facts.imageExportChecks} assertions`), `image export ${facts.imageExportChecks} assertions`)
  reject(failures, read, 'test/browser/README.md', '566 checks')
  reject(failures, read, 'test/browser/README.md', '547 checks')

  return failures
}

/**
 * Read the real docs under one checkout root and verify them.
 * @param root - repository root containing docs/current-facts.json.
 * @returns every mismatch; empty when the docs are current.
 */
export function checkDocFacts(root) {
  const read = file => readFileSync(resolve(root, file), 'utf8')
  const facts = JSON.parse(read('docs/current-facts.json'))
  return verifyFacts(facts, read)
}

/**
 * Run the checker the way the CLI does (including the exit code and summary).
 * @param root - repository root containing docs/current-facts.json.
 * @param io - console-like sink for the CLI output.
 * @returns the process exit code (0 when the docs are current).
 */
export function runCli(root, io = console) {
  const failures = checkDocFacts(root)
  const facts = JSON.parse(readFileSync(resolve(root, 'docs/current-facts.json'), 'utf8'))
  if (failures.length > 0) {
    io.error(`doc-facts: ${failures.length} mismatch(es); update docs/current-facts.json only from a real gate run:`)
    for (const failure of failures) io.error(`  - ${failure}`)
    return 1
  }
  const node = `${facts.nodeTotal}/${facts.nodeTotal}`
  io.log(`doc-facts: ok (Node ${node}; artifact-edit ${facts.artifactEditChecks}; image-export ${facts.imageExportChecks}; pack ${facts.packFiles} files; non-build ${facts.nonBuildUnpackedBytes} bytes)`)
  return 0
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) process.exit(runCli(resolve(new URL('..', import.meta.url).pathname)))
