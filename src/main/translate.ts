import { net } from 'electron'

// Online translation through Google's unofficial web endpoint (the one the
// website widget uses, client=gtx): no API key or account, decent quality,
// but also no SLA - it can rate-limit or change shape without notice, which
// is why every failure comes back as a plain { success: false } for the
// renderer to explain and point at the local models.
//
// Runs in the main process so the renderer doesn't depend on the endpoint's
// CORS headers. The query goes in the POST body: a 5000-char selection
// URL-encodes to ~3x that, past what GET URLs can be trusted to carry.

const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single'
const TIMEOUT_MS = 20_000

export interface GoogleWebTranslateResult {
  success: boolean
  text?: string
  error?: string
}

export async function googleWebTranslate(
  text: string,
  from: string,
  to: string
): Promise<GoogleWebTranslateResult> {
  // sl/tl are plain ISO-639-1 codes ('en', 'ru', ...), same as LangCode.
  const url = `${GOOGLE_ENDPOINT}?client=gtx&sl=${from}&tl=${to}&dt=t`
  try {
    const response = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ q: text }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!response.ok) {
      return {
        success: false,
        error: response.status === 429 ? 'rate-limited by Google' : `HTTP ${response.status}`
      }
    }
    // Response is a bare JSON array; [0] holds the sentence segments, each
    // segment's [0] is its translated text - concatenated they form the
    // full translation. The other elements (detected language etc.) are
    // unused: direction is already decided by the renderer's own detection.
    const data = (await response.json()) as unknown
    const segments = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as unknown[]) : null
    if (!segments) return { success: false, error: 'unexpected response format' }
    const translated = segments
      .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
      .join('')
    return { success: true, text: translated }
  } catch (e) {
    const message =
      e instanceof Error ? (e.name === 'TimeoutError' ? 'request timed out' : e.message) : String(e)
    return { success: false, error: message }
  }
}
