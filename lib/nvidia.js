// Cliente da API da NVIDIA (build.nvidia.com / NIM), compatível com o formato de chat da OpenAI.
// Usado pela análise financeira com IA. A chave fica SOMENTE na variável de ambiente NVIDIA_API_KEY.
import { HttpError } from './auth.js';

const URL_API = () => (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
// Modelos fixos são opcionais: a NVIDIA aposenta modelos com frequência (erro 410 "end of life").
// Sem NVIDIA_MODEL, o app consulta /v1/models e escolhe sozinho um modelo de conversa disponível para a chave.
export const MODELO = () => (process.env.NVIDIA_MODEL || '').trim();
export const RESERVAS = () => (process.env.NVIDIA_MODELOS_RESERVA || '')
  .split(',').map((m) => m.trim()).filter((m) => m && m !== MODELO());
const MAX_DESCOBERTOS = 4; // quantos modelos do catálogo tentar, no máximo
let modeloQueFuncionou = null; // guardado enquanto a função estiver "quente"

// Modelos que não servem para conversa em texto (embeddings, imagem, áudio, moderação, código…)
const NAO_CONVERSA = /embed|rerank|retriev|guard|safety|reward|clip|vision|[-_]vl\b|vlm|ocr|parse|asr|tts|whisper|audio|speech|coder|codestral|starcoder|math|bge|\be5\b|paligemma|kosmos|fuyu|neva|vila|deplot|cosmos|flux|sdxl|stable-?diffusion|riva|translat|pii|content-safety|topic-control|jailbreak|nemoguard|calibration|structured-gen|-base\b/i;
// Preferência por família (do mais indicado para análise em português ao menos)
const PREFERENCIA = [
  /nemotron.*(super|ultra)/i, /llama-?4/i, /qwen-?3/i, /deepseek-?(v3|chat)/i, /mistral-(large|medium)/i, /gpt-oss/i,
  /llama-?3\.\d.*(405b|70b)/i, /gemma-?3/i, /mistral|mixtral/i, /nemotron/i, /llama/i, /instruct|chat/i,
];

/** Lista os modelos de conversa disponíveis para a chave, em ordem de preferência. */
export function escolherModelos(ids) {
  const pontos = (id) => { const i = PREFERENCIA.findIndex((re) => re.test(id)); return i < 0 ? 99 : i; };
  const tamanho = (id) => Number((id.match(/(\d+(?:\.\d+)?)b\b/i) || [])[1] || 0);
  return [...new Set(ids)].filter((id) => !NAO_CONVERSA.test(id) && pontos(id) < 99)
    .sort((a, b) => pontos(a) - pontos(b) || tamanho(b) - tamanho(a) || a.localeCompare(b));
}

async function listarModelos() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${URL_API()}/models`, { signal: ctrl.signal, headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, Accept: 'application/json' } });
    if (!res.ok) throw new ErroNvidia(res.status, `lista de modelos: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return (j.data || []).map((m) => m.id).filter(Boolean);
  } catch (e) {
    if (e instanceof ErroNvidia) throw e;
    throw new ErroNvidia(502, `lista de modelos: ${e.name === 'AbortError' ? 'tempo esgotado' : e.message}`);
  } finally { clearTimeout(timer); }
}
const TEMPORARIO = new Set([408, 429, 500, 502, 503, 504]);
const TENTATIVAS_POR_MODELO = 3;
const TEMPO_LIMITE_MS = 55_000;
// A função da Vercel tem 120 s (vercel.json): todas as tentativas juntas param antes disso
const PRAZO_TOTAL_MS = 100_000;
const MAX_TOKENS = 6144;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

class ErroNvidia extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
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

