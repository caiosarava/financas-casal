import { handler, HttpError, requireUser } from '../lib/auth.js';
import { readAll, appendRows, updateRow, deleteRow, newId } from '../lib/sheets.js';
import { normalizaCategoria } from '../lib/categorias.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseGasto(input, email, origemPadrao = 'manual') {
  const valor = Math.round(Number(String(input.valor).replace(',', '.')) * 100) / 100;
  if (!Number.isFinite(valor) || valor <= 0) throw new HttpError(400, 'Valor inválido.');
  if (!DATE_RE.test(String(input.data || ''))) throw new HttpError(400, 'Data inválida (use AAAA-MM-DD).');
  return {
    data: input.data,
    valor,
    tipo: normalizaCategoria(input.tipo),
    descricao: String(input.descricao || '').slice(0, 200),
    usuario: email,
    compartilhado: input.compartilhado === false || input.compartilhado === 'NAO' ? 'NAO' : 'SIM',
    origem: input.origem === 'pdf' ? 'pdf' : origemPadrao,
  };
}

const publico = (g, email) => ({
  id: String(g.id),
  data: String(g.data),
  valor: Number(g.valor) || 0,
  tipo: g.tipo,
  descricao: g.descricao,
  usuario: g.usuario,
  compartilhado: g.compartilhado !== 'NAO',
  origem: g.origem,
  meu: g.usuario === email,
});

export default handler(async (req) => {
  const email = requireUser(req);

  if (req.method === 'GET') {
    // ?mes=AAAA-MM  ou  ?ano=AAAA  (sem filtro = tudo)
    const { mes, ano } = req.query || {};
    const prefixo = mes || ano || '';
    const rows = await readAll('Gastos');
    const gastos = rows
      .filter((g) => g.usuario === email || g.compartilhado !== 'NAO')
      .filter((g) => !prefixo || String(g.data).startsWith(prefixo))
      .map((g) => publico(g, email))
      .sort((a, b) => b.data.localeCompare(a.data));
    return { gastos };
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const lista = Array.isArray(body.gastos) ? body.gastos : [body];
    if (!lista.length || lista.length > 500) throw new HttpError(400, 'Envie entre 1 e 500 gastos.');
    const agora = new Date().toISOString();
    const novos = lista.map((g) => ({ id: newId(), ...parseGasto(g, email), criado_em: agora }));
    await appendRows('Gastos', novos);
    return { gastos: novos.map((g) => publico(g, email)) };
  }

  if (req.method === 'PUT') {
    const body = req.body || {};
    const rows = await readAll('Gastos');
    const atual = rows.find((g) => String(g.id) === String(body.id));
    if (!atual) throw new HttpError(404, 'Gasto não encontrado.');
    if (atual.usuario !== email) throw new HttpError(403, 'Só quem registrou pode editar este gasto.');
    const novo = { ...atual, ...parseGasto(body, email, atual.origem || 'manual'), origem: atual.origem };
    await updateRow('Gastos', atual.__row, novo);
    return { gasto: publico(novo, email) };
  }

  if (req.method === 'DELETE') {
    const id = (req.query || {}).id;
    const rows = await readAll('Gastos');
    const atual = rows.find((g) => String(g.id) === String(id));
    if (!atual) throw new HttpError(404, 'Gasto não encontrado.');
    if (atual.usuario !== email) throw new HttpError(403, 'Só quem registrou pode excluir este gasto.');
    await deleteRow('Gastos', atual.__row);
    return { ok: true };
  }

  throw new HttpError(405, 'Método não permitido.');
});
