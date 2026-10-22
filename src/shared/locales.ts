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
  'scope.inherit.label': '跟随全局',
  'scope.off.menu': '关闭',
  'scope.session.menu': '仅本会话',
  'scope.inherit.menu': '跟随全局',
  'scope.off.aria': '关闭',
  'scope.session.aria': '仅本会话',
  'scope.inherit.aria': '跟随全局',
  'scope.off.description': 'Intelligent UI 在本会话关闭（/iui off）',
  'scope.session.description': 'Intelligent UI 在本会话开启（/iui on）',
  'scope.inherit.description': 'Intelligent UI 跟随全局开关（/iui inherit）',
  'chip.label': 'UI：{scope}',
  'chip.aria': 'Intelligent UI：{scope}',
  'chip.title': '{description} — 点击更改',
  'chip.error': '切换失败',

  // Answer-style picker (composer panel and plugin settings).
  'style.preview': '预览',
  'style.preview.hint': '根据当前选择展示示意效果',
  'style.card.preview': '卡片（简洁）',
  'style.card.hint': '适合早见结论',
  'style.article.preview': '文章（详细）',
  'style.article.hint': '适合深度阅读',
  'style.auto.badge': '自动',
  'style.slider.label': '显示样式',
  'style.slider.aria': '显示样式：{style}',
  'style.auto.label': 'Auto',
  'style.auto.hint': '智能选择',
  'style.card.label': 'Card',
  'style.card.sliderHint': '卡片样式',
  'style.article.label': 'Article',
  'style.article.sliderHint': '文章样式',
  'style.follow': '跟随全局',
  'style.follow.current': '跟随全局（当前：{style}）',
  'style.follow.description': '使用全局显示样式（{style}）',
  'style.session.note': '仅在当前会话生效',
  'style.session.footer': '此设置仅在当前会话生效，不会影响其他会话。',
  'style.global.note': '全局默认',
  'style.global.footer': '此设置会作为所有会话的默认值；会话内可以覆盖。',
  'style.panel.title': '仅本会话',
  'style.panel.back': '返回',

  // Extension configuration (Plugin detail page).
  'settings.title': '全局默认',
  'settings.description': '配置新会话的默认值；输入框的 UI 控件可以按会话覆盖可用性与回答样式。',
  'settings.note': '这些是偏好，不是强制约束：模型仍可能根据内容调整细节；需要固定本会话样式时，请在输入框的 UI 面板中设置。',
  'settings.group.availability': '可用性',
  'settings.group.availabilityHint': '决定新会话是否默认启用 Intelligent UI。',
  'settings.enable.label': '在所有会话中启用',
  'settings.enable.on': '开启：新会话默认使用 Intelligent UI。',
  'settings.enable.off': '关闭：新会话默认关闭；可在输入框为单个会话开启。',
  'settings.style.label': '回答样式',
  'settings.style.note': '默认的 Card 或 Article 版式；会话内可覆盖。',
  'settings.group.composition': '编排方式',
  'settings.group.compositionHint': '决定模型能否自行改变页面结构。',
  'settings.switch.label': '自由布局',
  'settings.switch.on': '开启：模型可自行选择页面结构、密度与内容块。',
  'settings.switch.off': '关闭：遵循默认布局与排版规范。',
  'settings.group.export': '导出',
  'settings.group.exportHint': '图片与交互页面导出的默认外观和选项。',
  'settings.export.background.label': '背景颜色',
  'settings.export.background.hint': '圆角与卡片样式下画布的背景色；可选预设或输入十六进制值。',
  'settings.export.background.presets': '预设颜色',
  'settings.export.background.hex': '自定义',
  'settings.export.scale.label': '分辨率',
  'settings.export.scale.hint': '2x 更清晰，文件也更大。',
  'settings.export.toAssistant.label': '保留追问操作',
  'settings.export.toAssistant.hint': '导出图片或交互页面时保留 @ToAssistant 追问（页面内复制消息并提示回 DSH）；关闭后会移除包含追问的整个区块。',
  'settings.loading': '正在加载设置…',
  'settings.unavailable': '当前部署未提供设置服务。',
  'settings.readonly': '当前配置不可写。',
  'settings.saving': '正在保存…',
  'settings.error': '保存失败，请重试。',
  'toc.aria': '目录',

  // Turn-tail card and compact tool row.
  'card.title': '交互式回答',
  'state.preparing': '准备中',
  'state.rendering': '渲染中',
  'state.ready': '就绪',
  'state.error': '失败',
  'card.failed': '此交互式回答无法显示。',

  // Answer image export (bottom action row).
  'export.button.label': '导出',
  'export.button.aria': '导出回答',
  'export.button.title': '导出回答',
  'export.menu.image': '导出图片',
  'export.menu.page': '交互页面',
  'export.page.hint': '单文件 HTML，保留交互',
  'export.style.raw': '原始',
  'export.style.raw.hint': '只截取答案本身',
  'export.style.rounded': '圆角',
  'export.style.rounded.hint': '背景色与圆角留白',
  'export.style.card': '卡片',
  'export.style.card.hint': '留白、圆角与柔和阴影',
  'export.state.working': '正在生成图片…',
  'export.state.workingHtml': '正在生成页面…',
  'export.state.done': '图片已导出',
  'export.state.doneHtml': '页面已导出',
  'export.state.error': '导出失败，请重试。',
  'export.error.noPrograms': '这张回答没有可导出的内容。',
  'standalone.copied': '已复制，可回到 DSH 粘贴继续',
  'standalone.copyFailed': '复制失败，请手动复制这条消息。',

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
  'scope.inherit.label': 'Follow global',
  'scope.off.menu': 'Off',
  'scope.session.menu': 'This session only',
  'scope.inherit.menu': 'Follow global',
  'scope.off.aria': 'off',
  'scope.session.aria': 'this session only',
  'scope.inherit.aria': 'follow global',
  'scope.off.description': 'Intelligent UI is off for this session (/iui off)',
  'scope.session.description': 'Intelligent UI is on for this session (/iui on)',
  'scope.inherit.description': 'Intelligent UI follows the global switch (/iui inherit)',
  'chip.label': 'UI: {scope}',
  'chip.aria': 'Intelligent UI: {scope}',
  'chip.title': '{description} — click to change',
  'chip.error': 'Switch failed',

  'style.preview': 'Preview',
  'style.preview.hint': 'Preview follows the current choice',
  'style.card.preview': 'Card (compact)',
  'style.card.hint': 'Best for quick conclusions',
  'style.article.preview': 'Article (detailed)',
  'style.article.hint': 'Best for deep reading',
  'style.auto.badge': 'Auto',
  'style.slider.label': 'Display style',
  'style.slider.aria': 'Display style: {style}',
  'style.auto.label': 'Auto',
  'style.auto.hint': 'Smart choice',
  'style.card.label': 'Card',
  'style.card.sliderHint': 'Compact card',
  'style.article.label': 'Article',
  'style.article.sliderHint': 'Reading article',
  'style.follow': 'Follow global',
  'style.follow.current': 'Follow global (currently {style})',
  'style.follow.description': 'Use the global display style ({style})',
  'style.session.note': 'Only affects this session',
  'style.session.footer': 'This setting only affects the current session; other sessions are unchanged.',
  'style.global.note': 'Global default',
  'style.global.footer': 'This is the default for every session; a session can override it.',
  'style.panel.title': 'This session',
  'style.panel.back': 'Back',

  'settings.title': 'Global defaults',
  'settings.description': 'Set the defaults for new sessions. The composer UI control can override availability and answer style per session.',
  'settings.note': 'These are preferences, not enforcement: the model may still adapt details to the content. To pin a session style, use the UI panel in the composer.',
  'settings.group.availability': 'Availability',
  'settings.group.availabilityHint': 'Whether new sessions start with Intelligent UI enabled.',
  'settings.enable.label': 'Enable in all sessions',
  'settings.enable.on': 'On: new sessions start with Intelligent UI enabled.',
  'settings.enable.off': 'Off: new sessions start disabled; enable a single session from the composer.',
  'settings.style.label': 'Answer style',
  'settings.style.note': 'The default Card or Article layout; each session can override it.',
  'settings.group.composition': 'Composition',
  'settings.group.compositionHint': 'Whether the model may change the page structure on its own.',
  'settings.switch.label': 'Free-form layout',
  'settings.switch.on': 'On: the model may choose the page structure, density and blocks.',
  'settings.switch.off': 'Off: follow the default layout and typography guidance.',
  'settings.group.export': 'Export',
  'settings.group.exportHint': 'Defaults and options for image and interactive-page export.',
  'settings.export.background.label': 'Background color',
  'settings.export.background.hint': 'The canvas color behind the rounded and card frames; choose a preset or enter a hex value.',
  'settings.export.background.presets': 'Preset colors',
  'settings.export.background.hex': 'Custom',
  'settings.export.scale.label': 'Resolution',
  'settings.export.scale.hint': '2x is sharper and produces a larger file.',
  'settings.export.toAssistant.label': 'Keep follow-up actions',
  'settings.export.toAssistant.hint': 'Keep @ToAssistant follow-ups in exported images and pages (the page copies the message and prompts a paste back into DSH); turn off to remove the whole block that contains them.',
  'settings.loading': 'Loading settings…',
  'settings.unavailable': 'This deployment provides no settings service.',
  'settings.readonly': 'These settings are read-only.',
  'settings.saving': 'Saving…',
  'settings.error': 'Saving failed. Try again.',
  'toc.aria': 'Contents',

  'card.title': 'Interactive answer',
  'state.preparing': 'Preparing',
  'state.rendering': 'Rendering',
  'state.ready': 'Ready',
  'state.error': 'Failed',
  'card.failed': 'This interactive answer could not be displayed.',

  'export.button.label': 'Export',
  'export.button.aria': 'Export answer',
  'export.button.title': 'Export answer',
  'export.menu.image': 'Export image',
  'export.menu.page': 'Interactive page',
  'export.page.hint': 'Single-file HTML with interactions',
  'export.style.raw': 'Raw',
  'export.style.raw.hint': 'Capture the answer only',
  'export.style.rounded': 'Rounded',
  'export.style.rounded.hint': 'Background color and rounded padding',
  'export.style.card': 'Card',
  'export.style.card.hint': 'Padding, rounded corners and a soft shadow',
  'export.state.working': 'Generating image…',
  'export.state.workingHtml': 'Building page…',
  'export.state.done': 'Image exported',
  'export.state.doneHtml': 'Page exported',
  'export.state.error': 'Export failed. Try again.',
  'export.error.noPrograms': 'This answer has nothing to export.',
  'standalone.copied': 'Copied — paste it back into DSH to continue.',
  'standalone.copyFailed': 'Copy failed — copy this message manually.',

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
