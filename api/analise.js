// Análise financeira com o Gemini (Google): complementa a leitura dos lançamentos com
// insights sobre gastos — recorrências, parcelamentos, tarifas, alertas e dicas de economia.
//
// POST { modo: 'mes', mes: 'AAAA-MM', visao: 'todos'|'casal'|'meus' }
//   → analisa os lançamentos do mês que o usuário pode ver (lidos da planilha), comparando com o mês anterior.
// POST { modo: 'importacao', transacoes: [...], tipoDocumento, vencimento, banco, nomeArquivo }
//   → analisa o extrato/fatura recém-enviado, antes ou depois de salvar.
import { GoogleGenAI, ApiError } from '@google/genai';
import { handler, HttpError, requireUser, userNames } from '../lib/auth.js';
import { readAll } from '../lib/sheets.js';

const MODELO = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// Modelos de reserva usados quando o principal está sobrecarregado (503) ou sem cota (429)
const RESERVAS = () => (process.env.GEMINI_MODELOS_RESERVA ?? 'gemini-3.8-flash-lite')
  .split(',').map((m) => m.trim()).filter((m) => m && m !== MODELO());
const TEMPORARIO = new Set([429, 500, 502, 503, 504]);
const MAX_LINHAS = 1500;

const SCHEMA = {
  type: 'object',
  required: ['resumo', 'destaques', 'recorrentes', 'parcelamentos', 'dicas'],
  properties: {
    resumo: { type: 'string', description: 'Visão geral em 2 a 3 frases, em português do Brasil.' },
    destaques: {
      type: 'array',
      maxItems: 6,
      description: 'Observações mais relevantes, da mais importante para a menos importante.',
      items: {
        type: 'object',
        required: ['nivel', 'titulo', 'detalhe'],
        properties: {
          nivel: { type: 'string', enum: ['alerta', 'atencao', 'positivo', 'info'] },
          titulo: { type: 'string', description: 'Curto, até 60 caracteres.' },
          detalhe: { type: 'string', description: 'Uma ou duas frases com os valores envolvidos.' },
        },
      },
    },
    recorrentes: {
      type: 'array',
      maxItems: 15,
      description: 'Assinaturas e cobranças que se repetem todo mês (streaming, apps, seguros, mensalidades).',
      items: {
        type: 'object',
        required: ['descricao', 'valor'],
        properties: { descricao: { type: 'string' }, valor: { type: 'number' } },
      },
    },
    parcelamentos: {
      type: 'array',
      maxItems: 20,
      description: 'Compras parceladas e parcelamentos de fatura identificados, com a parcela atual.',
      items: {
        type: 'object',
        required: ['descricao', 'parcela', 'valor'],
        properties: {
          descricao: { type: 'string' },
          parcela: { type: 'string', description: 'Ex.: "3/10".' },
          valor: { type: 'number', description: 'Valor desta parcela.' },
        },
      },
    },
    dicas: { type: 'array', maxItems: 5, items: { type: 'string' }, description: 'Sugestões práticas e específicas de economia.' },
  },
};

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
  const todos = [...visiveis(gastos, 'saida'), ...visiveis(entradas, 'entrada')];
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
    .filter((t) => t.valor > 0);
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

let ai;

export default handler(async (req) => {
  const email = requireUser(req);
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido.');
  if (!process.env.GEMINI_API_KEY) throw new HttpError(501, 'Análise com Gemini não configurada (GEMINI_API_KEY ausente).');

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

  // Repete automaticamente erros temporários (408/429/5xx): até 3 tentativas por modelo, com espera crescente
  ai ||= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { retryOptions: { attempts: 3, initialDelay: 1.5, maxDelay: 8, httpStatusCodes: [408, ...TEMPORARIO] } },
  });
  let resposta;
  let modeloUsado;
  let erroPrincipal;
  for (const modelo of [MODELO(), ...RESERVAS()]) {
    try {
      resposta = await ai.models.generateContent({
        model: modelo,
        contents: ctx.texto,
        config: {
          systemInstruction: SISTEMA,
          responseMimeType: 'application/json',
          responseJsonSchema: SCHEMA,
        },
      });
      modeloUsado = modelo;
      break;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (modelo === MODELO()) {
        erroPrincipal = err;
        // Só vale tentar outro modelo quando o problema é sobrecarga/cota, não chave ou pedido inválido
        if (TEMPORARIO.has(err.status)) { console.warn(`Gemini ${modelo} indisponível (${err.status}); tentando reserva.`); continue; }
      } else {
        console.warn(`Gemini reserva ${modelo} falhou (${err.status}).`);
        continue;
      }
      break;
    }
  }
  if (!resposta) {
    const err = erroPrincipal;
    if (err.status === 503 || err.status === 500 || err.status === 502 || err.status === 504) {
      throw new HttpError(503, 'O Gemini está sobrecarregado agora (alta demanda no Google). Já tentamos de novo automaticamente — aguarde alguns minutos e toque em "Tentar novamente".');
    }
    if (err.status === 429) throw new HttpError(429, 'Limite de uso do Gemini atingido. Aguarde um pouco e tente novamente.');
    if (err.status === 400 || err.status === 401 || err.status === 403) throw new HttpError(500, `Gemini recusou a chamada (verifique GEMINI_API_KEY e GEMINI_MODEL): ${err.message}`);
    if (err.status === 404) throw new HttpError(500, `Modelo "${MODELO()}" não encontrado. Ajuste GEMINI_MODEL.`);
    throw new HttpError(502, `Falha no Gemini (${err.status}). Tente novamente.`);
  }

  let dados;
  try {
    dados = JSON.parse(resposta.text || '');
  } catch {
    throw new HttpError(502, 'O Gemini não retornou uma análise válida. Tente novamente.');
  }
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
