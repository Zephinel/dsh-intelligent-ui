/**
 * Harness for the update prompt: the production controller plus the real
 * composer chip, a stubbed Host route, real browser storage and a fake
 * deployment-wide settings source.
 *
 * The E2E therefore drives the same signals the shell produces — the chip's
 * explicit enable (through `ToggleControl.noteExplicitOpen`) and the settings
 * watcher — instead of calling the controller directly.
 */
import { createElement, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { UpdatePrompt } from '../../../src/client/UpdatePrompt.tsx'
import { ToggleControl } from '../../../src/client/ToggleControl.tsx'
import { createUpdatePromptController } from '../../../src/client/update-prompt-controller.ts'
import { parseUpdatePromptState, UPDATE_PROMPT_STORAGE_KEY } from '../../../src/client/update-prompt.ts'

const params = new URLSearchParams(location.search)
const lang = params.get('lang') === 'en' ? 'en' : 'zh'
const hasUpdate = params.get('update') !== '0'
const globalOn = params.get('global') === '1'
const noNavigation = params.get('nonav') === '1'
if (params.get('fresh') === '1') localStorage.clear()

const dictionary = lang === 'en'
  ? {
      'update.prompt.title': 'A new version of {name} is available',
      'update.highlights': "What's new",
      'update.prompt.update': 'Update',
      'update.prompt.later': 'Later',
      'update.prompt.details': 'Details',
      'update.prompt.hideDetails': 'Hide details',
      'update.prompt.dontRemind': "Don't remind me again",
      'update.noHighlights': 'This release has no published highlights. Open the plugin details for the full notes.',
    }
  : {
      'update.prompt.title': '{name} 有新版本可用',
      'update.highlights': '更新要点',
      'update.prompt.update': '更新',
      'update.prompt.later': '下次再说',
      'update.prompt.details': '查看详情',
      'update.prompt.hideDetails': '收起详情',
      'update.prompt.dontRemind': '不再提醒',
      'update.noHighlights': '该版本未提供更新要点，可在插件详情页查看完整说明。',
    }
const translate = (key: string, values?: Record<string, string | number>): string => {
  const template = dictionary[key as keyof typeof dictionary] ?? key
  return values === undefined ? template : template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name]))
}

const page = window as unknown as {
  __opened: number
  __fetches: string[]
  __promptState: () => unknown
  __setGlobal: (enabled: boolean) => void
  __setProjection: (patch: Partial<typeof projection>) => void
  __opens: number
}
page.__opened = 0
page.__fetches = []
page.__promptState = () => parseUpdatePromptState(localStorage.getItem(UPDATE_PROMPT_STORAGE_KEY))

const controller = createUpdatePromptController({
  openDetails: () => {
    if (noNavigation) return false
    page.__opened += 1
    return true
  },
  language: () => lang,
  fetchImpl: (async (input: string | URL | Request): Promise<Response> => {
    page.__fetches.push(String(input))
    const payload = {
      current: '0.5.0',
      latest: hasUpdate ? '0.6.1' : '0.5.0',
      updateAvailable: hasUpdate,
      highlights: lang === 'en'
        ? ['The prompt waits for the next open', 'Later counts per version', 'No sidebar DOM is touched']
        : ['提示等到下一次打开才出现', '「下次再说」按版本累计', '不再插入侧栏 DOM'],
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch,
  storage: {
    getItem: (key: string) => localStorage.getItem(key),
    setItem: (key: string, value: string) => { localStorage.setItem(key, value) },
  },
})

const settingsListeners = new Set<() => void>()
let settingsSnapshot: { status: string; value?: { globalEnabled?: boolean } } = {
  status: 'ready',
  value: { globalEnabled: globalOn },
}
page.__setGlobal = (enabled: boolean) => {
  settingsSnapshot = { status: 'ready', value: { globalEnabled: enabled } }
  for (const listener of settingsListeners) listener()
}
controller.watchGlobalSetting({
  getSnapshot: () => settingsSnapshot,
  subscribe: (listener) => {
    settingsListeners.add(listener)
    return () => { settingsListeners.delete(listener) }
  },
})

const projection = {
  sessionEnable: 'inherit',
  sessionStyle: 'auto',
  globalEnabled: false,
  globalStyle: 'auto',
  enabled: false,
  style: 'auto',
  pending: false,
  onDemand: null,
}
const catalogSnapshot = { status: 'ready' as const, templates: [] }
const styles = {
  subscribe: () => () => {},
  getSnapshot: () => catalogSnapshot,
  ensure: async () => {},
  refresh: async () => {},
}

// The projection is observable so tests can simulate a deployment-wide switch
// being on while the session scope is off (the "follow global" enable path).
const projectionStore = { ...projection }
const projectionListeners = new Set<() => void>()
const subscribeProjection = (listener: () => void) => {
  projectionListeners.add(listener)
  return () => { projectionListeners.delete(listener) }
}
const useProjection = () => useSyncExternalStore(subscribeProjection, () => projectionStore, () => projectionStore)
page.__setProjection = (patch: Partial<typeof projection>) => {
  Object.assign(projectionStore, patch)
  for (const listener of projectionListeners) listener()
}
page.__opens = 0

createRoot(document.getElementById('root')!).render(createElement('div', null,
  createElement(ToggleControl as never, {
    useProjection,
    locked: false,
    sessionId: 'harness-session',
    styles,
    flip: async () => null,
    setStyle: async () => null,
    noteExplicitOpen: () => {
      page.__opens += 1
      controller.noteOpen('explicit-enable')
    },
    t: translate,
  }),
  createElement(UpdatePrompt as never, {
    prompt: controller.store,
    actions: controller.actions,
    t: translate,
  }),
))
