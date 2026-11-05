/**
 * M4-3 Host tests: authoritative program registry + deterministic structure route.
 *
 *   node scripts/build.mjs host
 *   node --test test/host/artifact-structure.test.mjs
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { ARTIFACT_STRUCTURE_ROUTE_PATH, isArtifactStructureResult } from '../../src/shared/artifact-structure.ts'
import { NESTED_PROGRAM, NESTED_TITLE, SCOPED_PROGRAM } from '../browser/fixtures/nested-artifact.ts'
import { buildArtifactTree } from '../../src/shared/program-cst.ts'
import { buildEditRequestText } from '../../src/shared/artifact-edit.ts'
import {
  MAX_PROGRAM_RECORDS,
  createArtifactProgramStore,
  createArtifactStructureOperationStore,
} from '../../src/host/artifact-structure.ts'
import { createArtifactRevisionStore } from '../../src/host/artifact-revisions.ts'
import { THEME } from './style-fixtures.mjs'

const plugin = await import('../../lib/index.js')
const originalHome = process.env.DSH_HOME
const homes = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
})

function tempHome(prefix) {
  const home = mkdtempSync(join(tmpdir(), prefix))
  homes.push(home)
  process.env.DSH_HOME = home
  return home
}

/** Authoritative tree for the nested fixture under the structure container whitelist. */
const NESTED_TREE = buildArtifactTree(NESTED_PROGRAM, { containerTypes: ['Col', 'Row', 'Card'] })
const SCOPED_TREE = buildArtifactTree(SCOPED_PROGRAM, { containerTypes: ['Col', 'Row', 'Card'] })

const node = (tree, nodeId) => {
  const found = tree.nodes.get(nodeId)
  assert.ok(found !== undefined, `base tree node ${nodeId}`)
  return found
}

/** One valid result-owned temporary style snapshot. */
const TEMPORARY_STYLE = { schemaVersion: 1, baseLayout: 'card', directives: 'Keep compact groups and clear hierarchy.', theme: THEME }

let operationCounter = 0
const operationId = (label) => {
  operationCounter += 1
  return `op_${label}_${String(operationCounter).padStart(4, '0')}`
}

/** Full plugin harness with captured HTTP routes and tools. */
function mount(options = {}) {
  const home = tempHome('iui-artifact-structure-')
  const registered = { tools: [], sessionEvents: [] }
  const routes = []
  const disposed = []
  const scope = { rejection: options.rejection }
  plugin.apply({
    tools: { register(definition) { registered.tools.push(definition) } },
    systemPrompt: { section() {} },
    on(event, handler) { if (event === 'session/event') registered.sessionEvents.push(handler) },
    logger: { warn() {} },
    inject(dependencies, callback) {
      if (!dependencies.includes('webServer')) return
      callback({
        webServer: {
          register(route) {
            routes.push(route)
            return () => { disposed.push(route.path) }
          },
        },
        connection: { requestRejection() { return scope.rejection } },
        effect(fn) {
          const disposer = fn()
          return disposer
        },
      })
    },
  }, { globalEnabled: { get: () => true }, answerStyle: { get: () => 'auto' } })
  const agent = { session: { id: 's1' } }
  let seq = 0
  const send = text => {
    for (const handler of registered.sessionEvents) handler({ id: 's1' }, { type: 'user/message', data: { id: 'structure-message', source: { kind: 'user' }, content: [{ type: 'text', text }] }, seq: ++seq })
  }
  const structureRoute = () => {
    const route = routes.find(candidate => candidate.path === ARTIFACT_STRUCTURE_ROUTE_PATH)
    assert.ok(route !== undefined, 'structure route is registered')
    return route
  }
  return {
    ...registered,
    home,
    agent,
    send,
    routes,
    disposed,
    scope,
    structureRoute,
    tool: registered.tools.find(definition => definition.name === 'render_ui'),
    blockTool: registered.tools.find(definition => definition.name === 'edit_ui_blocks'),
    file: join(home, 'dsh-intelligent-ui-artifacts.json'),
    programFile: join(home, 'dsh-intelligent-ui-programs.json'),
  }
}

