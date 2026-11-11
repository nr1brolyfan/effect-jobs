export interface RefreshObservation {
  text: string | null
  connection: string | null
  size: string
  busy: string | null
  focus: boolean
  scroll: boolean
  mounted: boolean
  announcements: Array<string | null>
  disabled: boolean[]
}
declare global {
  interface Window {
    stableFocus: Element | null
    stableScroll: number
    stableNodes: Array<Element | null>
    refreshChurn: RefreshObservation[]
    listChurn: Array<string | null>
    observer: MutationObserver
    table: Element | null
    uxNodes: Array<Element | null>
    uxStats: string | null
    uxMutations: Array<string | null>
  }
}
