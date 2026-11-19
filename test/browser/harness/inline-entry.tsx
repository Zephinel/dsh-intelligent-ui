/** Inline UI fence fixtures: settled, streaming, invalid, excess-arg, partial and zh-invalid. */
import { createRoot } from 'react-dom/client'
import { InlineUIFence } from '../../../src/client/InlineUI.tsx'
import { zh } from '../../../src/shared/locales.ts'
import '../../../src/client/index.css'

const tZh = (key: string): string => (zh as Record<string, string>)[key] ?? key

const fixtures = (
  <div id="page">
    <InlineUIFence code={'root = Col([Title("Inline fixture"), Text("Rendered in the message body."), Badge("live")])'} />
    <InlineUIFence
      streaming
      code={'root = Col([Title("Streaming'}
      children={<pre data-fixture="streaming-code">{'```openui\nroot = Col([Title("Streaming'}</pre>}
    />
    <InlineUIFence code={'root = NotAComponent("broken")'} />
    <InlineUIFence code={'root = Col([Title("Extra args fixture"), Text("Rendered despite a recoverable diagnostic."), Svg([Rect(10, 10, 80, 40, "surface", "ink", 1.5, null, null, 12)], "0 0 100 60")])'} />
    <InlineUIFence code={'root = Col([Title("Partial fixture"), Text("The usable parts still render."), Badge()])'} />
    <InlineUIFence t={tZh} code={'root = NotAComponent("broken")'} />
    <InlineUIFence code={''} />
  </div>
)

createRoot(document.getElementById('root')!).render(fixtures)
