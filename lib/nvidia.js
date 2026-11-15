// Cliente da API da NVIDIA (build.nvidia.com / NIM), compatível com o formato de chat da OpenAI.
// Usado pela análise financeira com IA. A chave fica SOMENTE na variável de ambiente NVIDIA_API_KEY.
import { HttpError } from './auth.js';

const URL_API = () => (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
export const MODELO = () => process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct';
// Usados quando o principal não existe (404), está sobrecarregado (5xx) ou sem cota (429)
export const RESERVAS = () => (process.env.NVIDIA_MODELOS_RESERVA ?? 'openai/gpt-oss-120b,meta/llama-3.1-70b-instruct')
  .split(',').map((m) => m.trim()).filter((m) => m && m !== MODELO());
const TEMPORARIO = new Set([408, 429, 500, 502, 503, 504]);
const TENTATIVAS_POR_MODELO = 3;
const TEMPO_LIMITE_MS = 55_000;
// A função da Vercel tem 120 s (vercel.json): todas as tentativas juntas param antes disso
const PRAZO_TOTAL_MS = 100_000;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

class ErroNvidia extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

/** Extrai o primeiro objeto JSON da resposta (ignora <think>…</think>, cercas ``` e texto em volta). */
export function extrairJson(texto) {
  let t = String(texto || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
  const ini = t.indexOf('{');
  const fim = t.lastIndexOf('}');
  if (ini < 0 || fim <= ini) throw new Error('sem JSON');
  t = t.slice(ini, fim + 1);
  return JSON.parse(t);
}

async function chamar(modelo, mensagens, limiteMs = TEMPO_LIMITE_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, limiteMs));
  try {
    const res = await fetch(`${URL_API()}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: modelo, messages: mensagens, temperature: 0.2, top_p: 0.7, max_tokens: 4096, stream: false }),
    });
    const texto = await res.text();
    if (!res.ok) {
      let msg = texto.slice(0, 300);
      try { const j = JSON.parse(texto); msg = j.detail || j.error?.message || j.message || msg; } catch { /* texto puro */ }
      throw new ErroNvidia(res.status, String(msg));
    }
    const j = JSON.parse(texto);
    return j.choices?.[0]?.message?.content || '';
  } catch (e) {
    if (e instanceof ErroNvidia) throw e;
    if (e.name === 'AbortError') throw new ErroNvidia(504, 'tempo esgotado');
    throw new ErroNvidia(502, e.message);
  } finally { clearTimeout(timer); }
}

/**
 * Gera uma resposta JSON seguindo o formato descrito em `formato` (exemplo comentado no prompt).
 * Tenta o modelo principal e, se ele não existir ou estiver indisponível, os de reserva.
 * Retorna { dados, modelo }.
 */
export async function gerarJson({ sistema, texto, formato }) {
  if (!process.env.NVIDIA_API_KEY) throw new HttpError(501, 'Análise com IA não configurada (NVIDIA_API_KEY ausente).');
  const mensagens = [
    { role: 'system', content: `${sistema}\n\nResponda SOMENTE com um objeto JSON válido (sem texto antes ou depois, sem markdown) neste formato:\n${formato}` },
    { role: 'user', content: texto },
  ];
  let erroPrincipal = null;
  const modelos = [MODELO(), ...RESERVAS()];
  const inicio = Date.now();
  const restante = () => PRAZO_TOTAL_MS - (Date.now() - inicio);
  for (const modelo of modelos) {
    if (restante() < 5000) break;
    for (let tentativa = 1; tentativa <= TENTATIVAS_POR_MODELO; tentativa++) {
      if (restante() < 5000) break;
      try {
        const conteudo = await chamar(modelo, mensagens, Math.min(TEMPO_LIMITE_MS, restante()));
        try {
          return { dados: extrairJson(conteudo), modelo };
        } catch {
          // Resposta fora do formato: tenta mais uma vez e depois o próximo modelo
          erroPrincipal ||= new ErroNvidia(502, 'resposta fora do formato JSON');
          if (tentativa < 2) continue;
          break;
        }
      } catch (e) {
        if (modelo === MODELO()) erroPrincipal = e;
        if (e.status === 401 || e.status === 403) {
          throw new HttpError(500, `A NVIDIA recusou a chave (verifique NVIDIA_API_KEY): ${e.message}`);
        }
        if (TEMPORARIO.has(e.status) && tentativa < TENTATIVAS_POR_MODELO && restante() > 8000) {
          await espera(1500 * 2 ** (tentativa - 1));
          continue;
        }
        console.warn(`NVIDIA ${modelo} falhou (${e.status}): ${e.message}`);
        break; // 404/400 (modelo inexistente/indisponível) ou tentativas esgotadas → próximo modelo
      }
    }
  }
  const e = erroPrincipal || new ErroNvidia(502, 'falha desconhecida');
  if ([500, 502, 503, 504].includes(e.status) && e.message !== 'resposta fora do formato JSON') {
    throw new HttpError(503, 'A IA da NVIDIA está sobrecarregada ou indisponível agora. Já tentamos de novo automaticamente — aguarde alguns minutos e toque em "Tentar novamente".');
  }
  if (e.status === 429) throw new HttpError(429, 'Limite de uso da API da NVIDIA atingido. Aguarde um pouco e tente novamente.');
  if (e.status === 404 || e.status === 400) throw new HttpError(500, `Modelo "${MODELO()}" não disponível na NVIDIA (${e.message}). Ajuste NVIDIA_MODEL.`);
  throw new HttpError(502, 'A IA não retornou uma análise válida. Tente novamente.');
}
