// Browser lifecycle FFI only. React/Atom owns playback, selection and rendering.
// Native disconnection also covers owners moving an island without unmounting React.
export const registerPlaybackHost = (name: string) => {
  if (typeof customElements === "undefined" || customElements.get(name)) {
    return
  }
  customElements.define(
    name,
    class extends HTMLElement {
      private owner: HTMLElement | null = null
      connectedCallback() {
        // React delegates events to its Astro island container. Restore that owner
        // if external DOM code detaches and reinserts only the inner host.
        this.owner ??= this.parentElement
        if (this.owner?.isConnected && this.parentElement !== this.owner) {
          this.owner.append(this)
          return
        }
        this.dispatchEvent(new Event("playback-connect"))
      }
      disconnectedCallback() {
        this.dispatchEvent(new Event("playback-disconnect"))
      }
    }
  )
}
