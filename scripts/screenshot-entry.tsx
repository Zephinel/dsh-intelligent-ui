/** Reproducible README fixtures: production surfaces with local, deterministic services. */
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ToggleControl } from '../src/client/ToggleControl.tsx'
import { OnDemandHint } from '../src/client/OnDemandHint.tsx'
import { IntelligentUICards } from '../src/client/IntelligentUICards.tsx'
import { SettingsPage } from '../src/client/SettingsPage.tsx'
import { createStyleCatalog } from '../src/client/styles.ts'
import { translate, en, zh } from '../src/shared/locales.ts'
import type { IntelligentUIModeView } from '../src/shared/intelligent-ui.ts'
import { templates } from '../test/browser/harness/style-fixtures.ts'
import '../src/client/index.css'
import 'katex/dist/katex.min.css'

const params = new URLSearchParams(location.search)
const shot = params.get('shot')
const lang = params.get('lang') === 'zh' ? 'zh' : 'en'
const t = translate(lang === 'zh' ? zh : en)
const styles = createStyleCatalog({ fetch: async () => new Response(JSON.stringify({ templates })) })
const base: IntelligentUIModeView = {
  sessionEnable: 'on', sessionStyle: 'inherit', globalEnabled: false, globalStyle: 'auto',
  enabled: true, style: 'auto', pending: false, onDemand: null,
}
const snapshot = {
  schemaVersion: 1, baseLayout: 'card', suggestedName: 'Ocean notes',
  directives: 'Use clear hierarchy, spacious groups and a calm editorial palette.', theme: templates[0].theme,
}
const programEn = `root = Col([Title("A calmer weekly review", "xl"), Text("One view of what matters, with space to think.", "md", "muted"), Grid([focus, progress], 2, 220), Section("Next steps", [Text("Keep the scope small. Finish the current milestone, then review the evidence before starting the next.")])])
focus = Card([Caption("THIS WEEK"), Title("3 priorities", "lg"), Text("Ship the draft · Review feedback · Plan the next step", "sm")], "outline")
progress = Card([Caption("PROGRESS"), Title("75% complete", "lg"), Text("The remaining work is clear and bounded.", "sm")], "outline")`
const programZh = `root = Col([Title("更从容的周回顾", "xl"), Text("用一个视图看清重要的事，也给思考留出空间。", "md", "muted"), Grid([focus, progress], 2, 220), Section("下一步", [Text("保持范围小。完成当前里程碑后先看证据，再开始下一项。")])])
focus = Card([Caption("本周"), Title("3 个优先项", "lg"), Text("发出草稿 · 收集反馈 · 规划下一步", "sm")], "outline")
progress = Card([Caption("进度"), Title("已完成 75%", "lg"), Text("剩下的工作清晰且有边界。", "sm")], "outline")`
const program = lang === 'zh' ? programZh : programEn
const nodes = [{ root: { kind: 'tool-result', callId: 'screenshot-result', name: 'render_ui', isError: false,
  call: { name: 'render_ui', argsRaw: JSON.stringify({ program, title: lang === 'zh' ? '周回顾' : 'Weekly review', style: 'card', temporaryStyle: snapshot }) } } }]

function Shot() {
  const [view, setView] = useState(base)
  const [formState, setFormState] = useState({ status: 'ready' as const, writable: true,
    value: { globalEnabled: false, answerStyle: 'auto', freeComposition: false, exportBackground: '#ffffff', exportScale: '2x', removeFollowUps: true } })
  const settingsForm = useMemo(() => ({ getSnapshot: () => formState, subscribe: () => () => {},
    set: async (field: string, value: unknown) => { setFormState(s => ({ ...s, value: { ...s.value, [field]: value } })); return true },
  }), [formState])
  if (shot === 'settings') return <SettingsPage styles={styles} settingsForm={settingsForm as never} t={t} />
  if (shot === 'result') return <IntelligentUICards turn={{ turn: 1 } as never} styles={styles} sessionId="e2e-session"
    useProjection={() => ({ ...base, styleEdit: true }) as never}
    usePrograms={() => nodes as never} adjustStyle={async () => null} t={t} />
  return <div data-screenshot-composer>
    {shot === 'hint' ? <div data-composer-overlay><OnDemandHint useProjection={() => ({ ...view, onDemand: {
      operationId: 'screenshot-operation', clientInstanceId: 'screenshot-tab', kind: 'generate', status: 'armed', resultIds: [],
    } }) as never} useInput={selector => selector({ phase: 'plain' } as never)} inputActions={{} as never}
      clientInstanceId="screenshot-tab" readInput={() => ({ draft: '', draftRev: 0, phase: 'plain', occurrences: [] }) as never}
      focusComposer={() => {}} cancelOnDemand={async () => null} t={t} /></div> : null}
    <div className="shot-input" role="textbox" aria-label="Message">Describe what you need…</div>
    <div className="shot-toolbar"><ToggleControl useProjection={() => view as never} locked={false} styles={styles} sessionId="e2e-session"
      flip={async scope => { setView(v => ({ ...v, sessionEnable: scope })); return null }} setStyle={async () => null}
      armOnDemand={async () => null} t={t} /></div>
  </div>
}
createRoot(document.getElementById('root')!).render(<Shot />)
