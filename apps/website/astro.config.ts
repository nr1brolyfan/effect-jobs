import { defineConfig } from "astro/config"
import react from "@astrojs/react"
import type { Plugin } from "vite"
import { unplugin as stylex } from "@stylexjs/unplugin"
import starlight from "@astrojs/starlight"
import sitemap from "@astrojs/sitemap"
import { productionAssets } from "./hosting/Assets.js"

// Astro emits shared illustration CSS during prerender. Running extraction again
// in the client environment renames Expressive Code's CSS after its href is frozen.
// Keep the official transforms in both environments and scope only extraction.
const extraction: Plugin = stylex.vite({
  dev: false,
  runtimeInjection: false,
  treeshakeCompensation: true,
  unstable_moduleResolution: { type: "commonJS", rootDir: import.meta.dirname },
  cssInjectionTarget: (file: string) => /\/Playback\.[^/]+\.css$/.test(file)
})
const generateBundle = extraction.generateBundle
const writeBundle = extraction.writeBundle
extraction.generateBundle = function (options, bundle, isWrite) {
  if (this.environment.name === "prerender" && typeof generateBundle === "function") {
    return generateBundle.call(this, options, bundle, isWrite)
  }
}
extraction.writeBundle = function (options, bundle) {
  if (this.environment.name === "prerender" && typeof writeBundle === "function") {
    return writeBundle.call(this, options, bundle)
  }
}

export default defineConfig({
  site: "https://effect-jobs.dev",
  output: "static",
  build: { inlineStylesheets: "never" },
  markdown: { syntaxHighlight: false },
  outDir: "./dist/site",
  trailingSlash: "never",
  vite: {
    // The renderer imports virtual options, which must be bundled for prerendering.
    environments: { prerender: { resolve: { noExternal: ["@astrojs/react"] } } },
    plugins: [extraction]
  },
  integrations: [
    productionAssets(),
    sitemap({ filter: (page) => new URL(page).pathname !== "/docs/jobs" }),
    react(),
    starlight({
      title: "effect-jobs",
      favicon: "/favicon.svg",
      description: "Durable background jobs with explicit Effect ownership.",
      customCss: ["./src/styles/site/docs.css"],
      expressiveCode: {
        themes: ["github-dark"],
        useStarlightDarkModeSwitch: false,
        useDarkModeMediaQuery: false,
        styleOverrides: {
          borderColor: "#36343c",
          borderWidth: "1px",
          // Frames adds the 1px border to this inner radius: 9px outer panel.
          borderRadius: "8px",
          codeBackground: "#1c1c20",
          codeFontFamily:
            'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
          codeFontSize: "14px",
          codeLineHeight: "1.7",
          codePaddingBlock: "22px",
          codePaddingInline: "22px",
          uiFontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
          uiFontSize: "13px",
          uiLineHeight: "1.3",
          uiPaddingBlock: "12px",
          uiPaddingInline: "22px",
          frames: {
            frameBoxShadowCssValue: "none",
            editorBackground: "#1c1c20",
            editorTabBarBackground: "#1c1c20",
            editorActiveTabBackground: "#1c1c20",
            editorActiveTabForeground: "#bcc2d0",
            editorTabBarBorderColor: "#36343c",
            editorTabBarBorderBottomColor: "#ffffff13",
            editorActiveTabIndicatorTopColor: "transparent",
            editorActiveTabIndicatorBottomColor: "#ffffff13",
            terminalBackground: "#1c1c20",
            terminalTitlebarBackground: "#1c1c20",
            terminalTitlebarForeground: "#bcc2d0",
            terminalTitlebarBorderBottomColor: "#ffffff13"
          }
        }
      },
      components: {
        ThemeProvider: "./src/components/docs/ThemeProvider.astro",
        Header: "./src/components/docs/Header.astro",
        Sidebar: "./src/components/docs/Sidebar.astro",
        PageTitle: "./src/components/docs/PageTitle.astro",
        ThemeSelect: "./src/components/docs/ThemeSelect.astro"
      },
      sidebar: [
        { label: "Overview", link: "/docs" },
        { label: "Start here", items: [{ autogenerate: { directory: "docs/start" } }] },
        {
          label: "Core concepts",
          items: [{ autogenerate: { directory: "docs/concepts" } }]
        },
        {
          label: "Persistence",
          items: [{ autogenerate: { directory: "docs/persistence" } }]
        },
        {
          label: "Execution",
          items: [{ autogenerate: { directory: "docs/execution" } }]
        },
        {
          label: "Operations",
          items: [{ autogenerate: { directory: "docs/operations" } }]
        },
        {
          label: "API reference",
          items: [{ autogenerate: { directory: "docs/reference" } }]
        }
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/nr1brolyfan/effect-jobs"
        }
      ],
      head: [
        { tag: "meta", attrs: { name: "color-scheme", content: "dark" } },
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: "/favicon.ico",
            type: "image/x-icon",
            sizes: "16x16 32x32 48x48"
          }
        },
        {
          tag: "link",
          attrs: {
            rel: "apple-touch-icon",
            href: "/apple-touch-icon.png",
            sizes: "180x180"
          }
        }
      ]
    })
  ]
})
