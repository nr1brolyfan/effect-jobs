import * as stylex from "@stylexjs/stylex"

// Static component styles. Class hooks remain for behavior tests, not CSS ownership.
export const styles = stylex.create({
  icon: {
    display: "block",
    width: 28,
    height: 28,
    flexShrink: 0,
    color: "var(--node-color, #a5a9b3)",
    margin: 0,
    boxSizing: "border-box"
  },
  databaseIcon: { width: 20, height: 20 },

  root: { display: "block", margin: "2rem 0 2.5rem" },
  // root
  element: { display: "block", margin: "2rem 0 2.5rem" },
  // .jv | .jv
  figure: {
    margin: "0",
    padding: {
      default: "24px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "18px"
    },
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#45404f",
    borderRadius: "9px",
    backgroundColor: "#202023",
    color: "#edecea"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-buttons, .jv-modes | .jv-modes
  modes: {
    margin: "0",
    boxSizing: "border-box",
    display: "flex",
    gap: "7px",
    justifyContent: "center",
    marginBottom: "12px"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv button | .jv button:hover | .jv button:focus-visible | .jv button:disabled | .jv-modes button
  element3: {
    margin: "0",
    boxSizing: "border-box",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: "6px",
    padding: "7px 11px",
    color: "#aaa7b2",
    backgroundColor: { default: "transparent", ":hover": "#2c2933" },
    cursor: { default: "pointer", ":disabled": "default" },
    font: "12px/1.4 var(--sl-font)",
    whiteSpace: "nowrap",
    outlineWidth: { ":focus-visible": "2px" },
    outlineStyle: { ":focus-visible": "solid" },
    outlineColor: { ":focus-visible": "#b5a4d1" },
    outlineOffset: { ":focus-visible": "3px" },
    opacity: { ":disabled": "0.35" }
  },
  // .jv-modes button[aria-pressed="true"]
  modesSelected: {
    color: "#edecea",
    borderColor: "#655871",
    backgroundColor: "#302b38"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-stage | .jv-stage
  stage: {
    margin: "0",
    boxSizing: "border-box",
    position: "relative",
    display: "grid",
    alignItems: "center",
    gap: {
      default: "36px 52px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "38px 24px"
    },
    minWidth: "0",
    minHeight: "290px"
  },
  // .jv-overview
  overviewSelected: {
    gridTemplateColumns: "1fr 1.55fr 1fr",
    gridTemplateRows: "1fr 1fr"
  },
  // .jv-transaction
  transactionSelected: { gridTemplateColumns: "1.8fr 1fr", gap: "80px" },
  // .jv-handoff
  handoffSelected: { gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr" },
  // .jv-overview
  overviewSelected2: {
    gridTemplateColumns: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "1fr 1fr"
    },
    gridTemplateRows: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "auto auto"
    }
  },
  // .jv-handoff
  handoffSelected2: {
    gridTemplateColumns: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "1fr 1fr"
    },
    gridTemplateRows: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)":
        "auto auto auto"
    }
  },
  // .jv-transaction
  transactionSelected2: {
    gridTemplateColumns: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "1fr"
    },
    gap: {
      default: "36px 52px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "38px"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-wires
  wires: {
    margin: "0",
    boxSizing: "border-box",
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    overflow: "visible",
    pointerEvents: "none",
    zIndex: "0"
  },
  // Connection colors come from SVG presentation attributes in JobVisual.
  wire: { fill: "none", strokeWidth: "1.4" },
  // .jv-packet rect
  packet: { fill: "#131519", strokeWidth: "1.2" },
  // .jv-packet text
  packet2: {
    font: "10px var(--sl-font-mono)",
    textAnchor: "middle",
    dominantBaseline: "central"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-node, .jv-database | .jv-node | .jv-api | .jv-api | .jv-node
  database: {
    margin: "0",
    boxSizing: "border-box",
    position: "relative",
    zIndex: "1",
    minWidth: "0",
    backgroundColor: "#27262c",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#51485e",
    borderRadius: "10px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: "9px",
    padding: "16px",
    minHeight: "124px",
    transition: {
      default: "border-color 180ms,\n    background-color 180ms,\n    opacity 180ms",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    gridColumn: {
      default: "1",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "1"
    },
    gridRow: {
      default: "1 / 3",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "1"
    }
  },
  // .jv-node[data-active="true"]
  nodeSelected: {
    borderColor: "var(--node-color)",
    backgroundColor: "color-mix(in srgb, var(--node-color) 7%, #202023)"
  },
  // .jv-overview .jv-node
  nodeSelected2: {
    minHeight: {
      default: "124px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "126px"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv strong
  element4: {
    margin: "0",
    boxSizing: "border-box",
    font: "550 13px/1.4 var(--sl-font)",
    color: "#edecea"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv code
  element5: {
    margin: "0",
    boxSizing: "border-box",
    padding: "0",
    borderWidth: "0",
    borderStyle: "none",
    borderColor: "currentColor",
    backgroundColor: "transparent",
    color: "#c5b6dd",
    font: "14px/1.5 var(--sl-font-mono)",
    overflowWrap: "anywhere"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-status
  status: {
    margin: "0",
    boxSizing: "border-box",
    color: "#aaa7b2",
    font: "14px/1.4 var(--sl-font-mono)",
    whiteSpace: "normal",
    overflowWrap: "anywhere"
  },
  // .jv-status[data-done="true"], .jv-check
  checkSelected: { color: "var(--jv-green)" },
  // .jv :where(div, span, code, strong, button, svg) | .jv-node, .jv-database
  database2: {
    margin: "0",
    boxSizing: "border-box",
    position: "relative",
    zIndex: "1",
    minWidth: "0",
    backgroundColor: "#27262c",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#51485e",
    borderRadius: "10px"
  },
  // .jv-overview .jv-database
  databaseSelected: { gridColumn: "2", gridRow: "1 / 3" },
  // .jv-overview .jv-database
  databaseSelected2: {
    gridColumn: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "2"
    },
    gridRow: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "1"
    }
  },
  // .jv-overview .jv-database
  databaseSelected3: {
    alignSelf: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "stretch"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-db-title | .jv-db-title
  dbTitle: {
    margin: "0",
    boxSizing: "border-box",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: {
      default: "10px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "6px"
    },
    padding: {
      default: "16px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "12px 10px"
    },
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "#45404f"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-table | .jv-table
  table: {
    margin: "0",
    boxSizing: "border-box",
    padding: {
      default: "12px 12px 4px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)":
        "10px 7px 3px"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-table > span
  table2: {
    margin: "0",
    boxSizing: "border-box",
    display: "block",
    padding: "0 4px 7px",
    color: "#aaa7b2",
    font: "14px/1.3 var(--sl-font-mono)"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-row | .jv-row
  row: {
    margin: "0",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: {
      default: "8px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "4px 8px"
    },
    minHeight: "39px",
    overflowWrap: "anywhere",
    padding: {
      default: "9px 11px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "8px"
    },
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#45404f",
    borderRadius: "5px",
    font: "14px/1.4 var(--sl-font-mono)",
    flexWrap: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "wrap"
    }
  },
  // .jv-row[data-active="true"]
  rowSelected: { borderColor: "var(--node-color, var(--jv-green))" },
  // .jv :where(div, span, code, strong, button, svg)
  element6: { margin: "0", boxSizing: "border-box" },
  // .jv :where(div, span, code, strong, button, svg) | .jv-status[data-done="true"], .jv-check | .jv-row > :last-child | .jv-check
  check: {
    margin: "0",
    boxSizing: "border-box",
    color: "var(--jv-green)",
    marginLeft: "auto",
    fontSize: "13px"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-table | .jv-table:last-child | .jv-table
  table3: {
    margin: "0",
    boxSizing: "border-box",
    padding: {
      default: "12px 12px 4px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)":
        "10px 7px 3px"
    },
    paddingBottom: "12px"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-status | .jv-row > :last-child
  status2: {
    margin: "0",
    boxSizing: "border-box",
    color: "#aaa7b2",
    font: "14px/1.4 var(--sl-font-mono)",
    whiteSpace: "normal",
    marginLeft: "auto"
  },
  // .jv-overview .jv-table:last-child .jv-row > :last-child
  rowSelected2: {
    flexBasis: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "100%"
    },
    marginLeft: {
      default: "auto",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "0"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-node, .jv-database | .jv-node | .jv-worker | .jv-worker | .jv-node
  database3: {
    margin: "0",
    boxSizing: "border-box",
    position: "relative",
    zIndex: "1",
    minWidth: "0",
    backgroundColor: "#27262c",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#51485e",
    borderRadius: "10px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: "9px",
    padding: "16px",
    minHeight: "124px",
    transition: {
      default: "border-color 180ms,\n    background-color 180ms,\n    opacity 180ms",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    gridColumn: {
      default: "3",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "2"
    },
    gridRow: {
      default: "1",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "2"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-node, .jv-database | .jv-node | .jv-email | .jv-email | .jv-node
  database4: {
    margin: "0",
    boxSizing: "border-box",
    position: "relative",
    zIndex: "1",
    minWidth: "0",
    backgroundColor: "#27262c",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#51485e",
    borderRadius: "10px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: "9px",
    padding: "16px",
    minHeight: "124px",
    transition: {
      default: "border-color 180ms,\n    background-color 180ms,\n    opacity 180ms",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    gridColumn: {
      default: "3",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "1"
    },
    gridRow: {
      default: "2",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "2"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-node, .jv-database | .jv-transaction-box
  database5: {
    margin: "0",
    boxSizing: "border-box",
    position: "relative",
    zIndex: "1",
    minWidth: "0",
    backgroundColor: "#27262c",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#51485e",
    borderRadius: "10px",
    paddingBottom: "14px"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-boundary
  boundary: {
    margin: "14px",
    boxSizing: "border-box",
    padding: "12px",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: "#606573",
    borderRadius: "7px"
  },
  // .jv-boundary[data-result="commit"]
  boundaryCommitSelected: { borderColor: "var(--jv-green)" },
  // .jv-boundary[data-result="rollback"]
  boundaryRollbackSelected: { borderColor: "#e7a092" },
  // .jv :where(div, span, code, strong, button, svg) | .jv-boundary-title
  boundaryTitle: {
    margin: "0",
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    marginBottom: "12px",
    color: "#aaa7b2",
    font: "10px/1.5 var(--sl-font-mono)"
  },
  // .jv-boundary[data-result="rollback"] .jv-boundary-title > :last-child
  boundaryTitleRollbackSelected: { color: "#e7a092" },
  // .jv-boundary[data-result="staged"] .jv-row[data-active="true"]
  rowStagedSelected: { borderStyle: "dashed", borderColor: "#727b8c" },
  // .jv :where(div, span, code, strong, button, svg) | .jv-row | .jv-boundary .jv-row + .jv-row | .jv-row
  row2: {
    margin: "0",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: {
      default: "8px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "4px 8px"
    },
    minHeight: "39px",
    padding: {
      default: "9px 11px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "8px"
    },
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#45404f",
    borderRadius: "5px",
    font: "14px/1.4 var(--sl-font-mono)",
    marginTop: "10px",
    flexWrap: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "wrap"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-node, .jv-database | .jv-node | .jv-transaction-worker | .jv-node
  database6: {
    margin: "0",
    boxSizing: "border-box",
    position: "relative",
    zIndex: "1",
    minWidth: "0",
    backgroundColor: "#27262c",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#51485e",
    borderRadius: "10px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: "9px",
    padding: "16px",
    minHeight: "124px",
    transition: {
      default: "border-color 180ms,\n    background-color 180ms,\n    opacity 180ms",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    justifySelf: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "end"
    },
    width: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "145px"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-node, .jv-database | .jv-node | .jv-origin | .jv-origin | .jv-node
  database7: {
    margin: "0",
    boxSizing: "border-box",
    position: "relative",
    zIndex: "1",
    minWidth: {
      default: "0",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "145px"
    },
    backgroundColor: "#27262c",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#51485e",
    borderRadius: "10px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: "9px",
    padding: "16px",
    minHeight: "124px",
    transition: {
      default: "border-color 180ms,\n    background-color 180ms,\n    opacity 180ms",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    gridColumn: {
      default: "1",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "1 / 3"
    },
    gridRow: {
      default: "1 / 3",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "1"
    },
    justifySelf: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "center"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-node, .jv-database | .jv-node | .jv-confirmation | .jv-confirmation | .jv-node
  database8: {
    margin: "0",
    boxSizing: "border-box",
    position: "relative",
    zIndex: "1",
    minWidth: "0",
    backgroundColor: "#27262c",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#51485e",
    borderRadius: "10px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: "9px",
    padding: "16px",
    minHeight: "124px",
    transition: {
      default: "border-color 180ms,\n    background-color 180ms,\n    opacity 180ms",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    gridColumn: {
      default: "2",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "1"
    },
    gridRow: {
      default: "1",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "2"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-node, .jv-database | .jv-node | .jv-invoice | .jv-invoice | .jv-node
  database9: {
    margin: "0",
    boxSizing: "border-box",
    position: "relative",
    zIndex: "1",
    minWidth: "0",
    backgroundColor: "#27262c",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#51485e",
    borderRadius: "10px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: "9px",
    padding: "16px",
    minHeight: "124px",
    transition: {
      default: "border-color 180ms,\n    background-color 180ms,\n    opacity 180ms",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    gridColumn: {
      default: "2",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "2"
    },
    gridRow: {
      default: "2",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "2"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-node, .jv-database | .jv-node | .jv-delivery | .jv-delivery | .jv-node
  database10: {
    margin: "0",
    boxSizing: "border-box",
    position: "relative",
    zIndex: "1",
    minWidth: "0",
    backgroundColor: "#27262c",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#51485e",
    borderRadius: "10px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: "9px",
    padding: "16px",
    minHeight: "124px",
    transition: {
      default: "border-color 180ms,\n    background-color 180ms,\n    opacity 180ms",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    gridColumn: {
      default: "3",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "2"
    },
    gridRow: {
      default: "2",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "3"
    }
  },
  // .jv-node[data-dim="true"]
  nodeSelected3: { opacity: "0.4" },
  // .jv :where(div, span, code, strong, button, svg) | .jv-controls | .jv-controls
  controls: {
    margin: "0",
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "space-between",
    alignItems: {
      default: "center",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)":
        "flex-start"
    },
    gap: {
      default: "12px",
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "14px"
    },
    marginTop: "24px",
    minHeight: "34px",
    flexDirection: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "column"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-progress
  progress: {
    margin: "0",
    boxSizing: "border-box",
    color: "#aaa7b2",
    font: "14px/1.4 var(--sl-font-mono)"
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv-buttons, .jv-modes | .jv-buttons
  modes2: {
    margin: "0",
    boxSizing: "border-box",
    display: "flex",
    gap: "7px",
    alignSelf: {
      "@media (max-width: 1100px) and (min-width: 800px), (max-width: 600px)": "center"
    }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv button | .jv button:hover | .jv button:focus-visible | .jv button:disabled | .jv button.jv-step | .jv button.jv-step:hover
  element7: {
    margin: "0",
    boxSizing: "border-box",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#c6b8df",
    borderRadius: "6px",
    padding: "7px 11px",
    color: "#201d27",
    backgroundColor: { default: "#c6b8df", ":hover": "#b5a4d1" },
    cursor: { default: "pointer", ":disabled": "default" },
    font: "12px/1.4 var(--sl-font)",
    whiteSpace: "nowrap",
    outlineWidth: { ":focus-visible": "2px" },
    outlineStyle: { ":focus-visible": "solid" },
    outlineColor: { ":focus-visible": "#b5a4d1" },
    outlineOffset: { ":focus-visible": "3px" },
    opacity: { ":disabled": "0.35" }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv button | .jv button:hover | .jv button:focus-visible | .jv button:disabled | .jv .jv-play
  element8: {
    margin: "0",
    boxSizing: "border-box",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { ":hover": "#646a77" },
    borderRadius: "6px",
    padding: "7px 11px",
    color: "#edecea",
    backgroundColor: { default: "transparent", ":hover": "#2c2933" },
    cursor: { default: "pointer", ":disabled": "default" },
    font: "12px/1.4 var(--sl-font)",
    whiteSpace: "nowrap",
    outlineWidth: { ":focus-visible": "2px" },
    outlineStyle: { ":focus-visible": "solid" },
    outlineColor: { ":focus-visible": "#b5a4d1" },
    outlineOffset: { ":focus-visible": "3px" },
    opacity: { ":disabled": "0.35" },
    display: { "@media (prefers-reduced-motion: reduce)": "none" }
  },
  // .jv :where(div, span, code, strong, button, svg) | .jv button | .jv button:hover | .jv button:focus-visible | .jv button:disabled | .jv button.jv-reset
  element9: {
    margin: "0",
    boxSizing: "border-box",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { ":hover": "#646a77" },
    borderRadius: "6px",
    padding: "3px 10px",
    color: "#edecea",
    backgroundColor: { default: "transparent", ":hover": "#2c2933" },
    cursor: { default: "pointer", ":disabled": "default" },
    font: "12px/1.4 var(--sl-font)",
    whiteSpace: "nowrap",
    outlineWidth: { ":focus-visible": "2px" },
    outlineStyle: { ":focus-visible": "solid" },
    outlineColor: { ":focus-visible": "#b5a4d1" },
    outlineOffset: { ":focus-visible": "3px" },
    opacity: { ":disabled": "0.35" },
    fontSize: "18px"
  },
  // .jv-static
  static: { margin: "16px 0 0", fontSize: "12px", color: "#aaa7b2" }
})
