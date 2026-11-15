/**
 * Harness for the update prompt: the production controller with a stubbed
 * Host route and in-memory storage, rendering the real `shell.overlay` entry.
 *
 * The E2E drives the same plugin-open signals the shell produces (the composer
 * chip's explicit enable and the deployment-wide default-open start) and reads
 * the real React prompt and its persisted state.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { UpdatePrompt } from '../../../src/client/UpdatePrompt.tsx'
import { createUpdatePromptController } from '../../../src/client/update-prompt-controller.ts'
import { parseUpdatePromptState, UPDATE_PROMPT_STORAGE_KEY } from '../../../src/client/update-prompt.ts'

const params = new URLSearchParams(location.search)
const lang = params.get('lang') === 'en' ? 'en' : 'zh'
const hasUpdate = params.get('update') !== '0'

const response = {
  current: '0.6.1',
  latest: hasUpdate ? '0.6.2' : '0.6.1',
  updateAvailable: hasUpdate,
  highlights: lang === 'en'
    ? ['The prompt waits for the next open', 'Later counts per version', 'No sidebar DOM is touched']
    : ['提示等到下一次打开才出现', '「下次再说」按版本累计', '不再插入侧栏 DOM'],
}

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
  __controller: ReturnType<typeof createUpdatePromptController>
  __opened: number
  __fetches: string[]
  __storage: Map<string, string>
  __promptState: () => unknown
}
page.__opened = 0
page.__fetches = []
const memory = new Map<string, string>()
page.__storage = memory
page.__promptState = () => parseUpdatePromptState(memory.get(UPDATE_PROMPT_STORAGE_KEY) ?? null)

const controller = createUpdatePromptController({
  openDetails: () => { page.__opened += 1 },
  language: () => lang,
  fetchImpl: (async (input: string | URL | Request): Promise<Response> => {
    page.__fetches.push(String(input))
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch,
  storage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
  },
})
page.__controller = controller

createRoot(document.getElementById('root')!).render(createElement(UpdatePrompt as never, {
  prompt: controller.store,
  actions: controller.actions,
  t: translate,
}))
