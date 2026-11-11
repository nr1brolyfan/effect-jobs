import * as stylex from "@stylexjs/stylex"

const workerPulse = stylex.keyframes({ "50%": { opacity: 0.48 } })
const packet = stylex.keyframes({
  from: { transform: "translateX(0)", opacity: 0 },
  "30%": { opacity: 1 },
  to: { transform: "translateX(32px)", opacity: 0 }
})

// Static component styles. Class hooks remain for behavior tests, not CSS ownership.
export const styles = stylex.create({
  workerPulse: {
    animationName: {
      default: workerPulse,
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    animationDuration: "1.4s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite"
  },
  packet: {
    content: { default: null, "::after": '""' },
    display: { default: null, "::after": "block" },
    width: { default: null, "::after": 5 },
    height: { default: null, "::after": 5 },
    backgroundColor: { default: null, "::after": "var(--accent)" },
    marginTop: { default: null, "::after": -2 },
    animationName: {
      default: null,
      "::after": { default: packet, "@media (prefers-reduced-motion: reduce)": "none" }
    },
    animationDuration: { default: null, "::after": "2.2s" },
    animationTimingFunction: { default: null, "::after": "linear" },
    animationIterationCount: { default: null, "::after": "infinite" }
  },
  root: {
    display: "block",
    textAlign: "left",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#3b4961",
    borderRadius: "10px",
    backgroundColor: "var(--surface)",
    boxShadow: "0 0 100px #4563aa12,\n    0 24px 80px #0004",
    overflow: "hidden"
  },
  // root
  element: {
    display: "block",
    textAlign: "left",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#3b4961",
    borderRadius: "10px",
    backgroundColor: "var(--surface)",
    boxShadow: "0 0 100px #4563aa12,\n    0 24px 80px #0004",
    overflow: "hidden"
  },
  // .ej-landing .system-heading | .ej-landing .system-heading
  systemHeading: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: { default: "15px 22px", "@media (max-width: 560px)": "12px 14px" },
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "var(--border)",
    font: "12px/1.5 ui-monospace,\n    monospace"
  },
  // .ej-landing .tiny-mark
  tinyMark: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    backgroundColor: "var(--accent)",
    boxShadow: "0 0 12px #91b5ff44"
  },
  // .ej-landing .system-heading strong
  systemHeading2: { fontWeight: "500", marginLeft: "10px" },
  // .ej-landing .system-subtitle
  systemSubtitle: { color: "var(--muted)" },
  // .ej-landing .simulation | .ej-landing .simulation
  simulation: {
    fontSize: { default: "9px", "@media (max-width: 560px)": "8px" },
    color: "var(--muted)",
    letterSpacing: "1.2px"
  },
  // .ej-landing .system-body | .ej-landing .system-body
  systemBody: {
    padding: { default: "26px 24px 0", "@media (max-width: 560px)": "18px 10px 0" }
  },
  // .ej-landing .flow-header | .ej-landing .flow-header
  flowHeader: {
    display: { default: "flex", "@media (max-width: 560px)": "grid" },
    justifyContent: "space-between",
    color: "var(--muted)",
    font: "10px/1.5 ui-monospace,\n    monospace",
    letterSpacing: "0.8px",
    margin: "0 0 18px",
    fontSize: { "@media (max-width: 560px)": "8px" },
    gridTemplateColumns: { "@media (max-width: 560px)": "1fr 1fr" },
    gap: { "@media (max-width: 560px)": "7px" }
  },
  // .ej-landing .flow-map | .ej-landing .flow-map
  flowMap: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 0.6fr 1.35fr 0.6fr 1.35fr 0.6fr 0.8fr",
      "@media (max-width: 560px)": "1fr 0.25fr 1.2fr"
    },
    alignItems: "center",
    position: "relative",
    paddingBottom: "47px",
    gap: { "@media (max-width: 560px)": "0" },
    rowGap: { "@media (max-width: 560px)": "28px" },
    padding: { "@media (max-width: 560px)": "10px 6px 52px" }
  },
  // .ej-landing .request-node, .ej-landing .queue-node, .ej-landing .worker-pair > div, .ej-landing .result-node
  resultNode: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "5px",
    backgroundColor: "var(--bg)",
    textAlign: "center",
    padding: "13px 8px",
    font: "12px/1.5 ui-monospace,\n    monospace"
  },
  // .ej-landing .flow-map small
  flowMap2: {
    display: "block",
    font: "10px/1.8 ui-monospace,\n    monospace",
    color: "var(--muted)"
  },
  // .ej-landing .wire
  wire: { height: "1px", backgroundColor: "var(--border)", position: "relative" },
  // .ej-landing .wire > span
  wire2: {
    position: "absolute",
    right: "-1px",
    top: "-12px",
    color: "var(--accent)",
    fontSize: "16px"
  },
  // .ej-landing .request-node, .ej-landing .queue-node, .ej-landing .worker-pair > div, .ej-landing .result-node | .ej-landing .queue-node
  resultNode2: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#506995",
    borderRadius: "5px",
    backgroundColor: "var(--bg)",
    textAlign: "center",
    padding: "13px 8px",
    font: "12px/1.5 ui-monospace,\n    monospace",
    color: "var(--accent)"
  },
  // .ej-landing .queue-lines
  queueLines: { display: "flex", gap: "5px", justifyContent: "center", marginTop: "8px" },
  // .ej-landing .queue-lines i
  queueLines2: {
    width: "20px",
    height: "5px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#506995",
    backgroundColor: "#91b5ff22"
  },
  // .ej-landing .wire | .ej-landing .flow-map > .wire:nth-child(4)
  wire3: {
    height: "1px",
    backgroundColor: "var(--border)",
    position: "relative",
    display: { "@media (max-width: 560px)": "none" }
  },
  // .ej-landing .worker-pair | .ej-landing .worker-pair
  workerPair: {
    display: "grid",
    gap: "8px",
    gridColumn: { "@media (max-width: 560px)": "1" }
  },
  // .ej-landing .request-node, .ej-landing .queue-node, .ej-landing .worker-pair > div, .ej-landing .result-node | .ej-landing .worker-pair > div
  resultNode3: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "5px",
    backgroundColor: "var(--bg)",
    textAlign: "center",
    padding: "10px 12px",
    font: "12px/1.5 ui-monospace,\n    monospace",
    display: "flex",
    justifyContent: "space-between",
    gap: "5px"
  },
  // .ej-landing .worker-pair span
  workerPair2: { color: "var(--muted)", fontSize: "10px" },
  // .ej-landing .worker-pair [data-busy="true"] span
  workerPairSelected: { color: "var(--accent)" },
  // .ej-landing .request-node, .ej-landing .queue-node, .ej-landing .worker-pair > div, .ej-landing .result-node | .ej-landing .result-node | .ej-landing .result-node
  resultNode4: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "5px",
    backgroundColor: "var(--bg)",
    textAlign: "center",
    padding: "13px 8px",
    font: "12px/1.5 ui-monospace,\n    monospace",
    color: "var(--success)",
    fontSize: "20px",
    gridColumn: { "@media (max-width: 560px)": "3" }
  },
  // .ej-landing .retry-wire | .ej-landing .retry-wire
  retryWire: {
    position: "absolute",
    left: { default: "28%", "@media (max-width: 560px)": "6%" },
    right: { default: "19%", "@media (max-width: 560px)": "6%" },
    bottom: { default: "18px", "@media (max-width: 560px)": "15px" },
    textAlign: "center",
    borderBottomWidth: "1px",
    borderBottomStyle: "dashed",
    borderBottomColor: "#766447",
    color: "var(--warning)",
    font: "13px/1.8 ui-monospace,\n    monospace"
  },
  // .ej-landing .retry-wire span | .ej-landing .retry-wire span
  retryWire2: {
    fontSize: { default: "9px", "@media (max-width: 560px)": "8px" },
    letterSpacing: "0.3px",
    backgroundColor: "var(--surface)",
    padding: "0 8px"
  },
  // .ej-landing .job-and-code | .ej-landing .job-and-code
  jobAndCode: {
    display: "grid",
    gridTemplateColumns: { default: "1fr 1.04fr", "@media (max-width: 850px)": "1fr" },
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "6px",
    overflow: "hidden"
  },
  // .ej-landing .jobs
  jobs: { backgroundColor: "#0d1118" },
  // .ej-landing .panel-label | .ej-landing .jobs > .panel-label | .ej-landing .panel-label
  panelLabel: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    color: "var(--muted)",
    font: "9px/1.7 ui-monospace,\n    monospace",
    letterSpacing: "0.6px",
    padding: "12px 15px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "var(--border)",
    paddingInline: { "@media (max-width: 560px)": "10px" },
    fontSize: { "@media (max-width: 560px)": "8px" }
  },
  // .ej-landing button, .ej-landing a | .ej-landing .job | .ej-landing .job:last-child | .ej-landing .job:hover:not(:disabled) | .ej-landing .job:focus-visible | .ej-landing .job:disabled | .ej-landing .job
  element2: {
    WebkitTapHighlightColor: "transparent",
    width: "100%",
    display: "flex",
    gap: { default: "11px", "@media (max-width: 560px)": "8px" },
    alignItems: "center",
    borderWidth: "0",
    borderStyle: "none",
    borderColor: "currentColor",
    borderBottomWidth: "0",
    borderBottomStyle: "none",
    borderBottomColor: "currentColor",
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": "#91b5ff16" },
    padding: { default: "14px", "@media (max-width: 560px)": "12px 8px" },
    color: "var(--text)",
    textAlign: "left",
    font: "inherit",
    cursor: { default: "pointer", ":disabled": "default" },
    minHeight: "67px",
    outlineOffset: { ":focus-visible": "-4px" },
    opacity: { ":disabled": "1" }
  },
  // .ej-landing .job[aria-pressed="true"]
  jobSelected: {
    backgroundColor: "#91b5ff0d",
    boxShadow: "inset 2px 0 var(--accent)"
  },
  // .ej-landing .job-number
  jobNumber: { font: "10px/1 ui-monospace,\n    monospace", color: "var(--muted)" },
  // .ej-landing .job-title | .ej-landing .job-title
  jobTitle: {
    fontSize: { default: "12px", "@media (max-width: 560px)": "11px" },
    lineHeight: "1.5"
  },
  // .ej-landing .job-title small | .ej-landing .job-title small
  jobTitle2: {
    display: "block",
    fontSize: { default: "10px", "@media (max-width: 560px)": "9px" },
    color: "var(--muted)",
    marginTop: "3px",
    maxWidth: { "@media (max-width: 560px)": "135px" }
  },
  // .ej-landing .state | .ej-landing .state
  state: {
    marginLeft: "auto",
    font: "9px/1.5 ui-monospace,\n    monospace",
    color: "var(--muted)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    padding: { default: "3px 6px", "@media (max-width: 560px)": "3px 4px" },
    borderRadius: "3px",
    whiteSpace: "nowrap",
    fontSize: { "@media (max-width: 560px)": "8px" }
  },
  // .ej-landing .code-panel | .ej-landing .code-panel
  codePanel: {
    borderLeftWidth: { default: "1px", "@media (max-width: 850px)": "0" },
    borderLeftStyle: { default: "solid", "@media (max-width: 850px)": "none" },
    borderLeftColor: {
      default: "var(--border)",
      "@media (max-width: 850px)": "currentColor"
    },
    backgroundColor: "var(--bg)",
    display: "flex",
    flexDirection: "column",
    minWidth: "0",
    borderTopWidth: { "@media (max-width: 850px)": "1px" },
    borderTopStyle: { "@media (max-width: 850px)": "solid" },
    borderTopColor: { "@media (max-width: 850px)": "var(--border)" }
  },
  // .ej-landing .panel-label | .ej-landing .code-panel .panel-label | .ej-landing .panel-label
  panelLabel2: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    color: "var(--muted)",
    font: "9px/1.7 ui-monospace,\n    monospace",
    letterSpacing: "0.6px",
    padding: "12px 15px",
    flexWrap: "wrap",
    paddingInline: { "@media (max-width: 560px)": "10px" },
    fontSize: { "@media (max-width: 560px)": "8px" }
  },
  // .ej-landing pre | .ej-landing .code-panel pre | .ej-landing .code-panel pre
  element3: {
    overflowX: "auto",
    margin: "5px 0 0",
    padding: "12px 18px",
    color: "var(--accent)",
    font: "11px/1.9 ui-monospace,\n    SFMono-Regular,\n    Consolas,\n    monospace",
    minHeight: "170px",
    maxHeight: "235px",
    overflow: "auto"
  },
  // .ej-landing code
  element4: { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" },
  // .ej-landing .code-panel p
  codePanel2: {
    margin: "0",
    padding: "5px 18px 10px",
    fontSize: "11px",
    color: "var(--muted)"
  },
  // .ej-landing a | .ej-landing a:hover | .ej-landing button, .ej-landing a | .ej-landing .code-panel a
  element5: {
    color: "var(--accent)",
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    padding: "0 18px 15px",
    fontSize: "11px",
    marginTop: "auto"
  },
  // .ej-landing .playback | .ej-landing .playback
  playback: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    padding: "14px 0",
    flexWrap: { "@media (max-width: 560px)": "wrap" }
  },
  // .ej-landing .playback-buttons
  playbackButtons: { display: "flex", flexWrap: "wrap", gap: "8px" },
  // .ej-landing button, .ej-landing a | .ej-landing .playback button | .ej-landing .playback button:disabled | .ej-landing .playback button:hover:not(:disabled) | .ej-landing .playback button
  element6: {
    WebkitTapHighlightColor: "transparent",
    backgroundColor: "var(--bg)",
    color: { default: "var(--text)", ":disabled": "var(--muted)" },
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { ":hover:not(:disabled)": "var(--accent)" },
    borderRadius: "4px",
    padding: { default: "8px 13px", "@media (max-width: 560px)": "9px 11px" },
    cursor: { default: "pointer", ":disabled": "default" },
    font: "11px/1.4 ui-monospace,\n    monospace",
    minHeight: { default: "36px", "@media (max-width: 560px)": "44px" }
  },
  // .ej-landing .sr-only
  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: "0",
    borderStyle: "none",
    borderColor: "currentColor"
  },
  // .ej-landing .system-footnote | .ej-landing .system-footnote
  systemFootnote: {
    display: "flex",
    gap: "8px",
    alignItems: "baseline",
    padding: { default: "12px 24px", "@media (max-width: 560px)": "12px" },
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "var(--border)",
    color: "var(--muted)",
    fontSize: { default: "10px", "@media (max-width: 560px)": "9px" }
  },
  // .ej-landing .system-footnote > span
  systemFootnote2: { color: "var(--accent)", fontSize: "7px" },
  // .ej-landing .no-script
  noScript: { padding: "0 24px 12px", fontSize: "12px", color: "var(--muted)" },
  // .ej-landing | .ej-landing :focus-visible
  element7: {
    margin: "0",
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    colorScheme: "dark",
    font: '16px/1.65 ui-sans-serif,\n    system-ui,\n    -apple-system,\n    BlinkMacSystemFont,\n    "Segoe UI",\n    sans-serif',
    WebkitFontSmoothing: "antialiased",
    outlineWidth: { ":focus-visible": "2px" },
    outlineStyle: { ":focus-visible": "solid" },
    outlineColor: { ":focus-visible": "var(--accent)" },
    outlineOffset: { ":focus-visible": "5px" }
  },
  // .ej-landing [data-state="Active"]
  elementActiveSelected: { color: "var(--accent)", borderColor: "#506995" },
  // .ej-landing [data-state="Completed"]
  elementCompletedSelected: { color: "var(--success)", borderColor: "#345f50" },
  // .ej-landing [data-state="RetryScheduled"]
  elementRetryScheduledSelected: { color: "var(--warning)", borderColor: "#766447" },
  // .ej-landing a | .ej-landing a:hover | .ej-landing button, .ej-landing a | .ej-landing .skip | .ej-landing .skip:not(:focus) | .ej-landing .skip:focus
  element8: {
    color: "var(--bg)",
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    position: "fixed",
    zIndex: "10",
    top: "12px",
    left: "12px",
    transform: { default: "translateY(-160%)", ":focus": "none" },
    backgroundColor: "var(--text)",
    padding: { default: "10px 18px", ":not(:focus)": "0" },
    clipPath: { ":not(:focus)": "inset(50%)" },
    width: { ":not(:focus)": "1px" },
    height: { ":not(:focus)": "1px" },
    overflow: { ":not(:focus)": "hidden" }
  },
  // .ej-landing .wrap | .ej-landing .site-header | .ej-landing .wrap | .ej-landing .site-header
  wrap: {
    width: {
      default: "min(1184px, calc(100% - 64px))",
      "@media (max-width: 850px)": "calc(100% - 36px)"
    },
    marginInline: "auto",
    display: "flex",
    alignItems: "center",
    gap: { default: "38px", "@media (max-width: 560px)": "12px" },
    minHeight: { default: "96px", "@media (max-width: 560px)": "78px" },
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "var(--border)",
    flexWrap: { "@media (max-width: 560px)": "wrap" }
  },
  // .ej-landing a | .ej-landing a:hover | .ej-landing button, .ej-landing a | .ej-landing .wordmark | .ej-landing .wordmark
  element9: {
    color: { default: "inherit", ":hover": "var(--accent)" },
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    display: "inline-flex",
    alignItems: "center",
    gap: "11px",
    fontSize: { default: "20px", "@media (max-width: 560px)": "17px" },
    fontWeight: "650",
    letterSpacing: "-0.8px"
  },
  // .ej-landing .mark
  mark: {
    font: "700 23px/1 ui-monospace,\n    monospace",
    letterSpacing: "-5px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    padding: "5px 9px 8px 5px",
    borderRadius: "8px"
  },
  // .ej-landing nav | .ej-landing nav
  element10: {
    display: "flex",
    gap: { default: "28px", "@media (max-width: 560px)": "16px" },
    marginLeft: "auto",
    fontSize: { default: "14px", "@media (max-width: 560px)": "12px" },
    color: "var(--muted)"
  },
  // .ej-landing a | .ej-landing a:hover | .ej-landing button, .ej-landing a
  element11: {
    color: { default: "inherit", ":hover": "var(--accent)" },
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent"
  },
  // .ej-landing .alpha | .ej-landing .alpha
  alpha: {
    color: "var(--accent)",
    font: "10px/1.5 ui-monospace,\n    monospace",
    letterSpacing: "1.1px",
    padding: "5px 9px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "4px",
    display: { "@media (max-width: 560px)": "none" }
  },
  // .ej-landing .wrap | .ej-landing .hero | .ej-landing .wrap | .ej-landing .hero
  hero: {
    width: {
      default: "min(1184px, calc(100% - 64px))",
      "@media (max-width: 850px)": "calc(100% - 36px)"
    },
    marginInline: "auto",
    paddingTop: { default: "75px", "@media (max-width: 850px)": "50px" },
    textAlign: "center",
    position: "relative"
  },
  // .ej-landing .eyebrow | .ej-landing .hero > .eyebrow | .ej-landing .hero > .eyebrow
  eyebrow: {
    font: "11px/1.6 ui-monospace,\n    SFMono-Regular,\n    Consolas,\n    monospace",
    letterSpacing: { default: "1.8px", "@media (max-width: 560px)": "1px" },
    color: "var(--accent)",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    justifyContent: "center",
    fontSize: { "@media (max-width: 560px)": "9px" }
  },
  // .ej-landing h1 | .ej-landing h1
  element12: {
    fontSize: {
      default: "clamp(43px, 5.5vw, 76px)",
      "@media (max-width: 560px)": "clamp(36px, 9.3vw, 49px)"
    },
    lineHeight: "1.1",
    fontWeight: "580",
    letterSpacing: { default: "-4px", "@media (max-width: 560px)": "-2px" },
    margin: "24px 0"
  },
  // .ej-landing .hero-copy | .ej-landing .hero-copy
  heroCopy: {
    maxWidth: "650px",
    margin: "0 auto",
    color: "var(--muted)",
    fontSize: { default: "18px", "@media (max-width: 560px)": "15px" },
    lineHeight: "1.75"
  },
  // .ej-landing .actions | .ej-landing .actions
  actions: {
    display: "flex",
    gap: { default: "14px", "@media (max-width: 560px)": "10px" },
    justifyContent: "center",
    marginTop: "30px",
    flexDirection: { "@media (max-width: 560px)": "column" }
  },
  // .ej-landing a | .ej-landing a:hover | .ej-landing button, .ej-landing a | .ej-landing .primary, .ej-landing .secondary | .ej-landing .primary | .ej-landing .primary:hover
  element13: {
    color: { default: "#090b10", ":hover": "#090b10" },
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "22px",
    borderRadius: "5px",
    padding: "12px 20px",
    fontSize: "14px",
    fontWeight: "600",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--accent)",
    backgroundColor: { default: "var(--accent)", ":hover": "#b0caff" }
  },
  // .ej-landing a | .ej-landing a:hover | .ej-landing button, .ej-landing a | .ej-landing .primary, .ej-landing .secondary | .ej-landing .secondary
  element14: {
    color: { default: "inherit", ":hover": "var(--accent)" },
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "22px",
    borderRadius: "5px",
    padding: "12px 20px",
    fontSize: "14px",
    fontWeight: "600",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    backgroundColor: "var(--surface)"
  },
  // .ej-landing .hero-note | .ej-landing .hero-note
  heroNote: {
    margin: "15px 0 40px",
    fontSize: { default: "12px", "@media (max-width: 560px)": "10px" },
    color: "var(--muted)",
    marginBottom: { "@media (max-width: 560px)": "28px" }
  },
  // .ej-landing .wrap | .ej-landing .stack-strip | .ej-landing .wrap | .ej-landing .stack-strip
  wrap2: {
    width: {
      default: "min(1184px, calc(100% - 64px))",
      "@media (max-width: 850px)": "calc(100% - 36px)"
    },
    marginInline: "auto",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: { default: "space-between", "@media (max-width: 560px)": "center" },
    gap: { default: "20px", "@media (max-width: 560px)": "16px" },
    padding: "35px 0",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "var(--border)",
    color: "var(--muted)",
    fontSize: { default: "13px", "@media (max-width: 560px)": "11px" },
    paddingBlock: { "@media (max-width: 560px)": "25px" }
  },
  // .ej-landing .stack-strip > span | .ej-landing .stack-strip > span
  stackStrip: {
    font: "9px/1.5 ui-monospace,\n    monospace",
    letterSpacing: "1px",
    width: { "@media (max-width: 560px)": "100%" },
    textAlign: { "@media (max-width: 560px)": "center" }
  },
  // .ej-landing .stack-strip strong
  stackStrip2: { fontWeight: "500" },
  // .ej-landing .stack-strip i | .ej-landing .stack-strip i
  stackStrip3: {
    fontStyle: "normal",
    color: "#526075",
    display: { "@media (max-width: 560px)": "none" }
  },
  // .ej-landing .wrap | .ej-landing .section | .ej-landing .atomic | .ej-landing .wrap | .ej-landing .atomic | .ej-landing .section | .ej-landing .atomic,   .ej-landing .principles
  atomic: {
    width: {
      default: "min(1184px, calc(100% - 64px))",
      "@media (max-width: 850px)": "calc(100% - 36px)"
    },
    marginInline: "auto",
    paddingBlock: { default: "92px", "@media (max-width: 850px)": "60px" },
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "var(--border)",
    display: "grid",
    gridTemplateColumns: { default: "1fr 1fr", "@media (max-width: 560px)": "1fr" },
    gap: {
      default: "90px",
      "@media (max-width: 850px)": "35px",
      "@media (max-width: 560px)": "30px"
    },
    alignItems: "center"
  },
  // .ej-landing .eyebrow
  eyebrow2: {
    font: "11px/1.6 ui-monospace,\n    SFMono-Regular,\n    Consolas,\n    monospace",
    letterSpacing: "1.8px",
    color: "var(--accent)",
    display: "flex",
    alignItems: "center",
    gap: "10px"
  },
  // .ej-landing h2 | .ej-landing h2
  element15: {
    fontSize: {
      default: "clamp(29px, 3.5vw, 43px)",
      "@media (max-width: 560px)": "31px"
    },
    lineHeight: "1.22",
    fontWeight: "530",
    letterSpacing: "-1.7px",
    margin: "18px 0 22px"
  },
  // .ej-landing .atomic p:not(.eyebrow), .ej-landing .section-heading p, .ej-landing .finish p:not(.eyebrow)
  eyebrow3: { color: "var(--muted)", fontSize: "15px", maxWidth: "500px" },
  // .ej-landing a | .ej-landing a:hover | .ej-landing button, .ej-landing a | .ej-landing .text-link
  element16: {
    color: "var(--accent)",
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    display: "inline-block",
    marginTop: "12px",
    fontSize: "13px"
  },
  // .ej-landing .transaction-card
  transactionCard: {
    backgroundColor: "var(--surface)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "7px"
  },
  // .ej-landing .status-dot
  statusDot: { color: "var(--success)" },
  // .ej-landing .transaction-card ol
  transactionCard2: { listStyle: "none", padding: "8px 22px", margin: "0" },
  // .ej-landing .transaction-card li
  transactionCard3: {
    display: "flex",
    alignItems: "center",
    gap: "17px",
    padding: "14px 0"
  },
  // .ej-landing .transaction-card li > span
  transactionCard4: {
    color: "var(--accent)",
    font: "11px/1.5 ui-monospace,\n    monospace",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border)",
    padding: "8px",
    borderRadius: "4px"
  },
  // .ej-landing .transaction-card strong
  transactionCard5: { fontSize: "13px", fontWeight: "500" },
  // .ej-landing .transaction-card small
  transactionCard6: { display: "block", color: "var(--muted)", fontSize: "11px" },
  // .ej-landing .identity
  identity: {
    padding: "15px 22px 20px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "var(--border)"
  },
  // .ej-landing .identity > span
  identity2: {
    color: "var(--accent)",
    font: "9px/1.5 ui-monospace,\n    monospace",
    letterSpacing: "1px"
  },
  // .ej-landing .atomic p:not(.eyebrow), .ej-landing .section-heading p, .ej-landing .finish p:not(.eyebrow) | .ej-landing .identity p
  eyebrow4: {
    color: "var(--muted)",
    fontSize: "12px",
    maxWidth: "500px",
    margin: "8px 0"
  },
  // .ej-landing a | .ej-landing a:hover | .ej-landing button, .ej-landing a | .ej-landing .identity a
  element17: {
    color: "var(--accent)",
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    fontSize: "11px"
  },
  // .ej-landing .wrap | .ej-landing .section | .ej-landing .wrap | .ej-landing .section
  wrap3: {
    width: {
      default: "min(1184px, calc(100% - 64px))",
      "@media (max-width: 850px)": "calc(100% - 36px)"
    },
    marginInline: "auto",
    paddingBlock: { default: "92px", "@media (max-width: 850px)": "60px" },
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "var(--border)"
  },
  // .ej-landing .section-heading | .ej-landing .section-heading
  sectionHeading: {
    display: { default: "flex", "@media (max-width: 560px)": "block" },
    alignItems: "center",
    justifyContent: "space-between",
    gap: "50px"
  },
  // .ej-landing .atomic p:not(.eyebrow), .ej-landing .section-heading p, .ej-landing .finish p:not(.eyebrow) | .ej-landing .section-heading p
  eyebrow5: { color: "var(--muted)", fontSize: "15px", maxWidth: "340px" },
  // .ej-landing .principles | .ej-landing .principles | .ej-landing .atomic,   .ej-landing .principles
  principles: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(3, 1fr)",
      "@media (max-width: 560px)": "1fr"
    },
    gap: {
      default: "36px",
      "@media (max-width: 850px)": "22px",
      "@media (max-width: 560px)": "30px"
    },
    marginTop: "32px"
  },
  // .ej-landing .principles article
  principles2: {
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "var(--border)",
    paddingTop: "24px"
  },
  // .ej-landing .principle-icon
  principleIcon: {
    color: "var(--accent)",
    display: "inline-block",
    font: "20px/1.5 ui-monospace,\n    monospace"
  },
  // .ej-landing .principles h3
  principles3: { fontSize: "17px", fontWeight: "550", marginBottom: "10px" },
  // .ej-landing .principles p
  principles4: { color: "var(--muted)", fontSize: "13px" },
  // .ej-landing a | .ej-landing a:hover | .ej-landing button, .ej-landing a | .ej-landing .principles a
  element18: {
    color: "var(--accent)",
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    fontSize: "12px"
  },
  // .ej-landing .wrap | .ej-landing .section | .ej-landing .finish | .ej-landing .wrap | .ej-landing .section | .ej-landing .finish
  wrap4: {
    width: {
      default: "min(1184px, calc(100% - 64px))",
      "@media (max-width: 850px)": "calc(100% - 36px)"
    },
    marginInline: "auto",
    paddingBlock: { default: "92px", "@media (max-width: 850px)": "60px" },
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "var(--border)",
    display: { default: "flex", "@media (max-width: 850px)": "block" },
    alignItems: "center",
    justifyContent: "space-between",
    gap: "40px"
  },
  // .ej-landing a | .ej-landing a:hover | .ej-landing button, .ej-landing a | .ej-landing .primary, .ej-landing .secondary | .ej-landing .primary | .ej-landing .primary:hover | .ej-landing .finish .primary | .ej-landing .finish .primary
  element19: {
    color: { default: "#090b10", ":hover": "#090b10" },
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "22px",
    borderRadius: "5px",
    padding: "12px 20px",
    fontSize: "14px",
    fontWeight: "600",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--accent)",
    backgroundColor: { default: "var(--accent)", ":hover": "#b0caff" },
    flexShrink: "0",
    marginTop: { "@media (max-width: 850px)": "18px" }
  },
  // .ej-landing .wrap | .ej-landing footer | .ej-landing .wrap | .ej-landing footer
  wrap5: {
    width: {
      default: "min(1184px, calc(100% - 64px))",
      "@media (max-width: 850px)": "calc(100% - 36px)"
    },
    marginInline: "auto",
    paddingBlock: "30px",
    display: "flex",
    alignItems: "center",
    gap: { default: "26px", "@media (max-width: 560px)": "12px 20px" },
    flexWrap: { "@media (max-width: 560px)": "wrap" }
  },
  // .ej-landing footer p | .ej-landing footer p
  element20: {
    color: "var(--muted)",
    fontSize: "12px",
    order: { "@media (max-width: 560px)": "3" },
    width: { "@media (max-width: 560px)": "100%" },
    margin: { "@media (max-width: 560px)": "0" }
  },
  // .ej-landing a | .ej-landing a:hover | .ej-landing button, .ej-landing a | .ej-landing footer > a:last-child
  element21: {
    color: "var(--muted)",
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    marginLeft: "auto",
    fontSize: "12px"
  }
})
