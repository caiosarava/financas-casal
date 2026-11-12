import { handler, HttpError, verifyGoogleCredential, signSession, requireUser, userNames, allowedEmails } from '../lib/auth.js';

function perfil(email, picture = '') {
  const names = userNames();
  return {
    email,
    nome: names[email],
    picture,
    usuarios: allowedEmails().map((e) => ({ email: e, nome: names[e] })),
  };
}

export default handler(async (req) => {
  if (req.method === 'POST') {
    const { credential } = req.body || {};
    if (!credential) throw new HttpError(400, 'Credencial ausente.');
    const { email, picture } = await verifyGoogleCredential(credential);
    return { token: signSession(email), user: perfil(email, picture) };
  }
  if (req.method === 'GET') {
    return { user: perfil(requireUser(req)) };
  }
  throw new HttpError(405, 'Método não permitido.');
});