/** Invoke the structure POST handler and resolve with the completed response. */
async function postStructure(route, { body, raw, headers = { 'content-type': 'application/json' }, method = 'POST' } = {}) {
  const payload = raw === undefined ? JSON.stringify(body) : raw
  const req = Readable.from([payload])
  Object.assign(req, { method, url: ARTIFACT_STRUCTURE_ROUTE_PATH, headers })
  const result = { status: 0, headers: {}, body: undefined }
  result.done = new Promise(resolve => {
    const res = new EventEmitter()
    Object.assign(res, {
      writeHead(status, responseHeaders = {}) {
        result.status = status
        result.headers = responseHeaders
      },
      end(chunk) {
        if (chunk !== undefined) {
          try { result.body = JSON.parse(String(chunk)) } catch { result.body = String(chunk) }
        }
        resolve(result)
      },
    })
    route.handler(req, res)
  })
  return result.done
}

/** Body helper bound to the seeded nested fixture artifact. */
function structureBody(overrides = {}) {
  return {
    schemaVersion: 1,
    artifactId: 'call-original',
    baseRevisionId: 'call-original',
    operationId: operationId('structure'),
    operations: [],
    style: 'card',
    ...overrides,
  }
}

/** Render the fixture as the first authoritative revision (artifactId === callId). */
async function seed(m, program = NESTED_PROGRAM, callId = 'call-original') {
  const value = await m.tool.execute({ program, style: 'card' }, { agent: m.agent, callId })
  assert.equal(value.artifactId, undefined, 'ordinary render has no lineage')
  return value
}

const deleteOp = (tree, nodeId) => ({ op: 'delete', nodeId, sourceDigest: node(tree, nodeId).digest })
const duplicateOp = (tree, nodeId, toIndex) => ({ op: 'duplicate', nodeId, sourceDigest: node(tree, nodeId).digest, toIndex })
const moveOp = (tree, nodeId, toIndex) => ({ op: 'move', nodeId, sourceDigest: node(tree, nodeId).digest, toIndex })
const crossMoveOp = (tree, nodeId, toParentNodeId, toIndex) => ({
  op: 'move', nodeId, sourceDigest: node(tree, nodeId).digest, toParentNodeId, toIndex,
})

test('the authoritative program registry persists, reloads and prunes by LRU bounds', () => {
  tempHome('iui-artifact-programs-')
  const clock = { value: 100 }
  const store = createArtifactProgramStore({}, { maxRecords: 2, maxBytes: 10_000, now: () => clock.value })
  store.record({ artifactId: 'art-1', revisionId: 'rev-1', program: 'root = Col([Text("a")])' })
  clock.value = 200
  store.record({ artifactId: 'art-1', revisionId: 'rev-2', program: 'root = Col([Text("b")])' })
  assert.equal(store.size(), 2)
  clock.value = 300
  assert.equal(store.lookup('art-1', 'rev-1'), 'root = Col([Text("a")])', 'lookup refreshes LRU order')
  clock.value = 400
  store.record({ artifactId: 'art-1', revisionId: 'rev-3', program: 'root = Col([Text("c")])' })
  assert.equal(store.size(), 2)
  assert.equal(store.lookup('art-1', 'rev-2'), undefined, 'the least recently used program is evicted')
  assert.equal(store.lookup('art-1', 'rev-1'), 'root = Col([Text("a")])')
  // Another store instance on the same file sees every retained revision (restart recovery).
  const reopened = createArtifactProgramStore()
  assert.equal(reopened.size(), 2)
  assert.equal(reopened.lookup('art-1', 'rev-3'), 'root = Col([Text("c")])')
  assert.throws(() => reopened.record({ artifactId: 'art-1', revisionId: 'rev-1', program: 'root = Col([Title("other")])' }), /immutable/)
  assert.ok(MAX_PROGRAM_RECORDS >= 200)
})

