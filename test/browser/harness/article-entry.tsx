import { createRoot } from 'react-dom/client'
import { OpenUIRenderer } from '../../../src/lib/render.tsx'
import '../../../src/client/index.css'

/**
 * Article-layout fixture: page-level flow, two Sections, and varied block
 * types inside each body. The E2E measures the resulting spacing, so this
 * program should stay small and deterministic.
 */
const PROGRAM = `
root = Col([toc, intro, one, two])
toc = Toc(["One", "Two"], ["one", "two"])
intro = Text("Intro paragraph for the exported article fixture.", "md")
one = Section("One", [p1, grid, heading, points, p2], "one")
p1 = Markdown("First paragraph of section one. It is deliberately long enough to wrap on a normal reading measure.")
grid = Grid([Card([Title("A", "sm"), Text("Card A body", "sm", "muted")]), Card([Title("B", "sm"), Text("Card B body", "sm", "muted")])], 2, 160, 3)
heading = Title("A sub heading", "sm")
points = List(["First point", "Second point", "Third point"], "bullet")
p2 = Text("Closing paragraph after the list.", "md")
two = Section("Two", [p3], "two")
p3 = Markdown("Second section body.")
`

createRoot(document.getElementById('root')!).render(
  <div className="dsh-iui-card" data-dsh-iui-style="article">
    <div className="dsh-iui-body">
      <div className="dsh-iui-article">
        <OpenUIRenderer program={PROGRAM} />
      </div>
    </div>
  </div>,
)
