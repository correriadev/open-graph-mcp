// Browser stub for the node:fs / node:path imports pulled in transitively by
// opencode/graph/layout. Only load/saveLayout use them; the viewer calls
// seedLayout/lodForZoom only, so these bindings exist but are never invoked.
const unavailable = () => {
  throw new Error("node fs/path unavailable in browser")
}
export const readFileSync = unavailable
export const writeFileSync = unavailable
export const mkdirSync = unavailable
export const existsSync = () => false
export const join = (...parts: string[]) => parts.join("/")
export default { join, dirname: (p: string) => p, resolve: (...p: string[]) => p.join("/") }
