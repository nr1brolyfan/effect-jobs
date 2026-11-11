import * as stylex from "@stylexjs/stylex"

// Static component styles. Class hooks remain for behavior tests, not CSS ownership.
export const styles = stylex.create({
  // .ej-header
  ejHeader: {
    containerType: "inline-size",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    height: "100%"
  },
  // .ej-wordmark | .ej-wordmark
  ejWordmark: {
    display: "flex",
    alignItems: "center",
    gap: { default: "0.8rem", "@container (max-width: 13rem)": "0" },
    color: "#eeefed",
    textDecoration: "none",
    fontSize: "1.1rem",
    fontWeight: "650",
    letterSpacing: "-0.04em",
    whiteSpace: "nowrap"
  },
  // .ej-mark
  ejMark: {
    display: "grid",
    gridTemplateColumns: "auto auto",
    placeContent: "center",
    width: "1.9rem",
    height: "1.9rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#9fdbbd",
    borderRadius: "0.35rem",
    color: "#b3e6cc",
    fontFamily: "var(--sl-font-mono)",
    fontSize: "1rem",
    letterSpacing: "-0.12em"
  },
  // .ej-mark span
  ejMark2: { transform: "translateY(0.15rem)" },
  // .ej-product,   .ej-docs-label,   .ej-header-divider
  ejHeaderDivider: { display: { "@container (max-width: 13rem)": "none" } },
  // .ej-header-divider | .ej-source-link,   .ej-header-divider,   .ej-docs-label | .ej-product,   .ej-docs-label,   .ej-header-divider
  ejHeaderDivider2: {
    height: "1rem",
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: "#505753",
    marginLeft: "0.4rem",
    display: {
      "@media (max-width: 49.99rem)": "none",
      "@container (max-width: 13rem)": "none"
    }
  },
  // .ej-docs-label | .ej-source-link,   .ej-header-divider,   .ej-docs-label | .ej-product,   .ej-docs-label,   .ej-header-divider
  ejDocsLabel: {
    fontSize: "0.85rem",
    fontWeight: "400",
    letterSpacing: "0",
    color: "#b4bab7",
    display: {
      "@media (max-width: 49.99rem)": "none",
      "@container (max-width: 13rem)": "none"
    }
  },
  // .ej-header-tools | .ej-header-tools | .ej-header-tools
  ejHeaderTools: {
    display: "flex",
    alignItems: "center",
    gap: {
      default: "2rem",
      "@media (max-width: 49.99rem)": "0",
      "@container (max-width: 36rem)": "0.75rem"
    }
  },
  // .ej-source-link | .ej-source-link,   .ej-header-divider,   .ej-docs-label | .ej-source-link
  ejSourceLink: {
    display: {
      default: "inline-flex",
      "@media (max-width: 49.99rem)": "none",
      "@container (max-width: 36rem)": "none"
    },
    gap: "0.4rem",
    whiteSpace: "nowrap",
    alignItems: "center",
    color: "#b4bab7",
    fontSize: "0.85rem",
    textDecoration: "none"
  },
  // .ej-nav-intro
  ejNavIntro: {
    fontSize: "0.75rem",
    color: "#b4bab7",
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
    margin: "0 0 2rem 0.7rem"
  },
  // .ej-nav-dot
  ejNavDot: {
    width: "5px",
    height: "5px",
    backgroundColor: "#9fdbbd",
    borderRadius: "50%"
  },
  // .ej-nav-group
  ejNavGroup: { marginBottom: "1.35rem" },
  // .ej-nav-group h2
  ejNavGroup2: {
    margin: "0 0 0.5rem 0.7rem",
    fontSize: "0.65rem",
    lineHeight: "1.5",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.13em",
    color: "#a8afac"
  },
  // .ej-nav-group ul
  ejNavGroup3: { listStyle: "none", margin: "0", padding: "0" },
  // .ej-nav-group li
  ejNavGroup4: { margin: "0.12rem 0" },
  // .ej-nav-group a | .ej-nav-group a:hover
  ejNavGroup5: {
    display: "block",
    padding: "0.45rem 0.7rem",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: "transparent",
    borderRadius: "0 4px 4px 0",
    color: { default: "#b4bab7", ":hover": "#eeefed" },
    textDecoration: "none",
    fontSize: "0.82rem",
    lineHeight: "1.5",
    backgroundColor: { ":hover": "#191c1b" }
  },
  // .ej-nav-group a[aria-current="page"]
  ejNavGroupSelected: {
    color: "#b3e6cc",
    borderLeftColor: "#9fdbbd",
    backgroundColor: "#1b2923"
  },
  // .ej-nav-footer
  ejNavFooter: {
    margin: "1rem 0.7rem 0",
    paddingTop: "1.2rem",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "#2b2e32",
    display: "grid",
    gap: "0.7rem",
    fontSize: "0.65rem",
    color: "#a8afac"
  },
  // .ej-nav-footer a
  ejNavFooter2: { fontSize: "0.7rem", color: "#b3e6cc", textDecoration: "none" },
  // .ej-page-context | .ej-page-context
  ejPageContext: {
    flexWrap: { default: "wrap", "@media (max-width: 49.99rem)": "wrap" },
    display: "flex",
    alignItems: "center",
    gap: "0.8rem",
    color: "#a8afac",
    fontSize: "0.65rem",
    letterSpacing: "0.13em",
    fontFamily: "var(--sl-font-mono)",
    marginTop: { default: "1.5rem", "@media (max-width: 49.99rem)": "0.5rem" }
  },
  // .ej-page-context span
  ejPageContext2: { color: "#65746c" },
  // h1#_top | h1#_top
  element: {
    fontSize: { default: "var(--sl-text-h1)", "@media (max-width: 49.99rem)": "2.5rem" },
    fontWeight: "500",
    letterSpacing: "-0.055em",
    lineHeight: "1.12",
    marginTop: "1.5rem",
    maxWidth: "min(13em, 38rem)",
    textWrap: "balance",
    overflowWrap: "anywhere"
  }
})
