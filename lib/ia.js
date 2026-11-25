// Cliente de IA para a análise financeira. Provedores com API no formato "chat completions" da OpenAI:
//   1. OpenAI   (OPENAI_API_KEY)  — principal, se configurado
//   2. NVIDIA   (NVIDIA_API_KEY)  — reserva (ou principal, se só ele estiver configurado)
// As chaves ficam SOMENTE em variáveis de ambiente (Vercel), nunca no código.
// Cada provedor: modelo configurável; se ele não existir/for aposentado, escolhe outro pela lista de modelos (/v1/models).
import { HttpError } from './auth.js';

const TEMPORARIO = new Set([408, 429, 500, 502, 503, 504]);
const TENTATIVAS_POR_MODELO = 3;
const TEMPO_LIMITE_MS = 55_000;
// A função da Vercel tem 120 s (vercel.json): todas as tentativas juntas param antes disso
const PRAZO_TOTAL_MS = 100_000;
const MAX_TOKENS = 6144;
const MAX_DESCOBERTOS = 4; // quantos modelos da lista tentar, no máximo, por provedor
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const lista = (v) => String(v || '').split(',').map((m) => m.trim()).filter(Boolean);

const PROVEDORES = {
  openai: {
    nome: 'OpenAI',
    chave: () => process.env.OPENAI_API_KEY,
    url: () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    modelos: () => [...new Set([(process.env.OPENAI_MODEL || 'gpt-5.4-mini').trim(), ...lista(process.env.OPENAI_MODELOS_RESERVA)])],
    // Modelos GPT-5+: max_completion_tokens e reasoning_effort (temperature/top_p personalizados não são aceitos)
    corpo: (modelo, mensagens) => ({
      model: modelo, messages: mensagens, response_format: { type: 'json_object' },
      max_completion_tokens: MAX_TOKENS, ...(/^(gpt-5|gpt-6|o\d)/.test(modelo) ? { reasoning_effort: 'low' } : { temperature: 0.2 }),
    }),
    naoConversa: /embed|whisper|tts|transcri|dall-e|image|audio|realtime|moderation|search|computer|codex|davinci|babbage|sora|healthcare|-pro\b|deep-research|diarize/i,
    // Preferência: versões "mini" mais novas (rápidas e baratas), depois as completas
    preferencia: [/^gpt-\d+(\.\d+)?-mini$/i, /^gpt-4\.1-mini$/i, /^gpt-4o-mini$/i, /^gpt-\d+(\.\d+)?$/i, /^gpt-4\.1$/i, /^gpt-4o$/i],
  },
  nvidia: {
    nome: 'NVIDIA',
    chave: () => process.env.NVIDIA_API_KEY,
    url: () => (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, ''),
    // Sem NVIDIA_MODEL, escolhe pela lista (a NVIDIA aposenta modelos com frequência — erro 410)
    modelos: () => [...new Set([(process.env.NVIDIA_MODEL || '').trim(), ...lista(process.env.NVIDIA_MODELOS_RESERVA)].filter(Boolean))],
    corpo: (modelo, mensagens) => ({
      model: modelo, messages: mensagens, temperature: 0.2, top_p: 0.7, max_tokens: MAX_TOKENS, stream: false,
      response_format: { type: 'json_object' },
    }),
    naoConversa: /embed|rerank|retriev|guard|safety|reward|clip|vision|[-_]vl\b|vlm|ocr|parse|asr|tts|whisper|audio|speech|coder|codestral|starcoder|math|bge|\be5\b|paligemma|kosmos|fuyu|neva|vila|deplot|cosmos|flux|sdxl|stable-?diffusion|riva|translat|pii|content-safety|topic-control|jailbreak|nemoguard|calibration|structured-gen|-base\b/i,
    preferencia: [
      /nemotron.*(super|ultra)/i, /llama-?4/i, /qwen-?3/i, /deepseek-?(v3|chat)/i, /mistral-(large|medium)/i, /gpt-oss/i,
      /llama-?3\.\d.*(405b|70b)/i, /gemma-?3/i, /mistral|mixtral/i, /nemotron/i, /llama/i, /instruct|chat/i,
    ],
  },
};
/** Provedores configurados, na ordem em que serão tentados. */
export const provedoresAtivos = () => Object.keys(PROVEDORES).filter((p) => PROVEDORES[p].chave());
const modeloQueFuncionou = {}; // por provedor, enquanto a função estiver "quente"

