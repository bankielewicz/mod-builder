// Red skeleton: signatures only, so the tests fail by assertion rather than by import.
export type ProviderAuth = 'bearer' | 'session' | 'none' | 'cli'
export type ProviderDef = { id: string; name: string; baseUrl: string; keyName: string | null; defaultModel: string; modelsPath: string | null; auth: ProviderAuth }
export type KeySource = { key: string; source: 'env' | 'file' | 'none' }
export type HttpReply = { status: number; ok: boolean; text: string; headers?: Record<string, string> } | { refused: string }
export type TestResult = { ok: boolean; status: number; ms: number; model: string; note: string; at: number }
export type ProviderRow = { p: ProviderDef; auth: string; test: string; used: boolean }
export const PROVIDERS: ProviderDef[] = []
export const PROVIDER_KEY_NAMES: readonly string[] = []
export const KEY_FILE_NOTE = ''
export function providerOf(_id: string): ProviderDef | undefined { return undefined }
export function isAllowedBaseUrl(_u: string): boolean { return false }
export function baseUrlOf(_p: ProviderDef, _o: { customUrl: string }): string { return '' }
export function keyFileOf(_home: string): string { return '' }
export function parseEnvFile(_t: string): Record<string, string> { return {} }
export function upsertEnvLine(_t: string, _n: string, _v: string | null): string { return '' }
export function serializeEnv(_e: Record<string, string>): string { return '' }
export function keyFor(_p: ProviderDef, _env: Record<string, string | undefined>, _file: Record<string, string>): KeySource { return { key: '', source: 'none' } }
export function maskKey(_k: string): string { return '' }
export function redact(t: string, _keys: readonly string[]): string { return t }
export function modelsRequest(_p: ProviderDef, _k: string, _base: string): { url: string; init: { method: string; headers: Record<string, string>; body?: string } } | null { return null }
export function probeRequest(_p: ProviderDef, _k: string, _base: string, _m: string): { url: string; init: { method: string; headers: Record<string, string>; body?: string } } { return { url: '', init: { method: '', headers: {} } } }
export function parseModelsReply(_t: string): { ids: string[] } | { error: string } { return { error: '' } }
export function parseChatReply(_t: string, _keys: readonly string[] = []): { text: string; tokens: number; model: string } | { error: string } { return { error: '' } }
export function testOutcome(_step: 'models' | 'probe', _r: HttpReply, _ms: number, _at: number): TestResult | { fallback: true } { return { fallback: true } }
export function authTextOf(_p: ProviderDef, _k: KeySource, _customUrl: string): string { return '' }
export function testText(_t: TestResult | 'running' | undefined): string { return '' }
export function providerRowText(_r: ProviderRow, _w: number): string { return '' }
export function providersText(_rows: ProviderRow[], _keys: number, _tested: number): string { return '' }
