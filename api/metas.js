import { handler, HttpError, requireUser } from '../lib/auth.js';
import { readAll, appendRows, updateRow, deleteRow, newId } from '../lib/sheets.js';

// escopo: 'casal' (meta conjunta) ou o e-mail do usuário (meta individual).
// Metas/aportes individuais só são visíveis para o próprio dono.

const podeVer = (escopo, email) => escopo === 'casal' || escopo === email;

function valorPositivo(v) {
  const n = Math.round(Number(String(v).replace(',', '.')) * 100) / 100;
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'Valor inválido.');
  return n;
}

function escopoValido(escopo, email) {
  if (escopo === 'casal') return 'casal';
  if (escopo === 'individual' || escopo === email) return email;
  throw new HttpError(400, 'Escopo inválido.');
}

export default handler(async (req) => {
  const email = requireUser(req);

  if (req.method === 'GET') {
    const ano = String((req.query || {}).ano || new Date().getFullYear());
    const [metas, aportes] = await Promise.all([readAll('Metas'), readAll('Aportes')]);
    const resumo = (escopo) => {
      const meta = metas.find((m) => String(m.ano) === ano && m.escopo === escopo);
      const lista = aportes
        .filter((a) => a.escopo === escopo && String(a.data).startsWith(ano))
        .map((a) => ({ id: String(a.id), data: String(a.data), valor: Number(a.valor) || 0, usuario: a.usuario, obs: a.obs, meu: a.usuario === email }))
        .sort((a, b) => b.data.localeCompare(a.data));
      return { meta: meta ? Number(meta.valor) || 0 : 0, guardado: lista.reduce((s, a) => s + a.valor, 0), aportes: lista };
    };
    return { ano, casal: resumo('casal'), individual: resumo(email) };
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const escopo = escopoValido(body.escopo, email);

    if (body.acao === 'meta') {
      const ano = String(body.ano || new Date().getFullYear());
      if (!/^\d{4}$/.test(ano)) throw new HttpError(400, 'Ano inválido.');
      const valor = valorPositivo(body.valor);
      const metas = await readAll('Metas');
      const atual = metas.find((m) => String(m.ano) === ano && m.escopo === escopo);
      const registro = { ano, escopo, valor, atualizado_por: email, atualizado_em: new Date().toISOString() };
      if (atual) await updateRow('Metas', atual.__row, registro);
      else await appendRows('Metas', [registro]);
      return { ok: true };
    }

    if (body.acao === 'aporte') {
      const data = String(body.data || new Date().toISOString().slice(0, 10));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new HttpError(400, 'Data inválida.');
      const aporte = {
        id: newId(), data, valor: valorPositivo(body.valor), escopo, usuario: email,
        obs: String(body.obs || '').slice(0, 200), criado_em: new Date().toISOString(),
      };
      await appendRows('Aportes', [aporte]);
      return { ok: true };
    }
    throw new HttpError(400, 'Ação inválida.');
  }

  if (req.method === 'DELETE') {
    const id = (req.query || {}).id;
    const aportes = await readAll('Aportes');
    const atual = aportes.find((a) => String(a.id) === String(id));
    if (!atual || !podeVer(atual.escopo, email)) throw new HttpError(404, 'Aporte não encontrado.');
    if (atual.usuario !== email) throw new HttpError(403, 'Só quem registrou pode excluir este aporte.');
    await deleteRow('Aportes', atual.__row);
    return { ok: true };
  }

  throw new HttpError(405, 'Método não permitido.');
});