class ErroIA extends Error {
  constructor(status, mensagem, codigo = '') { super(mensagem); this.status = status; this.codigo = codigo; }
}

/** Lista os modelos de conversa de um provedor, em ordem de preferência. */
export function escolherModelos(ids, provedor = 'nvidia') {
  const p = PROVEDORES[provedor];
  const pontos = (id) => { const i = p.preferencia.findIndex((re) => re.test(id)); return i < 0 ? 99 : i; };
  const versao = (id) => Number((id.match(/gpt-(\d+(?:\.\d+)?)/i) || [])[1] || 0);
  const tamanho = (id) => Number((id.match(/(\d+(?:\.\d+)?)b\b/i) || [])[1] || 0);
  return [...new Set(ids)].filter((id) => !p.naoConversa.test(id) && pontos(id) < 99)
    .sort((a, b) => pontos(a) - pontos(b) || versao(b) - versao(a) || tamanho(b) - tamanho(a) || a.localeCompare(b));
}

async function listarModelos(provedor) {
  const p = PROVEDORES[provedor];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${p.url()}/models`, { signal: ctrl.signal, headers: { Authorization: `Bearer ${p.chave()}`, Accept: 'application/json' } });
    if (!res.ok) throw new ErroIA(res.status, `lista de modelos: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return (j.data || []).map((m) => m.id).filter(Boolean);
  } catch (e) {
    if (e instanceof ErroIA) throw e;
    throw new ErroIA(502, `lista de modelos: ${e.name === 'AbortError' ? 'tempo esgotado' : e.message}`);
  } finally { clearTimeout(timer); }
}

// Conserta defeitos comuns de JSON gerado por modelos (sobretudo em português)
function repararJson(t) {
  return t
    .replace(/[“”„‟]/g, '"').replace(/[‘’]/g, "'")
    .replace(/^\s*\/\/.*$/gm, '') // comentários de linha
    .replace(/:\s*R\$\s*/g, ': ') // "valor": R$ 39,90
    .replace(/:\s*(-?)(\d{1,3}(?:\.\d{3})+),(\d+)(?=\s*[,}\]\n])/g, (_, s, i, d) => `: ${s}${i.replace(/\./g, '')}.${d}`) // 1.234,56
    .replace(/:\s*(-?\d+),(\d{1,2})(?=\s*[,}\]\n])/g, ': $1.$2') // 39,90
    .replace(/,\s*([}\]])/g, '$1'); // vírgula sobrando
}

// Fecha chaves/colchetes/aspas de uma resposta cortada pelo limite de tamanho
function fecharTruncado(t) {
  const pilha = [];
  let emString = false;
  let escape = false;
  for (const c of t) {
    if (emString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') emString = false;
      continue;
    }
    if (c === '"') emString = true;
    else if (c === '{' || c === '[') pilha.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') pilha.pop();
  }
  let r = t;
  if (emString) r += '"';
  r = r.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
  return r + pilha.reverse().join('');
}

/** Extrai o objeto JSON da resposta (ignora <think>…</think>, cercas de código e texto em volta; repara defeitos comuns). */
export function extrairJson(texto) {
  const t0 = String(texto || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json)?/gi, '').trim();
  const ini = t0.indexOf('{');
  if (ini < 0) throw new Error('sem JSON');
  const fim = t0.lastIndexOf('}');
  const candidatos = [];
  if (fim > ini) candidatos.push(t0.slice(ini, fim + 1));
  candidatos.push(t0.slice(ini)); // pode estar truncado
  for (const c of candidatos) {
    for (const v of [c, repararJson(c), fecharTruncado(repararJson(c))]) {
      try {
        const j = JSON.parse(v);
        if (j && typeof j === 'object' && !Array.isArray(j)) return j;
      } catch { /* tenta o próximo */ }
    }
  }
  throw new Error('JSON inválido');
}

