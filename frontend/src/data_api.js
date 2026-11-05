// Cloud app-data client: roster, reading sessions, assignments, word
// practice, ratings and review state all come from GET/POST /api/v1/data/*
// (window.SA_DATA_URL, set at runtime by the pod -- see
// docker-entrypoint.d/10-write-config.sh and infra/cdk). When no data API is
// configured (local dev with no backend) every call returns null so callers
// fall back to their built-in sample data.
const BASE = window.SA_DATA_URL

export const hasDataApi = () => !!BASE

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function req(method, resource, { body, query } = {}) {
  if (!BASE) return null
  const qs = query ? '?' + new URLSearchParams(query) : ''
  const url = `${BASE}/${resource}${qs}`
  const opts = {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }
  // GET reads are idempotent: retry a few times with backoff so a cold Lambda,
  // a GSI still warming up, or a transient network error doesn't leave the
  // page with no data (the "had to go back and forth to get content" bug).
  // POST/DELETE are not retried (they create/delete).
  const tries = method === 'GET' ? 4 : 1
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts)
      if (r.ok) return await r.json()
      // 4xx won't fix itself; stop. 5xx/throttle: retry.
      if (r.status < 500 && r.status !== 429) return null
    } catch { /* network error: retry */ }
    if (i < tries - 1) await sleep(300 * (i + 1))
  }
  return null
}

// roster
export const getRoster = () => req('GET', 'roster')

// content (migrated built-in passages): catalog index + shared cards, and one mode by id
export const getCatalog = () => req('GET', 'catalog')
export const getContent = id => req('GET', 'content', { query: { id } })

// sessions
export const getSessions = student => req('GET', 'sessions', { query: { student } })
export const postSession = rec => req('POST', 'sessions', { body: rec })

// assignments
export const getAssignments = student => req('GET', 'assignments', { query: student ? { student } : undefined })
export const postAssignment = rec => req('POST', 'assignments', { body: rec })
export const deleteAssignment = id => req('DELETE', 'assignments', { query: { id } })

// word practice
export const getPractice = student => req('GET', 'practice', { query: { student } })
export const postPractice = (student, word, knew) => req('POST', 'practice', { body: { student, word, knew } })

// ratings
export const getRatings = () => req('GET', 'ratings')
export const postRating = rec => req('POST', 'ratings', { body: rec })

// review / publish state
export const getReview = pid => req('GET', 'review', { query: { pid } })
export const postReview = rec => req('POST', 'review', { body: rec })

// translate (Spanish version): returns {text} or null
export const translate = (text, source = 'en', target = 'es') => req('POST', 'translate', { body: { text, source, target } })

// generation (Bedrock): vocabulary cards and Word Stops drafted from a passage
export const genCards = (text, lang = 'en') => req('POST', 'cards', { body: { text, lang } })
export const genStops = (text, vocab, lang = 'en') => req('POST', 'stops', { body: { text, vocab, lang } })
// localize English cards to the sibling language, matched to the translated
// passage surface form -> {cards}. Used for the Spanish sibling's vocab.
export const localizeCards = (text, cards, lang = 'es') => req('POST', 'localize', { body: { text, cards, lang } })
// per-passage vocab cards the player underlines: save / read by passage id
export const putPassageCards = (pid, cards) => req('POST', 'pcards', { body: { pid, cards } })
export const getPassageCards = pid => req('GET', 'pcards', { query: { pid } })
