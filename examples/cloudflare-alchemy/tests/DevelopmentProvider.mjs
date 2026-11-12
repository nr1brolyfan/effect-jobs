// Synthetic HTTP provider for local qualification. Map storage is not durable.
export const makeDevelopmentProvider = () => {
  const effects = new Map()
  let repeated = 0
  return {
    effects,
    get repeated() {
      return repeated
    },
    accept: async (request) => {
      const key = request.headers.get("idempotency-key")
      if (!key) {
        return new Response(null, { status: 400 })
      }
      const content = await request.text()
      if (effects.has(key)) {
        if (effects.get(key) !== content) {
          return new Response(null, { status: 409 })
        }
        repeated++
      } else {
        effects.set(key, content)
      }
      return new Response(null, { status: 204 })
    }
  }
}
