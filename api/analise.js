// Análise financeira com IA (OpenAI, com a NVIDIA como reserva): complementa a leitura dos lançamentos com
// insights sobre gastos — recorrências, parcelamentos, tarifas, alertas e dicas de economia.
//
// POST { modo: 'mes', mes: 'AAAA-MM', visao: 'todos'|'casal'|'meus' }
//   → analisa os lançamentos do mês que o usuário pode ver (lidos da planilha), comparando com o mês anterior.
// POST { modo: 'importacao', transacoes: [...], tipoDocumento, vencimento, banco, nomeArquivo }
//   → analisa o extrato/fatura recém-enviado, antes ou depois de salvar.
import { gerarJson, provedoresAtivos } from '../lib/ia.js';
import { handler, HttpError, requireUser, userNames } from '../lib/auth.js';
import { readAll } from '../lib/sheets.js';
import { TIPOS_FORA_DO_SALDO } from '../lib/categorias.js';

const MAX_LINHAS = 1500;

// Formato esperado da resposta (enviado ao modelo como exemplo)
const FORMATO = `{
  "resumo": "visão geral em 2 a 3 frases",
  "destaques": [{ "nivel": "alerta | atencao | positivo | info", "titulo": "até 60 caracteres", "detalhe": "1 ou 2 frases com os valores" }],
  "recorrentes": [{ "descricao": "assinatura ou cobrança mensal", "valor": 0.0 }],
  "parcelamentos": [{ "descricao": "compra parcelada", "parcela": "3/10", "valor": 0.0 }],
  "dicas": ["sugestão prática e específica"]
}
Limites: até 6 destaques (do mais para o menos importante), 15 recorrentes, 20 parcelamentos e 5 dicas. Valores numéricos em reais com ponto decimal.`;

const SISTEMA = `Você é um consultor financeiro de um casal brasileiro e analisa os gastos e entradas deles.
Escreva em português do Brasil, em tom direto, amigável e sem julgamentos.

Regras:
- Use SOMENTE os números fornecidos (os totais já vêm calculados). Não invente valores; arredonde para reais (R$ 1.234,56).
- Procure: categorias que mais pesam, variações relevantes em relação ao período anterior (quando houver),
  assinaturas e cobranças recorrentes, parcelamentos em andamento (inclusive "parcelamento de fatura", que costuma ter juros altos),
  IOF, tarifas e juros, gastos repetidos no mesmo dia/estabelecimento que podem ser cobrança duplicada,
  compras muito acima do padrão, e se o saldo do mês (entradas − gastos) está positivo.
- Níveis dos destaques: "alerta" = possível problema ou custo evitável relevante; "atencao" = merece acompanhamento;
  "positivo" = algo bom; "info" = observação neutra.
- Dicas devem ser concretas e baseadas nos lançamentos (ex.: "cancelar X e Y economizaria R$ Z por mês").
- Se houver poucos dados, diga isso no resumo e faça menos destaques.`;

const r2 = (n) => Math.round(n * 100) / 100;

function agrega(lista) {
  const porTipo = {};
  for (const t of lista) porTipo[t.tipo] = r2((porTipo[t.tipo] || 0) + t.valor);
  return {
    total: r2(lista.reduce((s, t) => s + t.valor, 0)),
    quantidade: lista.length,
    porTipo: Object.fromEntries(Object.entries(porTipo).sort((a, b) => b[1] - a[1])),
  };
}

function linhas(lista) {
  return lista.slice(0, MAX_LINHAS).map((t) => `${t.data} | ${t.natureza === 'entrada' ? 'ENTRADA' : 'GASTO'} | ${t.tipo} | ${r2(t.valor)} | ${String(t.descricao || '').slice(0, 80)}${t.pessoa ? ` | ${t.pessoa}` : ''}`).join('\n');
}

