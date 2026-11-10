export const hosted = Object.freeze({
  credential: "__Host-playground",
  csrf: "__Host-playground-csrf",
  secure: "; Secure"
})
// Name selection is shared with the browser, which can only read the CSRF cookie.
// Server issuance/authentication MUST first validate its trusted origin policy;
// selecting a name never authorizes an HTTP origin or a credential.
export const names = (origin: string, localPreview = false) => {
  const url = new URL(origin)
  return localPreview &&
    url.protocol === "http:" &&
    url.port !== "" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ? {
        credential: `playground-local-${url.port}`,
        csrf: `playground-local-csrf-${url.port}`,
        secure: ""
      }
    : hosted
}
