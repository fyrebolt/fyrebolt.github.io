// ===== Talking to Instagram as your own logged-in browser =====
//
// Instagram has no public API for follower *lists*, so both the daily pull and
// the local agent call the same private web endpoints instagram.com itself
// calls, authenticated with your own session cookie. The bits they must agree
// on — how the cookie is assembled out of the secrets file, and what a request
// has to look like to be served — live here.
//
// Deliberately no fetching: the two callers want very different things from a
// failed request (the pull retries and aborts the day; the agent answers one
// browser request), and folding those together would help nobody.

export const IG_APP_ID = '936619743392459';
export const IG_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Split a raw `cookie:` request header into its name → value pairs. */
export function parseCookieHeader(header) {
  const jar = {};
  for (const pair of String(header ?? '').split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 1) continue;
    jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return jar;
}

/**
 * The session to send, from the secrets file.
 *
 * Accepts either a whole `cookie:` header pasted out of devtools, or the three
 * values named individually — pasting the header is far easier to get right, so
 * it's the documented path, but the explicit form still works.
 *
 * Returns `sessionid` separately so callers can tell "no credentials at all"
 * from "credentials that Instagram may since have expired".
 */
export function buildSession(raw) {
  const jar = parseCookieHeader(raw.cookie);
  const sessionid = raw.sessionid || jar.sessionid;
  const dsUserId = raw.ds_user_id || jar.ds_user_id;
  const csrftoken = raw.csrftoken || jar.csrftoken || '';

  const parts = [];
  if (sessionid) parts.push(`sessionid=${sessionid}`);
  if (dsUserId) parts.push(`ds_user_id=${dsUserId}`);
  if (csrftoken) parts.push(`csrftoken=${csrftoken}`);

  return { sessionid, csrftoken, cookie: parts.join('; ') };
}

/** Headers that make a request look like the page it's pretending to come from. */
export function igHeaders(session, referer) {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'x-ig-app-id': IG_APP_ID,
    'x-csrftoken': session.csrftoken,
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': IG_UA,
    referer,
    cookie: session.cookie,
  };
}

/** The public-profile endpoint: numeric id, counts, bio, verified/private flags. */
export function profileInfoUrl(username) {
  return `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
}

/** The page a profile request would have come from. */
export function profileReferer(username) {
  return `https://www.instagram.com/${username}/`;
}
