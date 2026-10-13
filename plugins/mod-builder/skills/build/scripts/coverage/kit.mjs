// Stand-in for 'claude-code/testing' (logic tests only): describe/test from node:test, a jest-style expect.
import { describe as nodeDescribe, test as nodeTest } from 'node:test'
import { isDeepStrictEqual, inspect } from 'node:util'

export const describe = nodeDescribe
export function test(name, a, b) {
  const fn = typeof a === 'function' ? a : b
  return nodeTest(name, async () => { await fn() })
}
export const it = test

class Asymmetric {
  constructor(test, label) { this.test = test; this.label = label }
}
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))
// Jest-style toEqual: ignores undefined properties and prototypes of plain objects; honours asymmetric matchers.
const equals = (a, e) => {
  if (e instanceof Asymmetric) return e.test(a)
  if (Array.isArray(e)) return Array.isArray(a) && a.length === e.length && e.every((v, i) => equals(a[i], v))
  if (isPlain(e)) {
    if (!isPlain(a)) return false
    const keys = o => Object.keys(o).filter(k => o[k] !== undefined)
    const ka = keys(a), ke = keys(e)
    return ka.length === ke.length && ke.every(k => equals(a[k], e[k]))
  }
  if (e instanceof Set || e instanceof Map || e instanceof Date || e instanceof RegExp) return isDeepStrictEqual(a, e)
  return Object.is(a, e)
}
const subset = (a, e) => {
  if (e instanceof Asymmetric) return e.test(a)
  if (isPlain(e)) return a !== null && typeof a === 'object' && Object.entries(e).every(([k, v]) => subset(a[k], v))
  if (Array.isArray(e)) return Array.isArray(a) && a.length === e.length && e.every((v, i) => subset(a[i], v))
  return equals(a, e)
}
const show = v => inspect(v, { depth: 6, breakLength: 120 })
function make(actual, negate) {
  const check = (ok, what, expected) => {
    if (ok === negate) throw new Error(`expect(${show(actual)})${negate ? '.not' : ''}.${what}(${show(expected)})`)
  }
  return {
    toBe: e => check(Object.is(actual, e), 'toBe', e),
    toEqual: e => check(equals(actual, e), 'toEqual', e),
    toContain: e => check(typeof actual === 'string' ? actual.includes(e) : actual.some(x => equals(x, e)), 'toContain', e),
    toMatchObject: e => check(subset(actual, e), 'toMatchObject', e),
    toBeNull: () => check(actual === null, 'toBeNull'),
    toBeUndefined: () => check(actual === undefined, 'toBeUndefined'),
    toBeDefined: () => check(actual !== undefined, 'toBeDefined'),
    toStartWith: e => check(String(actual).startsWith(e), 'toStartWith', e),
    toMatch: e => check(typeof e === 'string' ? String(actual).includes(e) : e.test(String(actual)), 'toMatch', e),
    toHaveLength: e => check(actual.length === e, 'toHaveLength', e),
    toBeLessThanOrEqual: e => check(actual <= e, 'toBeLessThanOrEqual', e),
    toBeGreaterThan: e => check(actual > e, 'toBeGreaterThan', e),
    toBeGreaterThanOrEqual: e => check(actual >= e, 'toBeGreaterThanOrEqual', e),
  }
}
export function expect(actual) {
  const m = make(actual, false)
  m.not = make(actual, true)
  return m
}
expect.stringContaining = s => new Asymmetric(a => typeof a === 'string' && a.includes(s), `stringContaining(${s})`)
expect.stringMatching = r => new Asymmetric(a => typeof a === 'string' && (typeof r === 'string' ? a.includes(r) : r.test(a)), `stringMatching(${r})`)
expect.any = C => new Asymmetric(a => a != null && (Object(a) instanceof C), `any(${C.name})`)
expect.anything = () => new Asymmetric(a => a != null, 'anything')
expect.arrayContaining = xs => new Asymmetric(a => Array.isArray(a) && xs.every(x => a.some(y => equals(y, x))), 'arrayContaining')
expect.objectContaining = o => new Asymmetric(a => subset(a, o), 'objectContaining')
