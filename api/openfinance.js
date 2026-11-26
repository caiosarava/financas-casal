// Open Finance (Meu Pluggy). Cada usuário usa SÓ as próprias credenciais e vê SÓ as próprias conexões.
//
// GET                                            → { configurado, conexoes: [...] }
// POST { acao: 'adicionar', itemId, apelido }   → valida o item na conta Pluggy do usuário e salva
// POST { acao: 'sincronizar', conexaoId, de, ate } → { documentos } (extratos e faturas para revisar e salvar)
// DELETE ?id=                                   → remove a conexão do app (não mexe no Meu Pluggy)
import { PluggyClient } from 'pluggy-sdk';
import { handler, HttpError, requireUser } from '../lib/auth.js';
import { readAll, appendRows, updateRow, deleteRow, newId } from '../lib/sheets.js';
import { credenciaisDe, montarDocumentos, dataBrasil } from '../lib/openfinance.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const clientes = new Map();

function clienteDe(email) {
  const cred = credenciaisDe(email);
  if (!cred) throw new HttpError(412, 'Open Finance não configurado para você: cadastre suas credenciais do Meu Pluggy em PLUGGY_CREDENCIAIS na Vercel.');
  const chave = `${email}:${cred.clientId}`;
  if (!clientes.has(chave)) clientes.set(chave, new PluggyClient(cred));
  return clientes.get(chave);
}

// Erros do SDK da Pluggy → mensagens claras
function traduzir(e, contexto) {
  const status = e?.response?.statusCode || e?.statusCode || e?.status || e?.code;
  const msg = e?.response?.body?.message || e?.message || String(e);
  if (status === 401 || /unauthorized|invalid.*(client|credential)/i.test(msg)) {
    return new HttpError(500, `A Pluggy recusou suas credenciais (verifique PLUGGY_CREDENCIAIS): ${msg}`);
  }
  if (status === 403 || status === 404) return new HttpError(404, `${contexto}: não encontrado na sua conta Pluggy (${msg}). Confira o id do item no Dashboard.`);
  return new HttpError(502, `${contexto}: falha ao falar com a Pluggy (${status || 'erro'}: ${String(msg).slice(0, 200)})`);
}

const STATUS = {
  UPDATED: 'Atualizado', UPDATING: 'Atualizando…', OUTDATED: 'Desatualizado', LOGIN_ERROR: 'Erro de acesso — reconecte no Meu Pluggy',
  WAITING_USER_INPUT: 'Aguardando você no Meu Pluggy', WAITING_USER_ACTION: 'Aguardando você no Meu Pluggy', MERGING: 'Atualizando…',
};

export default handler(async (req) => {
  const email = requireUser(req);
  const configurado = Boolean(credenciaisDe(email));
  const minhas = async () => (await readAll('Conexoes')).filter((c) => c.usuario === email);

  if (req.method === 'GET') {
    if (!configurado) return { configurado: false, conexoes: [] };
    const client = clienteDe(email);
    const conexoes = await Promise.all((await minhas()).map(async (c) => {
      const base = { id: String(c.id), itemId: c.item_id, banco: c.banco, apelido: c.apelido, ultimaSincronizacao: String(c.ultima_sincronizacao || '') };
      try {
        const item = await client.fetchItem(c.item_id);
        return {
          ...base, banco: item.connector?.name || c.banco, status: item.status, statusTexto: STATUS[item.status] || item.status,
          atualizadoEm: item.lastUpdatedAt ? new Date(item.lastUpdatedAt).toISOString() : '',
          consentimentoAte: item.consentExpiresAt ? dataBrasil(item.consentExpiresAt) : '',
        };
      } catch (e) { return { ...base, status: 'ERRO', statusTexto: traduzir(e, 'Conexão').message }; }
    }));
    return { configurado, conexoes };
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    const client = clienteDe(email);

    if (b.acao === 'adicionar') {
      const itemId = String(b.itemId || '').trim();
      if (!UUID.test(itemId)) throw new HttpError(400, 'Informe o id do item (formato 1a2b3c4d-…), copiado do Dashboard da Pluggy.');
      if ((await minhas()).some((c) => c.item_id === itemId)) throw new HttpError(409, 'Esta conexão já foi adicionada.');
      let item;
      try { item = await client.fetchItem(itemId); } catch (e) { throw traduzir(e, 'Item'); }
      const c = {
        id: newId(), usuario: email, item_id: itemId, banco: String(item.connector?.name || 'Banco').slice(0, 60),
        apelido: String(b.apelido || '').trim().slice(0, 40), criado_em: new Date().toISOString(), ultima_sincronizacao: '',
      };
      await appendRows('Conexoes', [c]);
      return { conexao: { id: c.id, itemId, banco: c.banco, apelido: c.apelido, status: item.status, statusTexto: STATUS[item.status] || item.status } };
    }

    if (b.acao === 'sincronizar') {
      const c = (await minhas()).find((x) => String(x.id) === String(b.conexaoId));
      if (!c) throw new HttpError(404, 'Conexão não encontrada.');
      const ate = DATA_RE.test(b.ate || '') ? b.ate : dataBrasil(new Date());
      const de = DATA_RE.test(b.de || '') ? b.de : dataBrasil(new Date(Date.now() - 31 * 864e5));
      if (de > ate) throw new HttpError(400, 'Período inválido.');
      let item; let contas;
      try {
        item = await client.fetchItem(c.item_id);
        contas = (await client.fetchAccounts(c.item_id)).results || [];
      } catch (e) { throw traduzir(e, 'Contas'); }
      const banco = c.apelido || item.connector?.name || c.banco;
      const transacoesPorConta = {};
      const faturasPorConta = {};
      try {
        await Promise.all(contas.map(async (conta) => {
          transacoesPorConta[conta.id] = await client.fetchAllTransactions(conta.id, { dateFrom: de, dateTo: ate });
          if (conta.type === 'CREDIT') faturasPorConta[conta.id] = (await client.fetchCreditCardBills(conta.id)).results || [];
        }));
      } catch (e) { throw traduzir(e, 'Transações'); }
      await updateRow('Conexoes', c.__row, { ...c, ultima_sincronizacao: new Date().toISOString() });
      return {
        banco, de, ate, status: item.status, atualizadoEm: item.lastUpdatedAt ? new Date(item.lastUpdatedAt).toISOString() : '',
        documentos: montarDocumentos({ banco, contas, transacoesPorConta, faturasPorConta, de, ate }),
      };
    }
    throw new HttpError(400, 'Ação inválida.');
  }

  if (req.method === 'DELETE') {
    const c = (await minhas()).find((x) => String(x.id) === String((req.query || {}).id));
    if (!c) throw new HttpError(404, 'Conexão não encontrada.');
    await deleteRow('Conexoes', c.__row);
    return { ok: true };
  }

  throw new HttpError(405, 'Método não permitido.');
});
