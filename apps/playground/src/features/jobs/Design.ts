const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  jobs: "M8 4h8v4H8z M5 8h14v12H5z M9 12h6 M9 16h4",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  layers: "m12 3 9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  settings:
    "M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  chevron: "m9 5 7 7-7 7",
  down: "m7 10 5 5 5-5",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M15 15l5 5",
  refresh: "M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-1l2 6 M18 17a7 7 0 0 1-12 1l-2-6",
  plus: "M12 5v14 M5 12h14",
  check: "m5 12 4 4L19 6",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2",
  alert: "m12 3 10 18H2z M12 9v5 M12 17h.01",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  book: "M12 5v15 M12 5C8 2 4 3 3 4v15c4-2 6-1 9 1 3-2 5-3 9-1V4c-4-2-6-1-9 1",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z m-4 9 3 3 5-5",
  close: "m6 6 12 12 M6 18 18 6",
  filter: "M4 7h16 M7 12h10 M10 17h4",
  code: "m8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18",
  mail: "M3 5h18v14H3z m0 1 9 7 9-7",
  image: "M3 3h18v18H3z m0 14 6-6 5 5 3-3 4 4 M15 7h.01",
  webhook:
    "M8 7a3 3 0 1 1 5 2 M5 15a3 3 0 1 0 5 3 M16 15a3 3 0 1 1 1 6 M10 9l-3 6 M12 8l5 7 M10 18h6",
  upload: "M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6",
  terminal: "m5 7 5 5-5 5 M13 17h6",
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18"
} as const

export type IconName = keyof typeof paths

export const icon = (name: IconName) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "1.5")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", paths[name])
  svg.append(path)
  return svg
}

export const jobIcon = (name: string): IconName => {
  if (name.includes("email") || name.includes("welcome")) {
    return "mail"
  }
  if (name.includes("image")) {
    return "image"
  }
  if (name.includes("webhook")) {
    return "webhook"
  }
  if (name.includes("export")) {
    return "upload"
  }
  if (name.includes("catalog")) {
    return "layers"
  }
  if (name.includes("payment")) {
    return "shield"
  }
  return "terminal"
}

export const jobName = (name: string) =>
  name.split(".").at(-1)?.replaceAll(/[-_]/g, " ") ?? name

export const compactTime = (millis: number) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(millis)
