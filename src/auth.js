const crypto = require('crypto');
const db = require('./db');

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .run(sha(token), userId, Date.now() + SESSION_MS);
  res.cookie('sid', token, {
    httpOnly: true, sameSite: 'lax', maxAge: SESSION_MS,
    secure: process.env.NODE_ENV === 'production',
  });
}

function destroySession(req, res) {
  if (req.cookies && req.cookies.sid) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(req.cookies.sid));
  res.clearCookie('sid');
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.sid;
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  const row = db.prepare(`SELECT u.id,u.name,u.roll_no,u.email,s.expires_at FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(sha(token));
  if (!row || row.expires_at < Date.now()) return res.status(401).json({ error: 'Session expired. Please log in again.' });
  req.user = { id: row.id, name: row.name, roll_no: row.roll_no, email: row.email };
  next();
}

// Simple in-memory limiter for login/register (per IP).
const hits = new Map();
function limiter(max = 15, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const k = req.ip, now = Date.now();
    const h = hits.get(k);
    if (!h || h.reset < now) { hits.set(k, { n: 1, reset: now + windowMs }); return next(); }
    if (++h.n > max) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    next();
  };
}

function canManage(req) {
  const list = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || list.includes(req.user.email.toLowerCase());
}

module.exports = { createSession, destroySession, requireAuth, limiter, canManage };
