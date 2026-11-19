/** One anchored panel fixture for visual-viewport clamping under pinch zoom. */
import { useRef, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useAnchoredPopup } from '../../../src/client/popover.ts'

function Fixture(): ReactElement {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const placement = useAnchoredPopup(open, trigger, { minWidth: 340, maxWidth: 460, maxHeight: true, alignEnd: true }, panel)
  return (
    <div style={{ height: 2200 }}>
      <button ref={trigger} data-fixture="trigger" onClick={() => setOpen(value => !value)} style={{ position: 'fixed', right: 20, bottom: 20, height: 28 }}>open</button>
      {open && placement !== null && (
        <div
          ref={panel}
          data-fixture="panel"
          style={{
            position: 'fixed',
            right: placement.right,
            bottom: placement.bottom,
            width: 460,
            maxWidth: placement.maxWidth,
            maxHeight: placement.maxHeight,
            overflow: 'auto',
            background: '#fff',
            border: '1px solid #888',
            zIndex: 1000,
          }}
        >
          <div style={{ height: 474 }}>tall panel</div>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
