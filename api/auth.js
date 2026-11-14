import { handler, HttpError, verifyGoogleCredential, signSession, requireUser, userNames, allowedEmails } from '../lib/auth.js';
import { readAll, appendRows, updateRow } from '../lib/sheets.js';

// Nomes completos (perfil Google, guardado a cada login; NOMES_COMPLETOS="email:Nome Completo,..." tem prioridade).
// Usados para reconhecer Pix/transferências entre as contas do próprio casal.
async function nomesCompletos() {
  const mapa = {};
  try {
    for (const u of await readAll('Usuarios')) if (u.email && u.nome_completo) mapa[String(u.email).toLowerCase()] = String(u.nome_completo);
  } catch { /* planilha indisponível: segue sem nomes completos */ }
  for (const par of (process.env.NOMES_COMPLETOS || '').split(',')) {
    const [email, nome] = par.split(':').map((x) => (x || '').trim());
    if (email && nome) mapa[email.toLowerCase()] = nome;
  }
  return mapa;
}

async function guardarNome(email, nomeCompleto) {
  if (!nomeCompleto) return;
  try {
    const atual = (await readAll('Usuarios')).find((u) => String(u.email).toLowerCase() === email);
    const linha = { email, nome_completo: nomeCompleto.slice(0, 120), atualizado_em: new Date().toISOString() };
    if (!atual) await appendRows('Usuarios', [linha]);
    else if (atual.nome_completo !== linha.nome_completo) await updateRow('Usuarios', atual.__row, linha);
  } catch (e) { console.warn('Não foi possível guardar o nome do usuário:', e.message); }
}

async function perfil(email, picture = '') {
  const names = userNames();
  const completos = await nomesCompletos();
  return {
    email,
    nome: names[email],
    picture,
    usuarios: allowedEmails().map((e) => ({ email: e, nome: names[e], nomeCompleto: completos[e] || '' })),
  };
}

export default handler(async (req) => {
  if (req.method === 'POST') {
    const { credential } = req.body || {};
    if (!credential) throw new HttpError(400, 'Credencial ausente.');
    const { email, picture, nomeCompleto } = await verifyGoogleCredential(credential);
    await guardarNome(email, nomeCompleto);
    return { token: signSession(email), user: await perfil(email, picture) };
  }
  if (req.method === 'GET') {
    return { user: await perfil(requireUser(req)) };
  }
  throw new HttpError(405, 'Método não permitido.');
});