test('render_ui and edit_ui_blocks successful results feed the authoritative registry', async () => {
  const m = mount()
  await seed(m)
  const programs = createArtifactProgramStore()
  assert.equal(programs.lookup('call-original', 'call-original'), NESTED_PROGRAM)
  const nestedEdit = {
    blockId: 'b1.1',
    nodePath: node(NESTED_TREE, 'n5').nodePath,
    nodeId: 'n5',
    sourceDigest: node(NESTED_TREE, 'n5').digest,
    parentBlockId: 'b1',
    depth: node(NESTED_TREE, 'n5').depth,
    originalIndex: 1,
    selectionOrder: 1,
    componentType: node(NESTED_TREE, 'n5').componentType,
    instruction: '改一下这一块。',
  }
  m.send(buildEditRequestText({
    schemaVersion: 1, artifactId: 'call-original', baseRevisionId: 'call-original', baseRevision: 1,
    requestId: 'req_00000001', title: NESTED_TITLE, style: 'card', edits: [nestedEdit],
    targetOrder: ['b1', 'b2'], program: NESTED_PROGRAM,
  }))
  const value = await m.blockTool.execute({ program: 'root = Col([Text("A edited", "sm")])', requestId: 'req_00000001' }, { agent: m.agent, callId: 'call-nested-edit' })
  const reopened = createArtifactProgramStore()
  assert.equal(reopened.lookup('call-original', 'call-nested-edit'), value.program)
  assert.equal(createArtifactRevisionStore().latestFor('call-original').revisionId, 'call-nested-edit')
})

test('delete removes a nested leaf while the rest of the page stays byte-identical', async () => {
  const m = mount()
  await seed(m)
  const response = await postStructure(m.structureRoute(), { body: structureBody({ operations: [deleteOp(NESTED_TREE, 'n5')] }) })
  assert.equal(response.status, 201)
  assert.equal(response.body?.ok, true)
  assert.equal(isArtifactStructureResult(response.body?.result), true)
  const result = response.body.result
  assert.equal(result.artifactId, 'call-original')
  assert.equal(result.baseRevisionId, 'call-original')
  assert.equal(result.revision, 2)
  assert.match(result.program.split('\n')[1], /Col\(\[Text\("B", "sm"\), Text\(sharedText, "sm"\)\]\)/)
  assert.equal(result.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2], 'the second card statement is byte-identical')
  assert.equal(result.program.split('\n')[3], NESTED_PROGRAM.split('\n')[3], 'the helper statement is byte-identical')
  assert.equal(createArtifactRevisionStore().latestFor('call-original').revisionId, result.revisionId)
  assert.equal(createArtifactProgramStore().lookup('call-original', result.revisionId), result.program)
  assert.deepEqual(createArtifactRevisionStore().latestFor('call-original').editedBlockIds, ['b1'])
  assert.match(response.headers['content-type'], /application\/json/)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(JSON.parse(readFileSync(m.file, 'utf8')).revisions.length, 1)
})

test('delete removes a whole nested container without touching its siblings', async () => {
  const m = mount()
  await seed(m)
  const response = await postStructure(m.structureRoute(), { body: structureBody({ operations: [deleteOp(NESTED_TREE, 'n4')] }) })
  assert.equal(response.status, 201)
  assert.match(response.body.result.program.split('\n')[1], /Card\(\[Title\("外层卡片", "sm"\)\]\)/)
  assert.equal(response.body.result.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2])
})

test('duplicate clones one inline block at the requested editable insertion position', async () => {
  const m = mount()
  await seed(m)
  const response = await postStructure(m.structureRoute(), { body: structureBody({ operations: [duplicateOp(NESTED_TREE, 'n5', 1)] }) })
  assert.equal(response.status, 201)
  const result = response.body.result
  assert.match(result.program.split('\n')[1], /Col\(\[Text\("A", "sm"\), Text\("A", "sm"\), Text\("B", "sm"\), Text\(sharedText, "sm"\)\]\)/)
  const tree = buildArtifactTree(result.program, { containerTypes: ['Col', 'Row', 'Card'] })
  const copies = [...tree.nodes.values()].filter(entry => entry.componentType === 'Text' && entry.source === 'Text("A", "sm")')
  assert.equal(copies.length, 2, 'the copy is an independent node')
  assert.notEqual(copies[0].nodeId, copies[1].nodeId)
  assert.equal(result.revision, 2)
})

test('move reorders one block within its parent slot and preserves all sources', async () => {
  const m = mount()
  await seed(m)
  const response = await postStructure(m.structureRoute(), { body: structureBody({ operations: [moveOp(NESTED_TREE, 'n5', 2)] }) })
  assert.equal(response.status, 201)
  const result = response.body.result
  assert.match(result.program.split('\n')[1], /Col\(\[Text\("B", "sm"\), Text\(sharedText, "sm"\), Text\("A", "sm"\)\]\)/)
  assert.equal(result.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2])
  assert.equal(result.revision, 2)
})

