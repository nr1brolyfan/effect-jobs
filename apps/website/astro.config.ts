import { defineConfig } from "astro/config"
import react from "@astrojs/react"
import type { Plugin } from "vite"
import { unplugin as stylex } from "@stylexjs/unplugin"
import starlight from "@astrojs/starlight"

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
    react(),
    starlight({
      title: "effect-jobs",
      description: "Durable background jobs with explicit Effect ownership.",
      customCss: ["./src/styles/site/docs.css"],
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
      head: [{ tag: "meta", attrs: { name: "color-scheme", content: "dark" } }]
    })
  ]
})
