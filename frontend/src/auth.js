// Sign-in with Amazon Cognito, from the app's own sign-in page (no hosted UI, no SDK).
// Settings come from window.SA_AUTH = {region, userPoolId, clientId}, written into
// config.js by the pod (docker-entrypoint.d/10-write-config.sh, infra/cdk AuthStack).
//
// Calls the Cognito user pool API directly over HTTPS (USER_PASSWORD_AUTH; the
// web client has no secret). Tokens live in sessionStorage, so closing the tab
// signs out, and they're never put in localStorage. The ID token's claims drive the UI
// (role from cognito:groups, person from custom:personId); the API verifies the
// same token itself (HTTP API JWT authorizer), so nothing here is trusted server-side.
const CFG = (typeof window !== 'undefined' && window.SA_AUTH) || {}
const KEY = 'sa-auth'
const ROLES = ['admin', 'teacher', 'parent', 'student']

export const authEnabled = () => !!(CFG.region && CFG.clientId)

async function cognito(action, body) {
  const r = await fetch(`https://cognito-idp.${CFG.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const type = String(j.__type || '').split('#').pop()
    const err = new Error(j.message || type || `HTTP ${r.status}`)
    err.code = type
    throw err
  }
  return j
}

function decode(jwt) {
  try {
    const b = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(atob(b + '==='.slice((b.length + 3) % 4)))))
  } catch { return null }
}

const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) } catch { return null } }
function save(tokens) {
  try { tokens ? sessionStorage.setItem(KEY, JSON.stringify(tokens)) : sessionStorage.removeItem(KEY) } catch { /* storage can be blocked */ }
  window.dispatchEvent(new Event('sa-auth'))
}
function store(result, prev = {}) {
  const t = { id: result.IdToken, access: result.AccessToken, refresh: result.RefreshToken || prev.refresh,
    exp: Date.now() + (result.ExpiresIn || 3600) * 1000 }
  save(t)
  return t
}

// The signed-in user, from the ID token: {email, name, role, groups, personId} or null.
export function currentUser() {
  const t = load()
  if (!t || !t.id) return null
  const c = decode(t.id)
  if (!c) return null
  const groups = Array.isArray(c['cognito:groups']) ? c['cognito:groups'] : []
  const role = ROLES.find(r => groups.includes(r)) || null
  const name = [c.given_name, c.family_name].filter(Boolean).join(' ') || c.email
  return { email: c.email, name, role, groups, personId: c['custom:personId'] || null }
}

// Step 1. Returns {ok: true} when signed in, or {challenge: 'NEW_PASSWORD_REQUIRED', session}
// for an account created by an admin (temporary password), or throws with a friendly message.
export async function signIn(email, password) {
  try {
    const r = await cognito('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CFG.clientId,
      AuthParameters: { USERNAME: email.trim(), PASSWORD: password } })
    if (r.ChallengeName === 'NEW_PASSWORD_REQUIRED') return { challenge: r.ChallengeName, session: r.Session, email: email.trim() }
    if (r.ChallengeName) throw Object.assign(new Error('This account needs a sign-in step this page does not support yet: ' + r.ChallengeName), { code: r.ChallengeName })
    store(r.AuthenticationResult)
    return { ok: true }
  } catch (e) { throw friendly(e) }
}

// Step 2 (first sign-in only): set a permanent password.
export async function setNewPassword({ email, session }, password) {
  try {
    const r = await cognito('RespondToAuthChallenge', { ChallengeName: 'NEW_PASSWORD_REQUIRED', ClientId: CFG.clientId,
      Session: session, ChallengeResponses: { USERNAME: email, NEW_PASSWORD: password } })
    store(r.AuthenticationResult)
    return { ok: true }
  } catch (e) { throw friendly(e) }
}

export async function signOut() {
  const t = load()
  save(null)
  if (t && t.refresh) { try { await cognito('RevokeToken', { ClientId: CFG.clientId, Token: t.refresh }) } catch { /* already signed out locally */ } }
}

// A valid ID token for API calls (refreshed when close to expiry), or null.
export async function idToken() {
  const t = load()
  if (!t) return null
  if (Date.now() < t.exp - 60000) return t.id
  if (!t.refresh) { save(null); return null }
  try {
    const r = await cognito('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: CFG.clientId, AuthParameters: { REFRESH_TOKEN: t.refresh } })
    return store(r.AuthenticationResult, t).id
  } catch { save(null); return null }
}

export async function authHeaders() {
  const tok = await idToken()
  return tok ? { authorization: `Bearer ${tok}` } : {}
}

function friendly(e) {
  const m = {
    NotAuthorizedException: 'Incorrect email or password.',
    UserNotFoundException: 'Incorrect email or password.',
    PasswordResetRequiredException: 'Your password needs to be reset. Ask your administrator.',
    UserNotConfirmedException: 'This account is not active yet. Ask your administrator.',
    InvalidPasswordException: 'That password does not meet the rules: at least 12 characters, with upper and lower case letters and a number.',
    TooManyRequestsException: 'Too many attempts. Wait a minute and try again.',
    LimitExceededException: 'Too many attempts. Wait a minute and try again.',
  }[e.code]
  return Object.assign(new Error(m || e.message || 'Sign-in failed.'), { code: e.code })
}