test('invalid structure operations are rejected atomically and record nothing', async () => {
  const cases = [
    [{ ...deleteOp(NESTED_TREE, 'n5'), sourceDigest: 'deadbeefdeadbeef' }, /changed since it was selected/, 400],
    [{ op: 'delete', nodeId: 'n99', sourceDigest: 'deadbeefdeadbeef' }, /unknown block node/, 400],
    [deleteOp(NESTED_TREE, 'n3'), /page chrome/, 400],
    [deleteOp(NESTED_TREE, 'n1'), /root layout cannot be deleted, duplicated or moved/, 400],
    [{ ...deleteOp(NESTED_TREE, 'n5'), toParentId: 'n8' }, /unknown_field/, 400],
    [duplicateOp(NESTED_TREE, 'n5', 99), /duplicate toIndex/, 400],
    [{ op: 'delete', nodeId: 'n2', sourceDigest: node(NESTED_TREE, 'n2').digest }, 'ancestor'],
  ]
  const m = mount()
  await seed(m)
  for (const [operation, expected, status] of cases) {
    const operations = Array.isArray(operation) ? operation : expected === 'ancestor'
      ? [operation, deleteOp(NESTED_TREE, 'n5')]
      : [operation]
    const response = await postStructure(m.structureRoute(), {
      body: structureBody({ operationId: operationId('invalid'), operations }),
    })
    assert.equal(response.status, status ?? 400, JSON.stringify(response.body))
    assert.match(response.body.error.message, expected === 'ancestor' ? /ancestor or descendant/ : expected)
    assert.equal(existsSync(m.file), false, 'a rejected batch records no revision')
  }
})

test('a multi-operation batch applies atomically in request order', async () => {
  const m = mount()
  await seed(m)
  const response = await postStructure(m.structureRoute(), {
    body: structureBody({
      operationId: operationId('batch'),
      operations: [deleteOp(NESTED_TREE, 'n5'), deleteOp(NESTED_TREE, 'n6'), moveOp(NESTED_TREE, 'n7', 0)],
    }),
  })
  assert.equal(response.status, 201)
  const result = response.body.result
  assert.match(result.program.split('\n')[1], /Col\(\[Text\(sharedText, "sm"\)\]\)/)
  const latest = createArtifactRevisionStore().latestFor('call-original')
  assert.deepEqual(latest.editedBlockIds, ['b1'])
  assert.equal(JSON.parse(readFileSync(m.file, 'utf8')).revisions.length, 1)
})

test('scoped @Each nodes are not structurally editable', async () => {
  const m = mount()
  await seed(m, SCOPED_PROGRAM, 'call-scoped')
  const template = [...SCOPED_TREE.nodes.values()].find(entry => entry.scoped)
  assert.ok(template !== undefined)
  const response = await postStructure(m.structureRoute(), {
    body: structureBody({
      artifactId: 'call-scoped', baseRevisionId: 'call-scoped',
      operationId: operationId('scoped'), operations: [{ op: 'delete', nodeId: template.nodeId, sourceDigest: template.digest }],
    }),
  })
  assert.equal(response.status, 400)
  assert.match(response.body.error.message, /@Each template/)
})

test('a cross-container move route moves a nested block into another root card', async () => {
  const m = mount()
  await seed(m)
  const response = await postStructure(m.structureRoute(), {
    body: structureBody({ operationId: operationId('crossmove'), operations: [crossMoveOp(NESTED_TREE, 'n5', 'n8', 0)] }),
  })
  assert.equal(response.status, 201, JSON.stringify(response.body))
  const result = response.body.result
  assert.match(result.program.split('\n')[1], /Card\(\[Title\("外层卡片", "sm"\), Col\(\[Text\("B", "sm"\), Text\(sharedText, "sm"\)\]\)\]\)/)
  assert.match(result.program.split('\n')[2], /secondCard = Card\(\[Title\("第二张卡片", "sm"\), Text\("A", "sm"\), Row\(\[Text\("C", "sm"\), Text\("D", "sm"\)\]\)\], "soft"\)/)
  assert.equal(result.program.split('\n')[0], NESTED_PROGRAM.split('\n')[0])
  assert.equal(result.program.split('\n')[3], NESTED_PROGRAM.split('\n')[3])
  const latest = createArtifactRevisionStore().latestFor('call-original')
  assert.deepEqual([...(latest.editedBlockIds ?? [])].sort(), ['b1', 'b2'])
  assert.equal(createArtifactProgramStore().lookup('call-original', result.revisionId), result.program)
})

