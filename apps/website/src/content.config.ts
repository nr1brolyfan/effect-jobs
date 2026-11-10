import { defineCollection } from "astro:content"
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders"
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema"

export const collections = {
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
  docs: defineCollection({
    loader: docsLoader({
      generateId: (options) => "docs/" + options.entry.replace(/\.(md|mdx)$/, "")
    }),
    schema: docsSchema()
  })
}
