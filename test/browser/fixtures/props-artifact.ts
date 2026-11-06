/** Fixture for the deterministic Divider/Spacer quick-adjust E2E. */
export const PROPS_TITLE = '属性调整样例'

export const PROPS_PROGRAM = `root = Col([head, rule, gap, note])
head = Title("属性调整样例", "lg")
rule = Divider()
gap = Spacer(null, 24)
note = Text("调整分割线和间距。", "sm", "muted")`

/** Program after applying both quick adjustments through the mocked Host route. */
export const PROPS_PROGRAM_APPLIED = `root = Col([head, rule, gap, note])
head = Title("属性调整样例", "lg")
rule = Divider("info", "60%", 2)
gap = Spacer(12, "auto")
note = Text("调整分割线和间距。", "sm", "muted")`

/** Cards used by the layout-parity, dirty-guard and nested-preview checks. */
export const PROPS_CENTER_TITLE = '居中属性样例'
export const PROPS_CENTER_PROGRAM = `root = Col([head, rule], null, "center")
head = Title("居中属性样例", "lg")
rule = Divider()`

export const NESTED_PROPS_TITLE = '嵌套属性样例'
export const NESTED_PROPS_PROGRAM = `root = Col([card])
card = Card([head, rule, gap])
head = Title("嵌套属性样例", "sm")
rule = Divider()
gap = Spacer(null, 12)`


/** A Divider whose colour is state-bound: quick adjust must fall back to instructions. */
export const PROPS_DYNAMIC_TITLE = '动态属性样例'
export const PROPS_DYNAMIC_PROGRAM = `root = Col([rule])
$accent = "info"
rule = Divider($accent, "10rem")`