test('a cross-container move route can target a nested Row slot', async () => {
  const m = mount()
  await seed(m)
  const response = await postStructure(m.structureRoute(), {
    body: structureBody({ operationId: operationId('crossmove-row'), operations: [crossMoveOp(NESTED_TREE, 'n5', 'n10', 2)] }),
  })
  assert.equal(response.status, 201, JSON.stringify(response.body))
  assert.match(response.body.result.program.split('\n')[1], /Col\(\[Text\("B", "sm"\), Text\(sharedText, "sm"\)\]\)/)
  assert.match(response.body.result.program.split('\n')[2], /Row\(\[Text\("C", "sm"\), Text\("D", "sm"\), Text\("A", "sm"\)\]\)/)
})

test('a cross-container move can move between two nested Col containers', async () => {
  const program = 'root = Col([a, b])\na = Card([Col([Text("x")])])\nb = Card([Col([Text("y")])])'
  const tree = buildArtifactTree(program, { containerTypes: ['Col', 'Row', 'Box', 'Grid', 'Card', 'Section', 'Carousel'] })
  const x = [...tree.nodes.values()].find(entry => entry.source === 'Text("x")')
  const cols = [...tree.nodes.values()].filter(entry => entry.componentType === 'Col' && !entry.children.some(id => id === x.nodeId))
  const targetCol = cols[0]
  assert.ok(targetCol !== undefined)
  const m = mount()
  await seed(m, program, 'call-cross')
  const response = await postStructure(m.structureRoute(), {
    body: structureBody({
      artifactId: 'call-cross', baseRevisionId: 'call-cross',
      operationId: operationId('crossmove-col'),
      operations: [crossMoveOp(tree, x.nodeId, targetCol.nodeId, 1)],
    }),
  })
  assert.equal(response.status, 201, JSON.stringify(response.body))
  assert.equal(response.body.result.program.split('\n')[1], 'a = Card([Col([])])')
  assert.equal(response.body.result.program.split('\n')[2], 'b = Card([Col([Text("y"), Text("x")])])')
})

test('cross-container move validation rejects unsafe targets and invalid shapes', async () => {
  const m = mount()
  await seed(m)
  const cases = [
    // Target root is the source parent's ancestor: nested slots.
    [crossMoveOp(NESTED_TREE, 'n5', 'n1', 0), /ancestor\/descendant|nested/],
    // Target lies inside the moved block.
    [crossMoveOp(NESTED_TREE, 'n2', 'n4', 0), /own descendant/],
    // Non-container target / chrome target.
    [crossMoveOp(NESTED_TREE, 'n5', 'n3', 0), /cannot receive blocks/],
    // Same parent cannot be passed as a target.
    [crossMoveOp(NESTED_TREE, 'n5', 'n4', 0), /omit toParentNodeId/],
    // toIndex must be an editable index in the target (Card has one editable child: Row).
    [crossMoveOp(NESTED_TREE, 'n5', 'n8', 2), /between 0 and 1/],
    // toParentNodeId is move-only.
    [{ op: 'duplicate', nodeId: 'n5', sourceDigest: node(NESTED_TREE, 'n5').digest, toIndex: 0, toParentNodeId: 'n8' }, /only valid for move/],
    // Shared shape rejects toParentNodeId on delete before the Host sees it.
    [{ op: 'delete', nodeId: 'n5', sourceDigest: node(NESTED_TREE, 'n5').digest, toParentNodeId: 'n8' }, /unexpected_to_index/],
  ]
  for (const [operation, expected] of cases) {
    const response = await postStructure(m.structureRoute(), {
      body: structureBody({ operationId: operationId('bad-cross'), operations: [operation] }),
    })
    assert.equal(response.status, 400, JSON.stringify(response.body))
    assert.match(response.body.error.message, expected)
  }
  assert.equal(existsSync(m.file), false, 'no rejected batch records a revision')
})

