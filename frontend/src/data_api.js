// Cloud app-data client: roster, reading sessions, assignments, word
// practice, ratings and review state all come from GET/POST /api/v1/data/*
// (window.SA_DATA_URL, set at runtime by the pod -- see
// docker-entrypoint.d/10-write-config.sh and infra/cdk). When no data API is
// configured (local dev with no backend) every call returns null so callers
// fall back to their built-in sample data.
const BASE = window.SA_DATA_URL

export const hasDataApi = () => !!BASE

async function req(method, resource, { body, query } = {}) {
  if (!BASE) return null
  const qs = query ? '?' + new URLSearchParams(query) : ''
  try {
    const r = await fetch(`${BASE}/${resource}${qs}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// roster
export const getRoster = () => req('GET', 'roster')

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
