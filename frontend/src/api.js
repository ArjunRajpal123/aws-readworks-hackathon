// Product records come from the deployed GET /api/v1/text-to-speech
// (window.SA_API_URL, set at runtime by the pod -- see
// docker-entrypoint.d/10-write-config.sh and infra/cdk/lib/frontend-stack.ts)
// when configured, or straight from sa/ (etl/run_local.py output, or the EKS
// pod's S3 sync) for local dev. A build-time env var would not work here:
// the Docker image is built before the API stack's URL is known.
import { authHeaders } from './auth.js'
const API = window.SA_API_URL

// sa/ has no presigned URLs: the files are already public to whatever is
// serving sa/, so a plain relative path works the same as prod.urls[id].
function localUrls(prod) {
  const urls = {}
  for (const tr of prod.tracks || []) urls[tr.id] = { audio: `sa/${tr.audioKey}`, timing: `sa/${tr.timingKey}` }
  return urls
}

// Fetches a Sound Along product record by passage id, normalized so
// prod.urls[trackId] = {audio, timing} always points to a fetchable URL.
// Returns null on a missing id, a non-2xx response, or a network error.
export async function fetchProduct(id) {
  try {
    if (API) {
      const r = await fetch(`${API}?id=${encodeURIComponent(id)}`)
      if (!r.ok) return null
      return await r.json()
    }
    const r = await fetch(`sa/product/${id}.soundAlong.json`)
    if (!r.ok) return null
    const prod = await r.json()
    prod.urls = localUrls(prod)
    return prod
  } catch {
    return null
  }
}

// Generates a new passage with POST /api/v1/text-to-speech (Polly audio, word
// timing and the product record, stored where GET and the player read them).
// body: {text, title?, languageCode?, allVoices?}; see
// lambda/text_to_speech_post/handler.py. Returns {ok: true, record} or
// {ok: false, error}. With no API configured there is nothing to call:
// returns null so the caller can fall back.
export async function createProduct(body) {
  if (!API) return null
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, error: r.status === 401 ? 'Sign in as an admin or teacher to generate audio' : j.error || `HTTP ${r.status}` }
    return { ok: true, record: j }
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' }
  }
}

// Submissions: POST /api/v1/submissions queues passages for the cloud ETL
// (S3 incoming/ -> etl-run Lambda) and returns at once, so there's no length
// or batch-size problem with the API's ~29 s timeout. Same API host as
// SA_API_URL. See lambda/submissions/handler.py.
const SUBMISSIONS = API ? API.replace(/\/text-to-speech\/?$/, '/submissions') : ''
export const submissionsEnabled = () => !!SUBMISSIONS

// items: [{text, title?, lang?|languageCode?, id?, pronunciation?}]. Returns
// {ok: true, submissionId, items:[{id, status, error?}]} or {ok: false, error},
// or null when no API is configured.
export async function createSubmission(items, { overwrite = false } = {}) {
  if (!SUBMISSIONS) return null
  try {
    const r = await fetch(SUBMISSIONS, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ items, overwrite }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok && !(j.items && j.items.length)) return { ok: false, error: r.status === 401 ? 'Sign in as an admin or teacher to submit' : j.error || `HTTP ${r.status}` }
    return { ok: (j.queued || 0) > 0, submissionId: j.submissionId, items: j.items || [], error: j.queued ? undefined : (j.items || []).map(i => i.error).filter(Boolean).join('; ') || j.error }
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' }
  }
}

// {submissionId, complete, counts, items:[{id, status: queued|done|failed|rejected|unknown, error?}]} or null.
export async function getSubmission(id) {
  if (!SUBMISSIONS) return null
  try {
    const r = await fetch(`${SUBMISSIONS}/${encodeURIComponent(id)}`)
    return r.ok ? await r.json() : null
  } catch { return null }
}
