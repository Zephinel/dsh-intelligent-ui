/** Nested-container fixture for the M4 structure-engine and renderer spikes. */
export const NESTED_TITLE = '嵌套区块样例'

export const NESTED_PROGRAM = `root = Col([outerCard, secondCard])
outerCard = Card([Title("外层卡片", "sm"), Col([Text("A", "sm"), Text("B", "sm"), Text(sharedText, "sm")])])
secondCard = Card([Title("第二张卡片", "sm"), Row([Text("C", "sm"), Text("D", "sm")])], "soft")
sharedText = "shared"`

/** Loop/scope fixture: a child inside @Each must not move out of its scope. */
export const SCOPED_PROGRAM = `root = Col([listCard])
listCard = Card([Title("循环卡片", "sm"), Col(@Each(items, "item", Text(item.label, "sm")))])
items = [{label: "one"}, {label: "two"}]`

/** Anchor fixture: duplicating a Section must not silently duplicate its anchor. */
export const ANCHOR_PROGRAM = `root = Col([intro])
intro = Card([Title("锚点卡片", "sm"), Col([Section("Part A", [Text("body")], "part-a")])])`
