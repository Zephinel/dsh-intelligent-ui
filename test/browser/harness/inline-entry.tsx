/** In-message UI fence fixtures: a settled program, a streaming fence and an invalid program. */
import { createRoot } from 'react-dom/client'
import { InlineUIFence } from '../../../src/client/InlineUI.tsx'
import '../../../src/client/index.css'

const fixtures = (
  <div id="page">
    <InlineUIFence code={'root = Col([Title("Inline fixture"), Text("Rendered in the message body."), Badge("live")])'} />
    <InlineUIFence
      streaming
      code={'root = Col([Title("Streaming'}
      children={<pre data-fixture="streaming-code">{'```openui\nroot = Col([Title("Streaming'}</pre>}
    />
    <InlineUIFence code={'root = NotAComponent("broken")'} />
  </div>
)

createRoot(document.getElementById('root')!).render(fixtures)
