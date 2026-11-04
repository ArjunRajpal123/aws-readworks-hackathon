// Product records come from the deployed GET /api/v1/text-to-speech
// (window.SA_API_URL, set at runtime by the pod -- see
// docker-entrypoint.d/10-write-config.sh and infra/cdk/lib/frontend-stack.ts)
// when configured, or straight from sa/ (etl/run_local.py output, or the EKS
// pod's S3 sync) for local dev. A build-time env var would not work here:
// the Docker image is built before the API stack's URL is known.
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
// voiceId (optional) asks the API to pick that voice's track (or the default):
// the record then has selectedTrack, and urls only for that track. Local sa/
// files have every track, so the caller picks.
// Returns null on a missing id, a non-2xx response, or a network error.
export async function fetchProduct(id, voiceId) {
  try {
    if (API) {
      const voice = voiceId ? `&voiceId=${encodeURIComponent(voiceId)}` : ''
      const r = await fetch(`${API}?id=${encodeURIComponent(id)}${voice}`)
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
    const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` }
    return { ok: true, record: j }
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' }
  }
}
