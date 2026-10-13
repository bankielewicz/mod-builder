// Maps 'claude-code/testing' to kit.mjs and adds '.ts' to extensionless relative imports.
const KIT = new URL('./kit.mjs', import.meta.url).href
export async function resolve(specifier, context, next) {
  if (specifier === 'claude-code/testing') return { url: KIT, shortCircuit: true }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try { return await next(specifier + '.ts', context) } catch {}
  }
  return next(specifier, context)
}
