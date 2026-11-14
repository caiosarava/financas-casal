// Cofrinhos (estilo "caixinhas"): várias metas do casal e individuais, cada uma com nome, emoji,
// valor-alvo e prazo opcionais, depósitos e resgates.
//
// escopo: 'casal' (visível e movimentável pelos dois) ou o e-mail do dono (só o dono vê).
// Aportes: valor > 0 = depósito, valor < 0 = resgate; coluna "cofrinho" = id do cofrinho.
//
// GET                                   → { cofrinhos: [...] }
// POST { acao: 'criar', nome, emoji, escopo: 'casal'|'individual', meta, prazo }
// POST { acao: 'editar', id, nome, emoji, meta, prazo }
// POST { acao: 'aporte' | 'resgate', cofrinho, valor, data, obs }
// DELETE ?id=<movimento>                → apaga um depósito/resgate próprio
// DELETE ?cofrinho=<id>&confirmar=1     → apaga o cofrinho e todas as suas movimentações
import { handler, HttpError, requireUser } from '../lib/auth.js';
import { readAll, appendRows, updateRow, updateRows, deleteRow, deleteRows, newId } from '../lib/sheets.js';

const podeVer = (escopo, email) => escopo === 'casal' || escopo === email;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n) => Math.round(n * 100) / 100;

function numero(v, { positivo = true, permitirZero = false } = {}) {
  const n = r2(Number(String(v ?? '').replace(',', '.')));
  if (!Number.isFinite(n) || n < 0 || (positivo && !permitirZero && n === 0)) throw new HttpError(400, 'Valor inválido.');
  return n;
}

function escopoValido(escopo, email) {
  if (escopo === 'casal') return 'casal';
  if (escopo === 'individual' || escopo === email) return email;
  throw new HttpError(400, 'Escopo inválido.');
}

function camposCofrinho(body) {
  const nome = String(body.nome || '').trim().slice(0, 40);
  if (!nome) throw new HttpError(400, 'Dê um nome ao cofrinho.');
  const emoji = [...String(body.emoji || '🐷').trim()].slice(0, 2).join('') || '🐷';
  const meta = body.meta === '' || body.meta === undefined || body.meta === null ? 0 : numero(body.meta, { permitirZero: true });
  const prazo = String(body.prazo || '');
  if (prazo && !DATA_RE.test(prazo)) throw new HttpError(400, 'Prazo inválido.');
  return { nome, emoji, meta, prazo };
}

/**
 * Migra as metas anuais antigas (aba Metas + aportes sem cofrinho) para cofrinhos "Meta AAAA".
 * Idempotente: só cria o que ainda não existe.
 */
async function migrarLegado(cofrinhos, aportes) {
  const semCofrinho = aportes.filter((a) => !a.cofrinho);
  const metas = await readAll('Metas');
  if (!metas.length && !semCofrinho.length) return false;
  const idLegado = (ano, escopo) => `legado-${ano}-${escopo === 'casal' ? 'casal' : escopo.split('@')[0]}`;
  const existentes = new Set(cofrinhos.map((c) => String(c.id)));
  const novos = new Map();
  const agora = new Date().toISOString();
  const garantir = (ano, escopo, meta = 0, por = '') => {
    const id = idLegado(ano, escopo);
    if (!existentes.has(id) && !novos.has(id)) {
      novos.set(id, { id, nome: `Meta ${ano}`, emoji: '🎯', escopo, meta, prazo: `${ano}-12-31`, criado_por: por || (escopo === 'casal' ? '' : escopo), criado_em: agora });
    }
    return id;
  };
  for (const m of metas) garantir(String(m.ano), m.escopo, Number(m.valor) || 0, m.atualizado_por);
  const atualizar = semCofrinho.map((a) => ({ row: a.__row, obj: { ...a, cofrinho: garantir(String(a.data).slice(0, 4), a.escopo, 0, a.usuario) } }));
  if (!novos.size && !atualizar.length) return false;
  if (novos.size) await appendRows('Cofrinhos', [...novos.values()]);
  if (atualizar.length) await updateRows('Aportes', atualizar);
  return true;
}

async function carregar() {
  let [cofrinhos, aportes] = await Promise.all([readAll('Cofrinhos'), readAll('Aportes')]);
  if (await migrarLegado(cofrinhos, aportes)) [cofrinhos, aportes] = await Promise.all([readAll('Cofrinhos'), readAll('Aportes')]);
  return { cofrinhos, aportes };
}

