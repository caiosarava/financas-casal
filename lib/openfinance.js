// Open Finance via Meu Pluggy (uso pessoal e gratuito): cada pessoa tem a própria conta Pluggy.
// Credenciais por usuário em PLUGGY_CREDENCIAIS="email:clientId:clientSecret,email2:clientId2:clientSecret2"
// (variável de ambiente da Vercel — nunca na planilha, que fica no Drive de um dos dois).
// Este módulo só transforma dados; as chamadas ficam em api/openfinance.js.

export function credenciaisDe(email) {
  for (const par of String(process.env.PLUGGY_CREDENCIAIS || '').split(',')) {
    const [e, clientId, clientSecret] = par.split(':').map((x) => (x || '').trim());
    if (e && clientId && clientSecret && e.toLowerCase() === String(email).toLowerCase()) return { clientId, clientSecret };
  }
  return null;
}

// Data no fuso de Brasília (as datas da Pluggy vêm em UTC)
export const dataBrasil = (d) => (d ? new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : '');

const SUBTIPO = { CHECKING_ACCOUNT: 'conta corrente', SAVINGS_ACCOUNT: 'poupança', CREDIT_CARD: 'cartão de crédito' };
// No cartão, o crédito do pagamento da fatura é só o espelho do pagamento feito na conta (ignorado)
const PAGAMENTO_FATURA = /pagamento (recebido|de fatura|da fatura|efetuado)|inclus[aã]o de pagamento|pagto\.? fatura|credit card payment|bill payment/i;

function transacaoParaApp(t, conta) {
  const natureza = t.type === 'CREDIT' ? 'entrada' : 'saida';
  let descricao = String(t.description || t.descriptionRaw || '').replace(/\s+/g, ' ').trim();
  // Pix/TED: acrescenta o nome de quem recebeu/pagou (permite reconhecer transferências entre o casal)
  const contraparte = natureza === 'saida' ? t.paymentData?.receiver?.name : t.paymentData?.payer?.name;
  if (contraparte && !descricao.toLowerCase().includes(String(contraparte).toLowerCase().slice(0, 10))) descricao += ` - ${contraparte}`;
  const cc = t.creditCardMetadata;
  if (cc?.totalInstallments > 1 && cc.installmentNumber && !/\d{1,2}\s*\/\s*\d{1,2}/.test(descricao)) {
    descricao += ` - Parcela ${cc.installmentNumber}/${cc.totalInstallments}`;
  }
  return {
    data: dataBrasil(t.date),
    descricao: descricao.slice(0, 150) || (natureza === 'saida' ? 'Débito' : 'Crédito'),
    valor: Math.round(Math.abs(Number(t.amount) || 0) * 100) / 100,
    natureza,
    categoriaBanco: t.category || '',
    origem: 'openfinance',
    idExterno: t.id,
    _billId: cc?.billId || null,
    _conta: conta.id,
  };
}

/**
 * Converte contas/transações/faturas da Pluggy em "documentos" no formato da importação do app:
 * um extrato por conta bancária e uma fatura por vencimento em cada cartão.
 */
export function montarDocumentos({ banco, contas, transacoesPorConta, faturasPorConta, de, ate }) {
  const docs = [];
  for (const conta of contas) {
    const lista = (transacoesPorConta[conta.id] || [])
      .filter((t) => t.status !== 'PENDING' && Number(t.amount))
      .map((t) => transacaoParaApp(t, conta));
    const nomeConta = `${conta.marketingName || conta.name || SUBTIPO[conta.subtype] || 'Conta'}${conta.number ? ` ${String(conta.number).slice(-4)}` : ''}`;
    if (conta.type === 'CREDIT') {
      const faturas = new Map((faturasPorConta[conta.id] || []).map((f) => [f.id, f]));
      const grupos = new Map();
      for (const t of lista) {
        if (t.natureza === 'entrada' && PAGAMENTO_FATURA.test(t.descricao)) continue;
        const chave = t._billId && faturas.has(t._billId) ? t._billId : 'aberta';
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push(t);
      }
      for (const [chave, transacoes] of grupos) {
        const f = faturas.get(chave);
        const venc = f ? dataBrasil(f.dueDate) : '';
        docs.push({
          tipoDocumento: 'fatura_cartao', banco, vencimento: venc,
          titulo: `${banco} · ${nomeConta} · ${f ? `fatura com vencimento ${venc.split('-').reverse().join('/')}` : 'fatura em aberto'}`,
          totalFatura: f ? Number(f.totalAmount) || 0 : null,
          chave: `of:${conta.id}:${f ? `fatura:${f.id}` : `aberta:${de}:${ate}`}`,
          transacoes: transacoes.map(({ _billId, _conta, ...t }) => t),
        });
      }
    } else {
      if (!lista.length) continue;
      docs.push({
        tipoDocumento: 'extrato_bancario', banco, vencimento: '',
        titulo: `${banco} · ${nomeConta} (${SUBTIPO[conta.subtype] || 'conta'}) · ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}`,
        chave: `of:${conta.id}:${de}:${ate}`,
        transacoes: lista.map(({ _billId, _conta, ...t }) => t),
      });
    }
  }
  return docs.filter((d) => d.transacoes.length);
}
