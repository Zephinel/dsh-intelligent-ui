/** Bounded, result-owned snapshots. Saving a template never mutates this registry. */
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { contrastRatio, isStyleSnapshot, type StyleSnapshot } from '../shared/style-templates.ts'

export const MAX_RESULT_RECORDS = 200
export interface ResultRecord {
  readonly resultId: string
  readonly sessionId: string
  readonly snapshot: StyleSnapshot
  readonly parentResultId?: string
  readonly createdAt: number
}
export interface ResultStore {
  record(result: ResultRecord): void
  get(resultId: string): ResultRecord | undefined
}

/** Tool-call and session identities are opaque, bounded text. */
export function isResultIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

function validRecord(value: unknown): value is ResultRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  return Object.keys(r).every(key => ['resultId', 'sessionId', 'snapshot', 'parentResultId', 'createdAt'].includes(key))
    && isResultIdentity(r.resultId) && isResultIdentity(r.sessionId)
    && (!('parentResultId' in r) || (isResultIdentity(r.parentResultId) && r.parentResultId !== r.resultId))
    && typeof r.createdAt === 'number' && Number.isSafeInteger(r.createdAt) && r.createdAt >= 0
    && isStyleSnapshot(r.snapshot)
    // A theme-less snapshot inherits the session theme; only a stored palette is contrast-checked.
    && (r.snapshot.theme === undefined || [r.snapshot.theme.light, r.snapshot.theme.dark].every(p =>
      contrastRatio(p.ink, p.canvas) >= 3 && contrastRatio(p.accent, p.canvas) >= 3))
}

function validate(results: unknown): asserts results is ResultRecord[] {
  if (!Array.isArray(results) || results.length > MAX_RESULT_RECORDS || !results.every(validRecord)
    || new Set(results.map(r => r.resultId)).size !== results.length) throw new Error('Invalid result snapshot collection')
}

export function createResultStore(ctx: { logger?: { warn(message: string): void } } = {}): ResultStore {
  const file = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-intelligent-ui-results.json')
  let results: ResultRecord[] = []
  let corrupt = false
  try {
    const loaded = JSON.parse(readFileSync(file, 'utf8'))
    if (loaded === null || typeof loaded !== 'object' || Object.keys(loaded).length !== 2 || loaded.version !== 1) throw new Error('Invalid result file')
    validate(loaded.results)
    results = loaded.results
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      corrupt = true
      ctx.logger?.warn('intelligent-ui: could not load result snapshots; starting empty')
    }
  }
  return {
    get: resultId => {
      const result = results.find(r => r.resultId === resultId)
      return result === undefined ? undefined : structuredClone(result)
    },
    record: result => {
      if (!validRecord(result)) throw new Error('Invalid result snapshot')
      const existing = results.find(r => r.resultId === result.resultId)
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(result)) throw new Error('Result snapshots are immutable')
        return
      }
      const next = [...results, structuredClone(result)].sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_RESULT_RECORDS)
      validate(next)
      mkdirSync(dirname(file), { recursive: true })
      if (corrupt) { renameSync(file, `${file}.corrupt-${Date.now()}`); corrupt = false }
      writeFileSync(`${file}.tmp`, `${JSON.stringify({ version: 1, results: next }, null, 2)}\n`, 'utf8')
      renameSync(`${file}.tmp`, file)
      results = next
    },
  }
}