function publico(c, aportes, email) {
  const movimentos = aportes
    .filter((a) => String(a.cofrinho) === String(c.id))
    .map((a) => ({ id: String(a.id), data: String(a.data), valor: Number(a.valor) || 0, usuario: a.usuario, obs: a.obs, meu: a.usuario === email }))
    .sort((a, b) => b.data.localeCompare(a.data));
  return {
    id: String(c.id),
    nome: c.nome,
    emoji: c.emoji || '🐷',
    escopo: c.escopo === 'casal' ? 'casal' : 'individual',
    meta: Number(c.meta) || 0,
    prazo: c.prazo ? String(c.prazo) : '',
    criadoPor: c.criado_por,
    guardado: r2(movimentos.reduce((s, m) => s + m.valor, 0)),
    movimentos,
  };
}

export default handler(async (req) => {
  const email = requireUser(req);
  const q = req.query || {};

  if (req.method === 'GET') {
    const { cofrinhos, aportes } = await carregar();
    return {
      cofrinhos: cofrinhos
        .filter((c) => podeVer(c.escopo, email))
        .map((c) => publico(c, aportes, email))
        .sort((a, b) => (a.escopo === b.escopo ? a.nome.localeCompare(b.nome) : a.escopo === 'casal' ? -1 : 1)),
    };
  }

  if (req.method === 'POST') {
    const body = req.body || {};

    if (body.acao === 'criar') {
      const c = { id: newId(), ...camposCofrinho(body), escopo: escopoValido(body.escopo, email), criado_por: email, criado_em: new Date().toISOString() };
      await appendRows('Cofrinhos', [c]);
      return { cofrinho: publico(c, [], email) };
    }

    const { cofrinhos, aportes } = await carregar();
    const alvoId = body.acao === 'editar' ? body.id : body.cofrinho;
    const c = cofrinhos.find((x) => String(x.id) === String(alvoId));
    if (!c || !podeVer(c.escopo, email)) throw new HttpError(404, 'Cofrinho não encontrado.');

    if (body.acao === 'editar') {
      const novo = { ...c, ...camposCofrinho(body) };
      await updateRow('Cofrinhos', c.__row, novo);
      return { cofrinho: publico(novo, aportes, email) };
    }

    if (body.acao === 'aporte' || body.acao === 'resgate') {
      const valor = numero(body.valor);
      const data = String(body.data || new Date().toISOString().slice(0, 10));
      if (!DATA_RE.test(data)) throw new HttpError(400, 'Data inválida.');
      if (body.acao === 'resgate') {
        const guardado = publico(c, aportes, email).guardado;
        if (valor > guardado + 0.001) throw new HttpError(400, `Só há ${guardado.toFixed(2).replace('.', ',')} guardados neste cofrinho.`);
      }
      await appendRows('Aportes', [{
        id: newId(), data, valor: body.acao === 'resgate' ? -valor : valor, escopo: c.escopo, usuario: email,
        obs: String(body.obs || '').slice(0, 200), criado_em: new Date().toISOString(), cofrinho: String(c.id),
      }]);
      return { ok: true };
    }
    throw new HttpError(400, 'Ação inválida.');
  }

  if (req.method === 'DELETE') {
    const { cofrinhos, aportes } = await carregar();
    if (q.cofrinho) {
      const c = cofrinhos.find((x) => String(x.id) === String(q.cofrinho));
      if (!c || !podeVer(c.escopo, email)) throw new HttpError(404, 'Cofrinho não encontrado.');
      if (q.confirmar !== '1') throw new HttpError(400, 'Confirmação ausente.');
      await deleteRows('Aportes', aportes.filter((a) => String(a.cofrinho) === String(c.id)).map((a) => a.__row));
      await deleteRow('Cofrinhos', c.__row);
      return { ok: true };
    }
    const atual = aportes.find((a) => String(a.id) === String(q.id));
    if (!atual || !podeVer(atual.escopo, email)) throw new HttpError(404, 'Movimentação não encontrada.');
    if (atual.usuario !== email) throw new HttpError(403, 'Só quem registrou pode excluir esta movimentação.');
    await deleteRow('Aportes', atual.__row);
    return { ok: true };
  }

  throw new HttpError(405, 'Método não permitido.');
});
