/**
 * Bilingual dictionaries for the extension's own user-visible copy.
 *
 * The browser half registers both dictionaries with the DSH locale service
 * (`ctx.locale.register`), and slot components translate through the injected
 * `t` seat, so a language switch re-renders the composer chip, the Turn-tail
 * card chrome and the renderer library without a page reload. `zh` is the
 * key-set source of truth; `en` is checked complete against it, and `en` is
 * also the renderer's fallback when it renders outside a DSH locale seat
 * (tests, standalone embeds).
 *
 * Model-facing text (tool description, system prompt, the Agent Skill) is not
 * translated here: DSH's locale service covers browser UI copy only.
 */

/** Locale namespace owned by this extension. */
export const NS = 'intelligent-ui'

/** Flat template dictionaries: `{name}` placeholders, replaced on translate. */
export type LocaleDict = Record<string, string>

/** Bound translate function: key plus optional placeholder values. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  // Composer scope chip and menu.
  'scope.off.label': '关闭',
  'scope.session.label': '本会话',
  'scope.all.label': '全部',
  'scope.off.menu': '关闭',
  'scope.session.menu': '仅本会话',
  'scope.all.menu': '全部会话',
  'scope.off.aria': '关闭',
  'scope.session.aria': '仅本会话',
  'scope.all.aria': '全部会话',
  'scope.off.description': 'Intelligent UI 在所有会话中关闭（/iui off）',
  'scope.session.description': 'Intelligent UI 仅在本会话开启（/iui session）',
  'scope.all.description': 'Intelligent UI 在所有会话中开启（/iui global）',
  'chip.label': 'UI：{scope}',
  'chip.aria': 'Intelligent UI：{scope}',
  'chip.title': '{description} — 点击更改',
  'chip.error': '切换失败',

  // Turn-tail card and compact tool row.
  'card.title': '交互式回答',
  'state.preparing': '准备中',
  'state.rendering': '渲染中',
  'state.ready': '就绪',
  'state.error': '失败',
  'card.failed': '此交互式回答无法显示。',

  // Renderer failure note.
  'fallback.couldNotRender': '生成的 UI 无法渲染。',
  'fallback.showProgram': '显示 UI 程序',
  'fallback.noProgram': '未提供程序。',

  // Component chrome.
  'code.copy': '复制',
  'code.copied': '已复制',
  'code.copyAria': '复制代码',
  'code.languageFallback': '代码',
  'carousel.previous': '上一张',
  'carousel.next': '下一张',
  'flashcard.hint': '点击翻面',
  'youtube.title': 'YouTube 视频',
  'htmlView.preparing': '正在准备交互视图…',
  'htmlView.title': '交互视图',
  'select.choose': '请选择…',
  'timer.aria': '计时器',
  'timer.start': '开始',
  'timer.pause': '暂停',
  'timer.resume': '继续',
  'timer.reset': '重置',

  // Chart accessible names.
  'chart.aria.bar': '柱状图：{series}，横轴 {x}',
  'chart.aria.line': '折线图：{series}，横轴 {x}',
  'chart.aria.area': '面积图：{series}，横轴 {x}',
  'chart.aria.scatter': '散点图：{series}，横轴 {x}',
  'chart.aria.pie': '饼图：{series}，按 {x} 分类',
  'chart.aria.donut': '环形图：{series}，按 {x} 分类',
  'chart.values': '数值',

  // Map chrome. Tile attribution stays as the provider requires it.
  'map.aria.region': '地图',
  'map.aria.unavailable': '地图不可用',
  'map.fallback.title': '地图预览不可用',
  'map.fallback.caption': '地点列表见下方。',
  'map.fallback.empty': '没有可显示的地点。',
  'map.aria.filter': '筛选地点',
  'map.filter.all': '全部地点',
  'map.aria.recenter': '显示所有地点',
  'map.aria.info': '关于此地图',
  'map.action.expand': '展开',
  'map.action.collapse': '收起',
  'map.info.note': '拖动探索，用 + 和 − 缩放。选择地点可高亮显示。',
  'map.route.title': '路线总览',
  'map.route.note.street': '连线沿道路绘制（OSRM / OpenStreetMap，驾车模式）；仅为路线概览，不是逐向导航。',
  'map.route.note.joined': '连线按顺序连接各地点。街道路线正在加载或不可用。',
  'map.route.status.street': '街道路线已加载。',
  'map.route.status.overview': '街道路线不可用，改为直线连接。',
  'map.route.status.loading': '街道路线加载中。',
  'map.error.tiles': '地图瓦片暂时不可用，地点仍会显示。',
} as const

/** English dictionary, checked complete against the Chinese key set. */
export const en: Record<keyof typeof zh, string> = {
  'scope.off.label': 'Off',
  'scope.session.label': 'Session',
  'scope.all.label': 'All',
  'scope.off.menu': 'Off',
  'scope.session.menu': 'This session only',
  'scope.all.menu': 'All sessions',
  'scope.off.aria': 'off',
  'scope.session.aria': 'this session only',
  'scope.all.aria': 'all sessions',
  'scope.off.description': 'Intelligent UI is off on every session (/iui off)',
  'scope.session.description': 'Intelligent UI is on for this session only (/iui session)',
  'scope.all.description': 'Intelligent UI is on for all sessions (/iui global)',
  'chip.label': 'UI: {scope}',
  'chip.aria': 'Intelligent UI: {scope}',
  'chip.title': '{description} — click to change',
  'chip.error': 'Switch failed',

  'card.title': 'Interactive answer',
  'state.preparing': 'Preparing',
  'state.rendering': 'Rendering',
  'state.ready': 'Ready',
  'state.error': 'Failed',
  'card.failed': 'This interactive answer could not be displayed.',

  'fallback.couldNotRender': 'This generated UI could not be rendered.',
  'fallback.showProgram': 'Show the UI program',
  'fallback.noProgram': 'No program was provided.',

  'code.copy': 'Copy',
  'code.copied': 'Copied',
  'code.copyAria': 'Copy code',
  'code.languageFallback': 'code',
  'carousel.previous': 'Previous',
  'carousel.next': 'Next',
  'flashcard.hint': 'Tap to flip',
  'youtube.title': 'YouTube video',
  'htmlView.preparing': 'Preparing the interactive view…',
  'htmlView.title': 'Interactive view',
  'select.choose': 'Choose…',
  'timer.aria': 'Timer',
  'timer.start': 'Start',
  'timer.pause': 'Pause',
  'timer.resume': 'Resume',
  'timer.reset': 'Reset',

  'chart.aria.bar': 'Bar chart of {series} by {x}',
  'chart.aria.line': 'Line chart of {series} by {x}',
  'chart.aria.area': 'Area chart of {series} by {x}',
  'chart.aria.scatter': 'Scatter chart of {series} by {x}',
  'chart.aria.pie': 'Pie chart of {series} by {x}',
  'chart.aria.donut': 'Donut chart of {series} by {x}',
  'chart.values': 'values',

  'map.aria.region': 'Map',
  'map.aria.unavailable': 'Map unavailable',
  'map.fallback.title': 'Map preview unavailable',
  'map.fallback.caption': 'The places are listed below.',
  'map.fallback.empty': 'No places to show.',
  'map.aria.filter': 'Filter places',
  'map.filter.all': 'All places',
  'map.aria.recenter': 'Show every place',
  'map.aria.info': 'About this map',
  'map.action.expand': 'Expand',
  'map.action.collapse': 'Collapse',
  'map.info.note': 'Drag to explore and use + and − to zoom. Select a place to highlight it.',
  'map.route.title': 'Route overview',
  'map.route.note.street': 'The line follows streets (OSRM / OpenStreetMap, driving profile); it is an overview, not turn-by-turn directions.',
  'map.route.note.joined': 'The line joins the places in order. Street routing is loading or unavailable.',
  'map.route.status.street': 'Street route loaded.',
  'map.route.status.overview': 'Street routing unavailable. Showing direct connections.',
  'map.route.status.loading': 'Street route loading.',
  'map.error.tiles': 'Map tiles are temporarily unavailable. The places are still shown.',
}

/**
 * Bind one dictionary to a flat translate function.
 * @param dict - flat template dictionary.
 * @returns `t(key, params)`: the active template with placeholders filled, or
 *   the key itself when the dictionary does not contain it.
 */
export function translate(dict: LocaleDict): Translate {
  return (key, params) => {
    const template = dict[key]
    if (template === undefined) return key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match: string, name: string) => {
      const value = params[name]
      return value === undefined ? match : String(value)
    })
  }
}

/** English translate function used where no DSH locale seat is available. */
export const fallbackT: Translate = translate(en)
