import { useEffect, useState, useRef, type RefObject } from "react"

/** Browser observation FFI. Each mounted island owns its observers and listeners. */
export const useVisibility = (
  root: RefObject<HTMLElement | null>,
  reconnect: () => void,
  motionChange: () => void
) => {
  const [environment, setEnvironment] = useState({
    ready: false,
    visible: false,
    reduced: false
  })
  const onReconnect = useRef(reconnect)
  onReconnect.current = reconnect
  const onMotionChange = useRef(motionChange)
  onMotionChange.current = motionChange
  useEffect(() => {
    const element = root.current
    if (!element) {
      return
    }
    const motion = matchMedia("(prefers-reduced-motion: reduce)")
    let intersecting = false
    const update = () =>
      setEnvironment({
        ready: true,
        visible: element.isConnected && intersecting && !document.hidden,
        reduced: motion.matches
      })
    const observer = new IntersectionObserver((entries) => {
      intersecting = entries.some((entry) => entry.isIntersecting)
      update()
    })
    const disconnect = () => {
      intersecting = false
      observer.unobserve(element)
      update()
    }
    const connect = () => {
      onReconnect.current()
      observer.observe(element)
      update()
    }
    element.addEventListener("playback-disconnect", disconnect)
    element.addEventListener("playback-connect", connect)
    observer.observe(element)
    document.addEventListener("visibilitychange", update)
    const changed = () => {
      onMotionChange.current()
      update()
    }
    motion.addEventListener("change", changed)
    update()
    return () => {
      element.removeEventListener("playback-disconnect", disconnect)
      element.removeEventListener("playback-connect", connect)
      observer.disconnect()
      document.removeEventListener("visibilitychange", update)
      motion.removeEventListener("change", changed)
    }
  }, [root])
  return environment
}
