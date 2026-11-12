// CRUD genérico de lançamentos (gastos e entradas), com regra de visibilidade:
// cada um vê os próprios lançamentos + os compartilhados pelo outro.
import { handler, HttpError, requireUser } from './auth.js';
import { readAll, appendRows, updateRows, deleteRow, newId } from './sheets.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function criarHandlerLancamentos({ aba, normaliza, nome }) {
  function parse(input, email, origemPadrao = 'manual') {
    const valor = Math.round(Number(String(input.valor).replace(',', '.')) * 100) / 100;
    if (!Number.isFinite(valor) || valor <= 0) throw new HttpError(400, 'Valor inválido.');
    if (!DATE_RE.test(String(input.data || ''))) throw new HttpError(400, 'Data inválida (use AAAA-MM-DD).');
    return {
      data: input.data,
      valor,
      tipo: normaliza(input.tipo),
      descricao: String(input.descricao || '').slice(0, 200),
      usuario: email,
      compartilhado: input.compartilhado === false || input.compartilhado === 'NAO' ? 'NAO' : 'SIM',
      origem: ['pdf', 'planilha'].includes(input.origem) ? input.origem : origemPadrao,
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

  return handler(async (req) => {
    const email = requireUser(req);

    if (req.method === 'GET') {
      // ?mes=AAAA-MM  ou  ?ano=AAAA  (sem filtro = tudo)
      const { mes, ano } = req.query || {};
      const prefixo = mes || ano || '';
      const rows = await readAll(aba);
      const itens = rows
        .filter((g) => g.usuario === email || g.compartilhado !== 'NAO')
        .filter((g) => !prefixo || String(g.data).startsWith(prefixo))
        .map((g) => publico(g, email))
        .sort((a, b) => b.data.localeCompare(a.data));
      return { itens };
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const lista = Array.isArray(body.itens) ? body.itens : [body];
      if (!lista.length || lista.length > 1000) throw new HttpError(400, 'Envie entre 1 e 1000 lançamentos.');
      const agora = new Date().toISOString();
      const novos = lista.map((g) => ({ id: newId(), ...parse(g, email), criado_em: agora }));
      await appendRows(aba, novos);
      return { itens: novos.map((g) => publico(g, email)) };
    }

    if (req.method === 'PUT') {
      // Aceita um lançamento ({ id, ... }) ou vários ({ itens: [{ id, ... }] }) numa única gravação
      const body = req.body || {};
      const lista = Array.isArray(body.itens) ? body.itens : [body];
      if (!lista.length || lista.length > 1000) throw new HttpError(400, 'Envie entre 1 e 1000 lançamentos.');
      const rows = await readAll(aba);
      const updates = lista.map((item) => {
        const atual = rows.find((g) => String(g.id) === String(item.id));
        if (!atual) throw new HttpError(404, `${nome} não encontrado(a).`);
        if (atual.usuario !== email) throw new HttpError(403, 'Só quem registrou pode editar.');
        const novo = { ...atual, ...parse(item, email, atual.origem || 'manual'), origem: atual.origem };
        return { row: atual.__row, obj: novo };
      });
      await updateRows(aba, updates);
      const itens = updates.map((u) => publico(u.obj, email));
      return { item: itens[0], itens };
    }

    if (req.method === 'DELETE') {
      const id = (req.query || {}).id;
      const rows = await readAll(aba);
      const atual = rows.find((g) => String(g.id) === String(id));
      if (!atual) throw new HttpError(404, `${nome} não encontrado(a).`);
      if (atual.usuario !== email) throw new HttpError(403, 'Só quem registrou pode excluir.');
      await deleteRow(aba, atual.__row);
      return { ok: true };
    }

    throw new HttpError(405, 'Método não permitido.');
  });
}
