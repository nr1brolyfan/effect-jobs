// Synthetic presentation fixture; no backend, session or private data.
import { createRoot } from "react-dom/client"
import { DateTime } from "../../src/ui/DateTime.js"
import * as Popover from "../../src/ui/Popover.js"

const instant = Date.parse("2026-10-25T00:30:00.123Z")
createRoot(document.getElementById("fixture")!).render(
  <>
    <h1>Timestamp alignment</h1>
    <table aria-label="Synthetic timestamps">
      <thead>
        <tr>
          <th>Updated</th>
          <th>Terminal</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <DateTime value={instant} label="Updated" />
          </td>
          <td>
            <DateTime value={instant} label="Terminal" />
          </td>
        </tr>
      </tbody>
    </table>
    <dl className="detail">
      <dt>Available</dt>
      <dd>
        <DateTime value={instant} label="Available" />
      </dd>
      <dt>Session expires</dt>
      <dd>
        <DateTime value={instant} label="Session expires" />
      </dd>
      <dt>Retry</dt>
      <dd>
        <DateTime value={instant} seconds={false} label="Retry" />
      </dd>
    </dl>
    <section aria-label="Boundary values">
      <DateTime value={null} />
      <DateTime value={undefined} />
      <DateTime value={NaN} />
      <DateTime value={0} label="Epoch" />
    </section>
    <button id="outside" type="button">
      Outside target
    </button>
    <Popover.Root>
      <Popover.Trigger>Default popover</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner>
          <Popover.Popup aria-label="Default popup">
            <Popover.Close>Close</Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  </>
)
