/**
 * Harness for the sidebar update card: a minimal sidebar with DSH's current
 * DOM shape (`[data-sidebar-toggle]`, a direct-child panel <nav>) plus a stubbed
 * update route. The card module inserts itself; the E2E drives the real React
 * popover and reads geometry from this page.
 */
import { installSidebarUpdateNotice } from '../../../src/client/sidebar-update.ts'

const params = new URLSearchParams(location.search)
const lang = params.get('lang') === 'en' ? 'en' : 'zh'
const empty = params.get('empty') === '1'

document.getElementById('root')!.innerHTML = `
  <div id="frame" data-sidebar-collapsed="false" style="width:280px;height:900px;display:flex;flex-direction:column">
    <div id="sidebar" style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:6px 8px;background:#1b1b1c;color:#eee;font:13px system-ui">
      <div class="logoRow"><button data-sidebar-toggle style="height:28px">toggle</button></div>
      <button class="newSession" style="height:34px">New Session</button>
      <nav aria-label="panels" style="display:flex;flex-direction:column;gap:2px"><button>Plugins</button><button>Automation tasks</button></nav>
      <div style="flex:1;min-height:0"><strong>Running &amp; recent</strong></div>
    </div>
  </div>`

const zh = {
  'update.title': '{name} 有更新可用',
  'update.open': '点击查看详情',
  'update.highlights': '更新要点',
  'update.openDetails': '打开插件详情',
  'update.noHighlights': '该版本未提供更新要点，可在插件详情页查看完整说明。',
}
const en = {
  'update.title': 'Update available for {name}',
  'update.open': 'View details',
  'update.highlights': "What's new",
  'update.openDetails': 'Open plugin details',
  'update.noHighlights': 'This release has no published highlights. Open the plugin details for the full notes.',
}
const dict = lang === 'en' ? en : zh
const translate = (key: string, values?: Record<string, string | number>): string => {
  const template = dict[key as keyof typeof dict] ?? key
  return values === undefined ? template : template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name]))
}

;(window as any).__opened = 0
;(window as any).__fetches = []
;(window as any).fetch = async (input: string | URL | Request): Promise<Response> => {
  const url = String(input)
  ;(window as any).__fetches.push(url)
  if (!url.includes('/api/intelligent-ui/update')) throw new Error(`unexpected fetch ${url}`)
  const english = url.includes('lang=en')
  return new Response(JSON.stringify(empty
    ? { current: '0.5.0', latest: null, updateAvailable: false, highlights: [] }
    : {
        current: '0.5.0',
        latest: '0.6.1',
        updateAvailable: true,
        highlights: english
          ? ['Card sits under New Session', 'View details opens the highlights popover', 'The arrow always points right']
          : ['侧栏卡片位于 New Session 下方', '点击查看详情只打开更新要点', '箭头始终朝右'],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
}

installSidebarUpdateNotice({
  openDetails: () => { (window as any).__opened += 1 },
  translate: () => translate,
  subscribe: () => () => {},
  locale: () => lang,
})
