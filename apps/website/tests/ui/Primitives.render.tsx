// Synthetic component fixture; no API, identity, or private data.
import { createRoot } from "react-dom/client"
import { useRef, useState } from "react"
import {
  Button,
  Panel,
  TabsRoot,
  TabsList,
  TabsTab,
  TabsPanel
} from "../../src/ui/Primitives.js"
import * as Popover from "../../src/ui/Popover.js"
import { Pagination } from "../../src/ui/Pagination.js"

function Fixture() {
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const tab = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState("all")
  const [activations, setActivations] = useState(0)
  const [submits, setSubmits] = useState(0)
  const [disabledClicks, setDisabledClicks] = useState(0)
  const [current, setCurrent] = useState(2)
  const [loading, setLoading] = useState(false)
  const [lastAction, setLastAction] = useState("none")
  return (
    <Panel ref={panel} aria-label="Primitive fixture">
      <h1>Shared job controls</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setSubmits(submits + 1)
        }}
      >
        <Button
          ref={button}
          id="native-button"
          name="operation"
          value="inspect"
          className="caller-button"
          style={{ marginBottom: 8 }}
          onClick={() =>
            setLastAction(
              button.current?.tagName === "BUTTON" && panel.current?.tagName === "SECTION"
                ? "refs passed"
                : "refs failed"
            )
          }
        >
          Native action
        </Button>
        <Button type="submit">Submit</Button>
        <Button type="reset">Reset</Button>
        <Button disabled onClick={() => setDisabledClicks(disabledClicks + 1)}>
          Disabled action
        </Button>
        <label>
          Native input
          <input name="input" defaultValue="original" />
        </label>
      </form>
      <p>
        Submits: <span id="submits">{submits}</span>; disabled clicks:{" "}
        <span id="disabled-clicks">{disabledClicks}</span>
      </p>
      <TabsRoot
        value={value}
        onValueChange={(next) => {
          setValue(next)
          setActivations(activations + 1)
        }}
      >
        <TabsList aria-label="Job state">
          <TabsTab value="all" count={120}>
            All jobs
          </TabsTab>
          <TabsTab value="dead" disabled>
            Dead
          </TabsTab>
          <TabsTab value="pending" count={32} ref={tab}>
            Pending
          </TabsTab>
        </TabsList>
        <TabsPanel value="all">
          <p>All job results</p>
        </TabsPanel>
        <TabsPanel value="dead">
          <p>Dead results</p>
        </TabsPanel>
        <TabsPanel value="pending">
          <p>Pending results</p>
        </TabsPanel>
      </TabsRoot>
      <p>
        Tab activations: <span id="activations">{activations}</span>
      </p>
      <Popover.Root>
        <Popover.Trigger ref={trigger}>Exact timestamp</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner>
            <Popover.Popup ref={popup}>
              <Popover.Title>Timestamp details</Popover.Title>
              <Popover.Description>
                Local and UTC timestamp, synthetic fixture.
              </Popover.Description>
              <p>2026-10-12 16:00:01 Europe/Warsaw · UTC 14:00:01</p>
              <Popover.Close
                onClick={() =>
                  setLastAction(
                    trigger.current?.tagName === "BUTTON" &&
                      popup.current?.tagName === "DIV"
                      ? "popover refs passed"
                      : "popover refs failed"
                  )
                }
              >
                Close timestamp
              </Popover.Close>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <Button onClick={() => setLoading(!loading)}>Toggle loading</Button>
      <Pagination
        current={current}
        pages={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
        hasPrevious={current > 1}
        hasNext={current < 9}
        disabled={loading}
        onPage={(page) => {
          setCurrent(page)
          setLastAction(`page ${page}`)
        }}
        onFirst={() => {
          setCurrent(1)
          setLastAction("first")
        }}
        onPrevious={() => {
          setCurrent(current - 1)
          setLastAction("previous")
        }}
        onNext={() => {
          setCurrent(current + 1)
          setLastAction("next")
        }}
      />
      <div aria-label="Sparse known history">
        <Pagination
          current={3}
          pages={[1, 3, 9]}
          hasPrevious={false}
          hasNext={false}
          onPage={(page) => setLastAction(`sparse ${page}`)}
          onFirst={() => setLastAction("sparse first")}
          onPrevious={() => setLastAction("sparse previous")}
          onNext={() => setLastAction("sparse next")}
        />
      </div>
      <p role="status" id="action">
        {lastAction}
      </p>
    </Panel>
  )
}
const root = document.getElementById("fixture")
if (root) {
  createRoot(root).render(<Fixture />)
}
