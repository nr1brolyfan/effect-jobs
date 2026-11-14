import * as stylex from "@stylexjs/stylex"

// Docs-owned shell styles; the landing and shared application tokens stay fixed.
export const styles = stylex.create({
  ejHeader: {
    containerType: "inline-size",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    height: "100%"
  },
  ejWordmark: {
    display: "flex",
    alignItems: "center",
    gap: { default: "12px", "@container (max-width: 13rem)": "0" },
    color: "#edecea",
    textDecoration: "none",
    fontSize: "19px",
    fontWeight: "650",
    letterSpacing: "-0.6px",
    whiteSpace: "nowrap"
  },
  ejMark: {
    display: "grid",
    gridTemplateColumns: "auto auto",
    placeContent: "center",
    width: "34px",
    height: "34px",
    borderRadius: "9px",
    backgroundColor: "#2c2933",
    color: "#edecea",
    fontFamily: "Georgia, serif",
    fontSize: "25px",
    fontWeight: "400",
    paddingBottom: "3px",
    letterSpacing: "-0.6px"
  },
  ejMark2: { color: "#c9b7f5" },
  ejHeaderDivider: { display: { "@container (max-width: 13rem)": "none" } },
  ejHeaderDivider2: {
    height: "1rem",
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: "#35343a",
    marginLeft: "0.4rem",
    display: {
      "@media (max-width: 49.99rem)": "none",
      "@container (max-width: 13rem)": "none"
    }
  },
  ejDocsLabel: {
    fontSize: "14px",
    fontWeight: "400",
    letterSpacing: "0",
    color: "#aaa7b2",
    display: {
      "@media (max-width: 49.99rem)": "none",
      "@container (max-width: 13rem)": "none"
    }
  },
  ejHeaderTools: {
    display: "flex",
    alignItems: "center",
    gap: {
      default: "2rem",
      "@media (max-width: 49.99rem)": "0",
      "@container (max-width: 36rem)": "0.75rem"
    }
  },
  ejSourceLink: {
    display: {
      default: "inline-flex",
      "@media (max-width: 49.99rem)": "none",
      "@container (max-width: 36rem)": "none"
    },
    gap: "0.4rem",
    whiteSpace: "nowrap",
    alignItems: "center",
    color: "#aaa7b2",
    fontSize: "15px",
    textDecoration: "none"
  },
  ejNavGroup: { marginBottom: "24px" },
  ejNavGroup2: {
    margin: "0 0 8px 12px",
    fontSize: "12px",
    lineHeight: "1.5",
    fontWeight: "550",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#aaa7b2"
  },
  ejNavGroup3: { listStyle: "none", margin: "0", padding: "0" },
  ejNavGroup4: { margin: "2px 0" },
  ejNavGroup5: {
    display: "block",
    padding: "8px 12px",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: "transparent",
    borderRadius: "0 6px 6px 0",
    color: { default: "#aaa7b2", ":hover": "#edecea" },
    textDecoration: "none",
    fontSize: "14px",
    lineHeight: "1.5",
    backgroundColor: { ":hover": "#202023" }
  },
  ejNavGroupSelected: {
    color: "#d0bff1",
    borderLeftColor: "#b5a4d1",
    backgroundColor: "#2c2933"
  },
  ejNavExamples: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: "24px 12px 0",
    paddingTop: "20px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "#35343a",
    fontSize: "14px",
    color: "#c6b8df",
    textDecoration: "none"
  },
  element: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: "var(--sl-text-h1)",
    fontWeight: "400",
    letterSpacing: "-1.5px",
    lineHeight: "1.15",
    marginTop: "0",
    textWrap: "balance",
    overflowWrap: "anywhere"
  }
})