async function chamar(modelo, mensagens, { limiteMs = TEMPO_LIMITE_MS, modoJson = true } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, limiteMs));
  try {
    const corpo = { model: modelo, messages: mensagens, temperature: 0.2, top_p: 0.7, max_tokens: MAX_TOKENS, stream: false };
    if (modoJson) corpo.response_format = { type: 'json_object' };
    const res = await fetch(`${URL_API()}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpo),
    });
    const texto = await res.text();
    if (!res.ok) {
      let msg = texto.slice(0, 300);
      try { const j = JSON.parse(texto); msg = j.detail || j.error?.message || j.message || j.title || msg; } catch { /* texto puro */ }
      throw new ErroNvidia(res.status, String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300));
    }
    const j = JSON.parse(texto);
    const m = j.choices?.[0]?.message || {};
    // Modelos de raciocínio podem deixar "content" vazio e pôr o texto em reasoning_content
    return { conteudo: m.content || m.reasoning_content || '', fim: j.choices?.[0]?.finish_reason || '' };
  } catch (e) {
    if (e instanceof ErroNvidia) throw e;
    if (e.name === 'AbortError') throw new ErroNvidia(504, 'tempo esgotado');
    throw new ErroNvidia(502, e.message);
  } finally { clearTimeout(timer); }
}

/**
 * Gera uma resposta JSON seguindo o formato descrito em `formato` (exemplo no prompt).
 * Tenta o modelo principal e, se ele não existir, estiver indisponível ou não devolver JSON válido, os de reserva.
 * Retorna { dados, modelo }. Em caso de falha, o erro traz `detalhes` com cada tentativa (para diagnóstico).
 */
export async function gerarJson({ sistema, texto, formato }) {
  if (!process.env.NVIDIA_API_KEY) throw new HttpError(501, 'Análise com IA não configurada (NVIDIA_API_KEY ausente).');
  const mensagens = [
    { role: 'system', content: `${sistema}\n\nResponda SOMENTE com um objeto JSON válido (sem texto antes ou depois, sem markdown), `
      + `com números no formato JSON (ponto decimal, sem "R$" e sem separador de milhar), neste formato:\n${formato}` },
    { role: 'user', content: texto },
  ];
  const tentativas = [];
  const inicio = Date.now();
  const restante = () => PRAZO_TOTAL_MS - (Date.now() - inicio);
  const indisponivel = (st) => st === 404 || st === 410 || st === 400 || st === 422;
  const fila = [...new Set([modeloQueFuncionou, MODELO(), ...RESERVAS()].filter(Boolean))];
  let consultouCatalogo = false;
  const tentados = new Set();
  while (true) {
    if (!fila.length) {
      // Sem modelo configurado, ou os configurados foram aposentados/indisponíveis: escolhe pelo catálogo
      if (consultouCatalogo || restante() < 8000) break;
      consultouCatalogo = true;
      try {
        const disponiveis = escolherModelos(await listarModelos()).filter((m) => !tentados.has(m)).slice(0, MAX_DESCOBERTOS);
        if (!disponiveis.length) tentativas.push({ modelo: 'catálogo', status: 'vazio', msg: 'nenhum modelo de conversa disponível para esta chave' });
        fila.push(...disponiveis);
      } catch (e) {
        tentativas.push({ modelo: 'catálogo', status: e.status, msg: e.message });
        if (e.status === 401 || e.status === 403) throw new HttpError(500, `A NVIDIA recusou a chave (verifique NVIDIA_API_KEY): ${e.message}`, { tentativas });
        break;
      }
      continue;
    }
    const modelo = fila.shift();
    if (tentados.has(modelo)) continue;
    tentados.add(modelo);
    if (restante() < 5000) break;
    let modoJson = true;
    let formatoRuim = 0;
    for (let tentativa = 1; tentativa <= TENTATIVAS_POR_MODELO && restante() > 5000; tentativa++) {
      try {
        const { conteudo, fim } = await chamar(modelo, mensagens, { limiteMs: Math.min(TEMPO_LIMITE_MS, restante()), modoJson });
        try {
          const dados = extrairJson(conteudo);
          modeloQueFuncionou = modelo;
          return { dados, modelo };
        } catch {
          formatoRuim++;
          tentativas.push({ modelo, status: 'formato', msg: `resposta sem JSON válido${fim === 'length' ? ' (cortada pelo limite de tamanho)' : ''}: ${String(conteudo).replace(/\s+/g, ' ').slice(0, 160) || '(vazia)'}` });
          console.warn(`NVIDIA ${modelo}: resposta fora do formato (${fim}): ${String(conteudo).slice(0, 300)}`);
          if (formatoRuim >= 2) break; // tenta outro modelo
          continue;
        }
      } catch (e) {
        tentativas.push({ modelo, status: e.status, msg: e.message });
        console.warn(`NVIDIA ${modelo} falhou (${e.status}): ${e.message}`);
        if (e.status === 401 || e.status === 403) {
          throw new HttpError(500, `A NVIDIA recusou a chave (verifique NVIDIA_API_KEY): ${e.message}`, { tentativas });
        }
        if (e.status === 402) {
          throw new HttpError(402, 'Os créditos da sua conta na API da NVIDIA acabaram. Verifique em build.nvidia.com.', { tentativas });
        }
        // Parâmetro não aceito por este modelo (ex.: response_format): repete sem o modo JSON, sem contar tentativa
        if ((e.status === 400 || e.status === 422) && modoJson) { modoJson = false; tentativa--; continue; }
        if (TEMPORARIO.has(e.status) && tentativa < TENTATIVAS_POR_MODELO && restante() > 8000) {
          await espera(1500 * 2 ** (tentativa - 1));
          continue;
        }
        if (indisponivel(e.status) && modelo === modeloQueFuncionou) modeloQueFuncionou = null;
        break; // 404/410/400/422 (modelo inexistente, aposentado ou pedido recusado) ou tentativas esgotadas → próximo modelo
      }
    }
  }
  const status = tentativas.map((t) => t.status);
  const detalhes = { tentativas };
  // Modelos aposentados/indisponíveis não contam: se os demais só tiveram sobrecarga (5xx), é sobrecarga
  const relevantes = tentativas.filter((t) => t.modelo !== 'catálogo' && !indisponivel(t.status));
  if (relevantes.length && relevantes.every((t) => [500, 502, 503, 504].includes(t.status))) {
    throw new HttpError(503, 'A IA da NVIDIA está sobrecarregada ou indisponível agora. Já tentamos de novo automaticamente — aguarde alguns minutos e toque em "Tentar novamente".', detalhes);
  }
  if (status.includes(429) && !status.includes('formato')) throw new HttpError(429, 'Limite de uso da API da NVIDIA atingido. Aguarde um pouco e tente novamente.', detalhes);
  if (status.length && status.every((s) => indisponivel(s) || s === 'vazio')) {
    throw new HttpError(500, 'Nenhum modelo de conversa disponível para a sua chave na NVIDIA (os modelos tentados foram aposentados ou não estão liberados). Veja os detalhes; se precisar, defina NVIDIA_MODEL com um modelo do catálogo do build.nvidia.com.', detalhes);
  }
  if (status.includes('formato')) throw new HttpError(502, 'A IA respondeu, mas não no formato esperado. Tente novamente (veja os detalhes).', detalhes);
  throw new HttpError(502, 'Não foi possível obter a análise da IA. Tente novamente (veja os detalhes).', detalhes);
}