function anterior(mes) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function contextoDoMes(email, mes, visao) {
  const nomes = userNames();
  const [gastos, entradas] = await Promise.all([readAll('Gastos'), readAll('Entradas')]);
  const visiveis = (rows, natureza) => rows
    .filter((g) => g.usuario === email || g.compartilhado !== 'NAO')
    .filter((g) => (visao === 'casal' ? g.compartilhado !== 'NAO' : visao === 'meus' ? g.usuario === email : true))
    .map((g) => ({ data: String(g.data), valor: Number(g.valor) || 0, tipo: g.tipo, descricao: g.descricao, natureza, pessoa: nomes[g.usuario] || g.usuario }));
  const todosComInternas = [...visiveis(gastos, 'saida'), ...visiveis(entradas, 'entrada')];
  const internas = todosComInternas.filter((t) => TIPOS_FORA_DO_SALDO.has(t.tipo) && t.data.startsWith(mes));
  const todos = todosComInternas.filter((t) => !TIPOS_FORA_DO_SALDO.has(t.tipo));
  const doMes = (m) => todos.filter((t) => t.data.startsWith(m));
  const atual = doMes(mes);
  const ant = doMes(anterior(mes));
  const resumo = (lista) => {
    const g = lista.filter((t) => t.natureza === 'saida');
    const e = lista.filter((t) => t.natureza === 'entrada');
    const porPessoa = {};
    for (const t of g) porPessoa[t.pessoa] = r2((porPessoa[t.pessoa] || 0) + t.valor);
    return { gastos: agrega(g), entradas: agrega(e), saldo: r2(agrega(e).total - agrega(g).total), gastosPorPessoa: porPessoa };
  };
  const filtro = { todos: 'todos os lançamentos visíveis', casal: 'somente lançamentos compartilhados do casal', meus: 'somente os lançamentos do próprio usuário' }[visao] || 'todos';
  return {
    vazio: !atual.length,
    texto: `Período analisado: ${mes} (${filtro}). Usuário que pediu a análise: ${nomes[email]}.

TOTAIS DO MÊS (calculados):
${JSON.stringify(resumo(atual), null, 1)}

TOTAIS DO MÊS ANTERIOR (${anterior(mes)}), para comparação:
${ant.length ? JSON.stringify(resumo(ant), null, 1) : 'sem lançamentos'}

TRANSFERÊNCIAS INTERNAS E AMORTIZAÇÃO DE PARCELAMENTO DE FATURA (NÃO são gastos nem entradas, já excluídas dos totais;
os juros dos parcelamentos estão nos gastos como "Tarifas e juros"):
${internas.length ? `${internas.length} movimentações, R$ ${r2(internas.reduce((s, t) => s + t.valor, 0))}` : 'nenhuma'}

LANÇAMENTOS DO MÊS (data | natureza | tipo | valor | descrição | pessoa):
${linhas(atual.sort((a, b) => a.data.localeCompare(b.data)))}`,
  };
}

function contextoDaImportacao(body) {
  const lista = (Array.isArray(body.transacoes) ? body.transacoes : [])
    .slice(0, MAX_LINHAS)
    .map((t) => ({
      data: String(t.data || '').slice(0, 10),
      valor: Math.abs(Number(t.valor)) || 0,
      tipo: String(t.tipo || 'Outros').slice(0, 40),
      descricao: String(t.descricao || '').slice(0, 120),
      natureza: t.natureza === 'entrada' ? 'entrada' : 'saida',
    }))
    .filter((t) => t.valor > 0 && !TIPOS_FORA_DO_SALDO.has(t.tipo));
  const g = lista.filter((t) => t.natureza === 'saida');
  const e = lista.filter((t) => t.natureza === 'entrada');
  const tipoDoc = { fatura_cartao: 'fatura de cartão de crédito', extrato_bancario: 'extrato bancário' }[body.tipoDocumento] || 'extrato ou fatura';
  return {
    vazio: !lista.length,
    texto: `Documento enviado: ${tipoDoc}${body.banco ? ` (${String(body.banco).slice(0, 60)})` : ''}${body.vencimento ? `, vencimento ${String(body.vencimento).slice(0, 10)}` : ''}${body.nomeArquivo ? `, arquivo "${String(body.nomeArquivo).slice(0, 80)}"` : ''}.
Analise este documento isoladamente (não há período anterior para comparar).

TOTAIS (calculados):
${JSON.stringify({ gastos: agrega(g), entradas: agrega(e) }, null, 1)}

LANÇAMENTOS (data da compra | natureza | tipo | valor | descrição):
${linhas(lista.sort((a, b) => a.data.localeCompare(b.data)))}`,
  };
}


export default handler(async (req) => {
  const email = requireUser(req);
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido.');
  if (!provedoresAtivos().length) throw new HttpError(501, 'Análise com IA não configurada (cadastre OPENAI_API_KEY ou NVIDIA_API_KEY).');

  const body = req.body || {};
  let ctx;
  if (body.modo === 'mes') {
    if (!/^\d{4}-\d{2}$/.test(String(body.mes || ''))) throw new HttpError(400, 'Mês inválido (use AAAA-MM).');
    ctx = await contextoDoMes(email, body.mes, ['todos', 'casal', 'meus'].includes(body.visao) ? body.visao : 'todos');
  } else if (body.modo === 'importacao') {
    ctx = contextoDaImportacao(body);
  } else {
    throw new HttpError(400, 'Modo inválido (use "mes" ou "importacao").');
  }
  if (ctx.vazio) throw new HttpError(422, 'Não há lançamentos para analisar neste período.');

  const { dados, modelo: modeloUsado } = await gerarJson({ sistema: SISTEMA, texto: ctx.texto, formato: FORMATO });
  const lista = (v) => (Array.isArray(v) ? v : []);
  return {
    modelo: modeloUsado,
    resumo: String(dados.resumo || ''),
    destaques: lista(dados.destaques).slice(0, 6).map((d) => ({
      nivel: ['alerta', 'atencao', 'positivo', 'info'].includes(d.nivel) ? d.nivel : 'info',
      titulo: String(d.titulo || ''),
      detalhe: String(d.detalhe || ''),
    })),
    recorrentes: lista(dados.recorrentes).slice(0, 15).map((r) => ({ descricao: String(r.descricao || ''), valor: Number(r.valor) || 0 })),
    parcelamentos: lista(dados.parcelamentos).slice(0, 20).map((p) => ({ descricao: String(p.descricao || ''), parcela: String(p.parcela || ''), valor: Number(p.valor) || 0 })),
    dicas: lista(dados.dicas).slice(0, 5).map(String),
  };
});
