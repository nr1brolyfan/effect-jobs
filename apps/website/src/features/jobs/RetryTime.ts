export const exactTime = (millis: number) =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short"
  }).format(millis)

export const countdown = (availableAt: number, now: number) => {
  const seconds = Math.ceil((availableAt - now) / 1000)
  if (seconds <= 0) {
    return "Eligible now · waiting for a worker"
  }
  if (seconds < 60) {
    return `In ${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  return minutes < 60
    ? `In ${minutes}m ${seconds % 60}s`
    : `In ${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds % 60}s`
}
