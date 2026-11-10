/**
 * Deep-page fixtures for the structure pipeline.
 *
 * `DEEP_DASHBOARD_PROGRAM` mirrors the real dashboard page from the isolated-GUI
 * verification: root -> Card -> Col -> Row -> Card -> Col -> Text is depth 6 and
 * the page has 83 CST nodes (the historical `MAX_CST_DEPTH = 4` rejected it, so
 * every queued structure operation resolved as `unresolved`). Its root children
 * are Title, Text and five Cards, so root-level duplicate/delete stay available.
 *
 * `VERY_DEEP_PROGRAM` exceeds the supported depth even after the limit raise; it
 * exists to lock the accurate depth/nested-target conflicts.
 */
export const DEEP_DASHBOARD_TITLE = '运营仪表盘样例'

const dashboardSection = (index: number): string => {
  const cards = [1, 2, 3].map(slot => `Card([Col([Title("指标 ${index}-${slot}", "sm"), Text("${index}.${slot}", "sm", "muted")])])`)
  return `Card([Col([Title("板块 ${index}", "sm"), Row([${cards.join(', ')}])])])`
}

export const DEEP_DASHBOARD_PROGRAM = [
  'root = Col([Title("运营仪表盘样例", "lg"), Text("实时数据概览", "sm", "muted"), ',
  ...Array.from({ length: 5 }, (_, index) => `${dashboardSection(index + 1)}, `),
  '])',
].join('')

/** A page nested past the supported depth (root -> 11 nested Cols -> Text). */
export const VERY_DEEP_TITLE = '超深层级样例'

export const VERY_DEEP_PROGRAM = [
  'root = Col([Title("超深层级样例", "md"), a1, Text("结尾", "sm")])',
  ...Array.from({ length: 11 }, (_, index) => `a${index + 1} = Col([a${index + 2}])`),
  'a12 = Text("深层内容", "sm")',
].join('\n')
