// Parcelamentos de fatura (pagamento parcial da fatura do cartão).
// Quando a fatura não é paga inteira, o restante é financiado em parcelas que aparecem nas faturas seguintes
// ("Parcelamento de fatura k/n"). Cada parcela = amortização (devolução de compras já contadas como gasto,
// NÃO é gasto novo) + juros (gasto). Este cadastro guarda o valor financiado para separar as duas partes
// e acompanhar o saldo devedor.
//
// GET → { itens }  ·  POST { acao: 'criar' | 'editar' | 'parcela', ... }  ·  DELETE ?id=
import { handler, HttpError, requireUser, userNames } from '../lib/auth.js';
import { readAll, appendRows, updateRow, deleteRow, newId } from '../lib/sheets.js';

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v, nome, { obrigatorio = true } = {}) => {
  if (!obrigatorio && (v === '' || v === undefined || v === null)) return 0;
  const n = r2(Number(String(v).replace(',', '.')));
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${nome} inválido.`);
  return n;
};

export function calcular(p) {
  const financiado = r2(Math.max(0, (Number(p.total_fatura) || 0) - (Number(p.valor_pago) || 0)));
  const parcelas = Math.max(1, Number(p.parcelas) || 1);
  const valorParcela = Number(p.valor_parcela) || 0;
  const pagas = Math.min(parcelas, Math.max(0, Number(p.parcelas_pagas) || 0));
  const totalParcelado = r2(parcelas * valorParcela);
  const juros = valorParcela ? r2(Math.max(0, totalParcelado - financiado)) : 0;
  return {
    financiado, parcelas, valorParcela, pagas, totalParcelado, juros,
    amortizacaoParcela: valorParcela ? r2(Math.min(valorParcela, financiado / parcelas)) : 0,
    jurosParcela: valorParcela ? r2(Math.max(0, valorParcela - financiado / parcelas)) : 0,
    saldoDevedor: r2((parcelas - pagas) * valorParcela),
    quitado: pagas >= parcelas,
  };
}

function campos(b) {
  const vencimento = String(b.vencimento || '');
  if (!DATA_RE.test(vencimento)) throw new HttpError(400, 'Informe o vencimento da fatura.');
  const total = num(b.totalFatura, 'Total da fatura');
  const pago = num(b.valorPago, 'Valor pago', { obrigatorio: false });
  if (pago >= total) throw new HttpError(400, 'O valor pago é igual ou maior que a fatura: não há parcelamento.');
  const parcelas = Math.round(Number(b.parcelas));
  if (!(parcelas >= 1 && parcelas <= 48)) throw new HttpError(400, 'Número de parcelas inválido (1 a 48).');
  const valorParcela = num(b.valorParcela, 'Valor da parcela', { obrigatorio: false });
  return {
    cartao: String(b.cartao || 'Cartão').trim().slice(0, 40),
    vencimento, rotulo: String(b.rotulo || '').trim().slice(0, 30),
    total_fatura: total, valor_pago: pago, parcelas, valor_parcela: valorParcela,
    parcelas_pagas: Math.min(parcelas, Math.max(0, Math.round(Number(b.parcelasPagas) || 0))),
    compartilhado: b.compartilhado === false || b.compartilhado === 'NAO' ? 'NAO' : 'SIM',
  };
}

const publico = (p, email, nomes) => ({
  id: String(p.id), usuario: p.usuario, nomeUsuario: nomes[p.usuario] || p.usuario, meu: p.usuario === email,
  cartao: p.cartao, vencimento: String(p.vencimento), rotulo: p.rotulo || '', compartilhado: p.compartilhado !== 'NAO',
  totalFatura: Number(p.total_fatura) || 0, valorPago: Number(p.valor_pago) || 0,
  ...calcular(p),
});

export default handler(async (req) => {
  const email = requireUser(req);
  const nomes = userNames();
  const visivel = (p) => p.usuario === email || p.compartilhado !== 'NAO';

  if (req.method === 'GET') {
    const itens = (await readAll('Parcelamentos')).filter(visivel).map((p) => publico(p, email, nomes))
      .sort((a, b) => Number(a.quitado) - Number(b.quitado) || b.vencimento.localeCompare(a.vencimento));
    return { itens };
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (b.acao === 'criar') {
      const p = { id: newId(), usuario: email, ...campos(b), criado_em: new Date().toISOString() };
      await appendRows('Parcelamentos', [p]);
      return { item: publico(p, email, nomes) };
    }
    const rows = await readAll('Parcelamentos');
    const atual = rows.find((p) => String(p.id) === String(b.id));
    if (!atual || !visivel(atual)) throw new HttpError(404, 'Parcelamento não encontrado.');
    if (atual.usuario !== email) throw new HttpError(403, 'Só quem cadastrou pode alterar este parcelamento.');
    if (b.acao === 'editar') {
      const novo = { ...atual, ...campos(b) };
      await updateRow('Parcelamentos', atual.__row, novo);
      return { item: publico(novo, email, nomes) };
    }
    if (b.acao === 'parcela') {
      // Registra que a parcela k/n apareceu numa fatura importada (só avança)
      const k = Math.round(Number(b.parcela));
      const n = Number(atual.parcelas) || 1;
      if (!(k >= 1 && k <= n)) throw new HttpError(400, 'Parcela inválida.');
      const novo = { ...atual, parcelas_pagas: Math.max(Number(atual.parcelas_pagas) || 0, k) };
      if (!Number(atual.valor_parcela) && b.valorParcela) novo.valor_parcela = num(b.valorParcela, 'Valor da parcela');
      await updateRow('Parcelamentos', atual.__row, novo);
      return { item: publico(novo, email, nomes) };
    }
    throw new HttpError(400, 'Ação inválida.');
  }

  if (req.method === 'DELETE') {
    const rows = await readAll('Parcelamentos');
    const atual = rows.find((p) => String(p.id) === String((req.query || {}).id));
    if (!atual || !visivel(atual)) throw new HttpError(404, 'Parcelamento não encontrado.');
    if (atual.usuario !== email) throw new HttpError(403, 'Só quem cadastrou pode excluir este parcelamento.');
    await deleteRow('Parcelamentos', atual.__row);
    return { ok: true };
  }

  throw new HttpError(405, 'Método não permitido.');
});
