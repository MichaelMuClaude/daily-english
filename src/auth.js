// Who is the user?
//
// In Azure, Container Apps built-in authentication ("Easy Auth") signs the user in
// with Microsoft (or Google, GitHub, ...) BEFORE the request reaches this app and adds
// identity headers. The app has no login code and never sees a password.
// Those headers can only be trusted when the platform's "require authentication" is on,
// so AUTH_MODE=easyauth must only be used behind it. For local development use
// AUTH_MODE=dev with DEV_USER, which ignores the headers entirely.

function userFromRequest(req, env = process.env) {
  if (env.AUTH_MODE === 'dev') {
    const email = env.DEV_USER || 'dev@example.com';
    return { idpId: `dev:${email}`, email };
  }
  const id = req.get('x-ms-client-principal-id');
  if (!id) return null;
  const idp = req.get('x-ms-client-principal-idp') || 'unknown';
  const name = req.get('x-ms-client-principal-name') || null; // email / UPN for Microsoft and Google
  return { idpId: `${idp}:${id}`, email: name };
}

/** Express middleware: attach req.user or answer 401. */
function requireUser(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}

module.exports = { userFromRequest, requireUser };
