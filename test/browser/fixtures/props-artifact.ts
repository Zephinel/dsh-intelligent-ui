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
