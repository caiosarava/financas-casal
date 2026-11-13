// Autenticação: valida o login Google e emite um token de sessão próprio (HMAC).
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const SESSION_DAYS = 30;

export function allowedEmails() {
  return (process.env.ALLOWED_EMAILS || 'caio.sarava@gmail.com,thianedepra@gmail.com')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function userNames() {
  const map = {};
  for (const pair of (process.env.USER_NAMES || '').split(',')) {
    const [email, name] = pair.split(':').map((s) => (s || '').trim());
    if (email && name) map[email.toLowerCase()] = name;
  }
  for (const email of allowedEmails()) {
    if (!map[email]) {
      const base = email.split('@')[0].replace(/[._\d]+/g, ' ').trim().split(' ')[0] || email;
      map[email] = base.charAt(0).toUpperCase() + base.slice(1);
    }
  }
  return map;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new HttpError(500, 'SESSION_SECRET não configurado (mínimo 16 caracteres).');
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signSession(email) {
  const payload = b64url(JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 864e5 }));
  const sig = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    if (!allowedEmails().includes(data.email)) return null;
    return data.email;
  } catch {
    return null;
  }
}

let oauthClient;
export async function verifyGoogleCredential(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new HttpError(500, 'GOOGLE_CLIENT_ID não configurado.');
  oauthClient ||= new OAuth2Client(clientId);
  const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: clientId });
  const p = ticket.getPayload();
  const email = (p.email || '').toLowerCase();
  if (!p.email_verified) throw new HttpError(403, 'E-mail Google não verificado.');
  if (!allowedEmails().includes(email)) throw new HttpError(403, `O e-mail ${email} não tem acesso a este aplicativo.`);
  return { email, picture: p.picture || '' };
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Retorna o e-mail do usuário logado ou lança 401. */
export function requireUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const email = verifySession(token);
  if (!email) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  return email;
}

/** Envolve um handler com tratamento padrão de erros e JSON. */
export function handler(fn) {
  return async (req, res) => {
    try {
      if (typeof req.body === 'string' && req.body) {
        try { req.body = JSON.parse(req.body); } catch { /* corpo não-JSON */ }
      }
      const result = await fn(req, res);
      if (!res.headersSent) res.status(200).json(result ?? { ok: true });
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500 && status !== 501 && status !== 503) console.error(err);
      res.status(status).json({ error: err.message || 'Erro interno' });
    }
  };
}