test('cross-container moves are scoped, bounded and atomic in one batch', async () => {
  // A batch can move into another card and delete from the target card atomically.
  const batchMount = mount()
  await seed(batchMount)
  const batch = await postStructure(batchMount.structureRoute(), {
    body: structureBody({
      operationId: operationId('cross-batch'),
      operations: [crossMoveOp(NESTED_TREE, 'n5', 'n8', 0), deleteOp(NESTED_TREE, 'n11')],
    }),
  })
  assert.equal(batch.status, 201, JSON.stringify(batch.body))
  assert.match(batch.body.result.program.split('\n')[1], /Col\(\[Text\("B", "sm"\), Text\(sharedText, "sm"\)\]\)/)
  assert.match(batch.body.result.program.split('\n')[2], /Card\(\[Title\("第二张卡片", "sm"\), Text\("A", "sm"\), Row\(\[Text\("D", "sm"\)\]\)\], "soft"\)/)
  // @Each dynamic containers cannot receive moved blocks.
  const scopedMount = mount()
  await seed(scopedMount, SCOPED_PROGRAM, 'call-scoped-cross')
  const scopedTree = buildArtifactTree(SCOPED_PROGRAM, { containerTypes: ['Col', 'Row', 'Box', 'Grid', 'Card', 'Section', 'Carousel'] })
  const dynamicCol = [...scopedTree.nodes.values()].find(entry => entry.componentType === 'Col' && entry.depth === 2)
  const scopedMove = [...scopedTree.nodes.values()].find(entry => entry.componentType === 'Card' && entry.depth === 1)
  assert.ok(dynamicCol !== undefined)
  assert.ok(scopedMove !== undefined)
  const rejected = await postStructure(scopedMount.structureRoute(), {
    body: structureBody({
      artifactId: 'call-scoped-cross', baseRevisionId: 'call-scoped-cross',
      operationId: operationId('scoped-cross'),
      operations: [crossMoveOp(scopedTree, scopedMove.nodeId, dynamicCol.nodeId, 0)],
    }),
  })
  assert.equal(rejected.status, 400)
  assert.match(rejected.body.error.message, /writable children slot|@Each/)
})

test('nodes inside a shared named expression are rejected by the structure route', async () => {
  const program = 'root = Col([card, card2])\ncard = Card([Text("x")])\ncard2 = card'
  const tree = buildArtifactTree(program, { containerTypes: ['Col', 'Row', 'Card'] })
  const sharedCard = [...tree.nodes.values()].find(entry => entry.componentType === 'Card' && entry.shared)
  assert.ok(sharedCard !== undefined, 'the reused definition is marked shared')
  const m = mount()
  await seed(m, program, 'call-shared')
  const response = await postStructure(m.structureRoute(), {
    body: structureBody({
      artifactId: 'call-shared', baseRevisionId: 'call-shared',
      operationId: operationId('shared'), operations: [{ op: 'delete', nodeId: sharedCard.nodeId, sourceDigest: sharedCard.digest }],
    }),
  })
  assert.equal(response.status, 400)
  assert.match(response.body.error.message, /shared named expression/)
})

test('the structure route never trusts a client program and reports missing authoritative bases', async () => {
  const m = mount()
  const missingArtifact = await postStructure(m.structureRoute(), {
    body: structureBody({ artifactId: 'call-ghost', baseRevisionId: 'call-ghost', operationId: operationId('ghost'), operations: [deleteOp(NESTED_TREE, 'n5')], program: NESTED_PROGRAM }),
  })
  assert.equal(missingArtifact.status, 400, 'an unknown body field (program) is rejected by the shared validator')
  assert.match(missingArtifact.body.error.message, /unknown_field/)
  const missingUnknownArtifact = await postStructure(m.structureRoute(), {
    body: structureBody({ artifactId: 'call-ghost', baseRevisionId: 'call-ghost', operationId: operationId('ghost2'), operations: [deleteOp(NESTED_TREE, 'n5')] }),
  })
  assert.equal(missingUnknownArtifact.status, 404)
  assert.equal(missingUnknownArtifact.body.error.code, 'artifact_missing')
  await seed(m)
  const missingBase = await postStructure(m.structureRoute(), {
    body: structureBody({ baseRevisionId: 'call-other', operationId: operationId('nobase'), operations: [deleteOp(NESTED_TREE, 'n5')] }),
  })
  assert.equal(missingBase.status, 404)
  assert.equal(missingBase.body.error.code, 'base_missing')
  assert.equal(existsSync(m.file), false)
})

