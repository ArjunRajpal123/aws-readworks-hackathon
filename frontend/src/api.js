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