async function chamar(provedor, corpo, limiteMs) {
  const p = PROVEDORES[provedor];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, limiteMs));
  try {
    const res = await fetch(`${p.url()}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${p.chave()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpo),
    });
    const texto = await res.text();
    if (!res.ok) {
      let msg = texto.slice(0, 300);
      let codigo = '';
      try {
        const j = JSON.parse(texto);
        msg = j.error?.message || j.detail || j.message || j.title || msg;
        codigo = j.error?.code || j.error?.type || '';
      } catch { /* texto puro */ }
      throw new ErroIA(res.status, String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300), String(codigo));
    }
    const j = JSON.parse(texto);
    const m = j.choices?.[0]?.message || {};
    // Modelos de raciocínio podem deixar "content" vazio e pôr o texto em reasoning_content
    return { conteudo: m.content || m.reasoning_content || '', fim: j.choices?.[0]?.finish_reason || '' };
  } catch (e) {
    if (e instanceof ErroIA) throw e;
    if (e.name === 'AbortError') throw new ErroIA(504, 'tempo esgotado');
    throw new ErroIA(502, e.message);
  } finally { clearTimeout(timer); }
}

const semCreditos = (e) => e.status === 402 || e.codigo === 'insufficient_quota' || /no credits|exceeded your current quota|insufficient[_ ]quota|billing/i.test(e.message);
const chaveRecusada = (e) => e.status === 401 || (e.status === 403 && !semCreditos(e));
const indisponivel = (st) => st === 404 || st === 410 || st === 400 || st === 422;

// Erro que encerra o provedor (sem créditos / chave recusada): passa para o próximo provedor
class FimDoProvedor extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

async function tentarProvedor(provedor, mensagens, tentativas, restante) {
  const p = PROVEDORES[provedor];
  const fila = [...new Set([modeloQueFuncionou[provedor], ...p.modelos()].filter(Boolean))];
  let consultouLista = false;
  const tentados = new Set();
  while (true) {
    if (!fila.length) {
      // Sem modelo configurado, ou os configurados foram aposentados/indisponíveis: escolhe pela lista do provedor
      if (consultouLista || restante() < 8000) return null;
      consultouLista = true;
      try {
        const disponiveis = escolherModelos(await listarModelos(provedor), provedor).filter((m) => !tentados.has(m)).slice(0, MAX_DESCOBERTOS);
        if (!disponiveis.length) tentativas.push({ modelo: `${p.nome} · lista`, status: 'vazio', msg: 'nenhum modelo de conversa disponível para esta chave' });
        fila.push(...disponiveis);
      } catch (e) {
        tentativas.push({ modelo: `${p.nome} · lista`, status: e.status, msg: e.message });
        if (chaveRecusada(e)) throw new FimDoProvedor(401, `${p.nome}: chave recusada (${e.message})`);
        return null;
      }
      continue;
    }
    const modelo = fila.shift();
    if (tentados.has(modelo)) continue;
    tentados.add(modelo);
    if (restante() < 5000) return null;
    const corpo = p.corpo(modelo, mensagens);
    let ajustes = 0;
    let formatoRuim = 0;
    for (let tentativa = 1; tentativa <= TENTATIVAS_POR_MODELO && restante() > 5000; tentativa++) {
      try {
        const { conteudo, fim } = await chamar(provedor, corpo, Math.min(TEMPO_LIMITE_MS, restante()));
        try {
          const dados = extrairJson(conteudo);
          modeloQueFuncionou[provedor] = modelo;
          return { dados, modelo: `${modelo} (${p.nome})` };
        } catch {
          formatoRuim++;
          tentativas.push({ modelo: `${p.nome} · ${modelo}`, status: 'formato', msg: `resposta sem JSON válido${fim === 'length' ? ' (cortada pelo limite de tamanho)' : ''}: ${String(conteudo).replace(/\s+/g, ' ').slice(0, 160) || '(vazia)'}` });
          console.warn(`${p.nome} ${modelo}: resposta fora do formato (${fim}): ${String(conteudo).slice(0, 300)}`);
          if (formatoRuim >= 2) break;
          continue;
        }
      } catch (e) {
        tentativas.push({ modelo: `${p.nome} · ${modelo}`, status: e.status, msg: e.message });
        console.warn(`${p.nome} ${modelo} falhou (${e.status}): ${e.message}`);
        if (semCreditos(e)) throw new FimDoProvedor(402, `${p.nome}: sem créditos`);
        if (chaveRecusada(e)) throw new FimDoProvedor(401, `${p.nome}: chave recusada`);
        // Parâmetro não aceito por este modelo: remove o(s) citado(s) na mensagem e repete (sem contar tentativa)
        if ((e.status === 400 || e.status === 422) && ajustes < 4) {
          const citados = Object.keys(corpo).filter((k) => !['model', 'messages'].includes(k) && e.message.includes(k));
          const remover = citados.length ? citados : ('response_format' in corpo ? ['response_format'] : []);
          if (remover.length) {
            for (const k of remover) {
              if (k === 'max_completion_tokens') corpo.max_tokens = corpo[k];
              else if (k === 'max_tokens') corpo.max_completion_tokens = corpo[k];
              delete corpo[k];
            }
            ajustes++;
            tentativa--;
            continue;
          }
        }
        if (TEMPORARIO.has(e.status) && tentativa < TENTATIVAS_POR_MODELO && restante() > 8000) {
          await espera(1500 * 2 ** (tentativa - 1));
          continue;
        }
        if (indisponivel(e.status) && modelo === modeloQueFuncionou[provedor]) delete modeloQueFuncionou[provedor];
        break; // modelo inexistente/aposentado/recusado ou tentativas esgotadas → próximo modelo
      }
    }
  }
}

/**
 * Gera uma resposta JSON seguindo o formato descrito em `formato` (exemplo no prompt).
 * Tenta os provedores configurados em ordem (OpenAI, depois NVIDIA) e, em cada um, os modelos disponíveis.
 * Retorna { dados, modelo }. Em caso de falha, o erro traz `detalhes.tentativas` (diagnóstico na tela).
 */
export async function gerarJson({ sistema, texto, formato }) {
  const ativos = provedoresAtivos();
  if (!ativos.length) throw new HttpError(501, 'Análise com IA não configurada (cadastre OPENAI_API_KEY ou NVIDIA_API_KEY).');
  const mensagens = [
    { role: 'system', content: `${sistema}\n\nResponda SOMENTE com um objeto JSON válido (sem texto antes ou depois, sem markdown), `
      + `com números no formato JSON (ponto decimal, sem "R$" e sem separador de milhar), neste formato:\n${formato}` },
    { role: 'user', content: texto },
  ];
  const tentativas = [];
  const fins = [];
  const inicio = Date.now();
  const restante = () => PRAZO_TOTAL_MS - (Date.now() - inicio);
  for (const provedor of ativos) {
    try {
      const r = await tentarProvedor(provedor, mensagens, tentativas, restante);
      if (r) return r;
    } catch (e) {
      if (!(e instanceof FimDoProvedor)) throw e;
      fins.push(e);
    }
  }
  const detalhes = { tentativas };
  const status = tentativas.map((t) => t.status);
  const nomes = ativos.map((p) => PROVEDORES[p].nome).join(' e ');
  if (fins.length === ativos.length && fins.every((f) => f.status === 402)) {
    throw new HttpError(402, `A conta da API ${nomes} está sem créditos. Adicione créditos (OpenAI: platform.openai.com → Settings → Billing) e tente de novo.`, detalhes);
  }
  if (fins.length === ativos.length && fins.every((f) => f.status === 401)) {
    throw new HttpError(500, `A chave da API ${nomes} foi recusada. Verifique a variável na Vercel (veja os detalhes).`, detalhes);
  }
  // Modelos aposentados/indisponíveis não contam: se os demais só tiveram sobrecarga (5xx), é sobrecarga
  const relevantes = tentativas.filter((t) => !/· lista$/.test(t.modelo) && !indisponivel(t.status));
  if (relevantes.length && relevantes.every((t) => [500, 502, 503, 504].includes(t.status))) {
    throw new HttpError(503, 'O serviço de IA está sobrecarregado ou indisponível agora. Já tentamos de novo automaticamente — aguarde alguns minutos e toque em "Tentar novamente".', detalhes);
  }
  if (status.includes(429) && !status.includes('formato')) throw new HttpError(429, 'Limite de uso da API de IA atingido. Aguarde um pouco e tente novamente.', detalhes);
  if (fins.length) {
    throw new HttpError(fins[0].status === 402 ? 402 : 500, `${fins.map((f) => f.message).join(' · ')}. Os demais provedores também falharam (veja os detalhes).`, detalhes);
  }
  if (status.length && status.every((s) => indisponivel(s) || s === 'vazio')) {
    throw new HttpError(500, 'Nenhum modelo de conversa disponível para a sua chave (os modelos tentados foram aposentados ou não estão liberados). Veja os detalhes.', detalhes);
  }
  if (status.includes('formato')) throw new HttpError(502, 'A IA respondeu, mas não no formato esperado. Tente novamente (veja os detalhes).', detalhes);
  throw new HttpError(502, 'Não foi possível obter a análise da IA. Tente novamente (veja os detalhes).', detalhes);
}