test('stale bases require branch: true and record latest+1 with request style metadata', async () => {
  const m = mount()
  await seed(m)
  const first = await postStructure(m.structureRoute(), { body: structureBody({ operationId: operationId('branch1'), operations: [deleteOp(NESTED_TREE, 'n5')] }) })
  assert.equal(first.status, 201)
  const stale = await postStructure(m.structureRoute(), {
    body: structureBody({ operationId: operationId('branch2'), operations: [deleteOp(NESTED_TREE, 'n6')] }),
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error.code, 'base_not_latest')
  const branch = await postStructure(m.structureRoute(), {
    body: structureBody({
      operationId: operationId('branch3'), operations: [deleteOp(NESTED_TREE, 'n6')],
      branch: true, title: 'A branched page', temporaryStyle: TEMPORARY_STYLE,
    }),
  })
  assert.equal(branch.status, 201)
  const result = branch.body.result
  assert.equal(result.baseRevisionId, 'call-original')
  assert.equal(result.revision, 3)
  assert.equal(result.title, 'A branched page')
  assert.deepEqual(result.temporaryStyle, TEMPORARY_STYLE)
  assert.equal(result.style, 'card')
  const latest = createArtifactRevisionStore().latestFor('call-original')
  assert.equal(latest.revisionId, result.revisionId)
  assert.equal(latest.revision, 3)
  assert.deepEqual(latest.temporaryStyle, TEMPORARY_STYLE)
  assert.equal(createArtifactProgramStore().lookup('call-original', result.revisionId), result.program)
})

test('replaying one operationId returns the recorded result and rejects a different body', async () => {
  const m = mount()
  await seed(m)
  const body = structureBody({ operationId: operationId('idempotent'), operations: [deleteOp(NESTED_TREE, 'n5')] })
  const first = await postStructure(m.structureRoute(), { body })
  assert.equal(first.status, 201)
  const replay = await postStructure(m.structureRoute(), { body })
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.body, first.body, 'the replay returns the recorded result')
  assert.equal(JSON.parse(readFileSync(m.file, 'utf8')).revisions.length, 1, 'the replay records no second revision')
  const conflict = await postStructure(m.structureRoute(), {
    body: { ...body, operations: [deleteOp(NESTED_TREE, 'n6')] },
  })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error.code, 'operation_replayed')
})

test('rejects an unauthorized request and a non-POST method', async () => {
  const denied = mount({ rejection: 403 })
  const response = await postStructure(denied.structureRoute(), { body: structureBody({ operationId: operationId('auth'), operations: [deleteOp(NESTED_TREE, 'n5')] }) })
  assert.equal(response.status, 403)
  assert.equal(response.body, undefined)
  const allowed = mount()
  const wrongMethod = await postStructure(allowed.structureRoute(), {
    body: structureBody({ operationId: operationId('method'), operations: [deleteOp(NESTED_TREE, 'n5')] }), method: 'PUT',
  })
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.body.error.code, 'method_not_allowed')
})

test('the operation ledger is durable and bounded', () => {
  tempHome('iui-artifact-op-ledger-')
  const store = createArtifactStructureOperationStore({}, { maxRecords: 2 })
  const record = (operationId, revisionId) => ({
    operationId, artifactId: 'call-1', requestDigest: 'a'.repeat(64), revisionId,
    revision: 2, baseRevisionId: 'call-1', style: 'card', createdAt: 1,
  })
  store.record(record('op_ledger_1', 'struct_1'))
  store.record(record('op_ledger_2', 'struct_2'))
  assert.equal(store.get('call-1', 'op_ledger_1').revisionId, 'struct_1')
  assert.equal(createArtifactStructureOperationStore().get('call-1', 'op_ledger_2').revisionId, 'struct_2')
  store.record(record('op_ledger_3', 'struct_3'))
  assert.equal(store.size(), 2)
  assert.equal(store.get('call-1', 'op_ledger_1'), undefined, 'oldest ledger entry is evicted')
  assert.equal(store.get('call-1', 'op_ledger_3').revisionId, 'struct_3')
})
