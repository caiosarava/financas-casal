// Regras de negócio compartilhadas entre o servidor (api/) e o app (navegador).
// Mantenha este arquivo sem dependências e sem uso de APIs do navegador.

const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const utc = (a, m, d) => new Date(Date.UTC(a, m - 1, d));
const somaDias = (d, n) => new Date(d.getTime() + n * 864e5);

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(ano, mes, dia);
}

const cacheFeriados = {};
/** Feriados bancários nacionais (sem expediente bancário) do ano, em AAAA-MM-DD. */
export function feriadosBancarios(ano) {
  if (cacheFeriados[ano]) return cacheFeriados[ano];
  const p = pascoa(ano);
  const lista = [
    `${ano}-01-01`, // Confraternização Universal
    iso(somaDias(p, -48)), // Carnaval (segunda)
    iso(somaDias(p, -47)), // Carnaval (terça)
    iso(somaDias(p, -2)), // Sexta-feira Santa
    `${ano}-04-21`, // Tiradentes
    `${ano}-05-01`, // Dia do Trabalho
    iso(somaDias(p, 60)), // Corpus Christi
    `${ano}-09-07`, // Independência
    `${ano}-10-12`, // Nossa Senhora Aparecida
    `${ano}-11-02`, // Finados
    `${ano}-11-15`, // Proclamação da República
    ...(ano >= 2024 ? [`${ano}-11-20`] : []), // Dia Nacional de Zumbi e da Consciência Negra
    `${ano}-12-25`, // Natal
    `${ano}-12-31`, // Último dia do ano: sem expediente bancário ao público (Febraban)
  ];
  cacheFeriados[ano] = new Set(lista);
  return cacheFeriados[ano];
}

/** true se a data (AAAA-MM-DD) for dia útil bancário: segunda a sexta e fora dos feriados nacionais. */
export function ehDiaUtil(dataIso) {
  const [a, m, d] = dataIso.split('-').map(Number);
  const dia = utc(a, m, d).getUTCDay();
  return dia !== 0 && dia !== 6 && !feriadosBancarios(a).has(dataIso);
}

export function ultimoDiaUtil(ano, mes) {
  let d = utc(ano, mes + 1, 0); // último dia do mês
  while (!ehDiaUtil(iso(d))) d = somaDias(d, -1);
  return iso(d);
}

export function primeiroDiaUtil(ano, mes) {
  let d = utc(ano, mes, 1);
  while (!ehDiaUtil(iso(d))) d = somaDias(d, 1);
  return iso(d);
}

/** E-mails cujo salário recebido no fim do mês conta no mês seguinte (padrão: Thiane). */
export const EMAILS_SALARIO_MES_SEGUINTE_PADRAO = ['thianedepra@gmail.com'];

/**
 * Regra do salário antecipado: quando uma ENTRADA do tipo "Salário" de um usuário da regra cai no
 * último dia útil do mês (ou depois dele, num fim de semana/feriado), ela é considerada no primeiro
 * dia útil do mês seguinte. Retorna a nova data e a original, ou null se a regra não se aplica.
 */
export function ajusteSalarioMesSeguinte({ data, tipo, natureza = 'entrada' }, email, emails = EMAILS_SALARIO_MES_SEGUINTE_PADRAO) {
  if (natureza !== 'entrada' || tipo !== 'Salário' || !emails.includes(String(email || '').toLowerCase())) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) return null;
  const [a, m] = data.split('-').map(Number);
  if (data < ultimoDiaUtil(a, m)) return null;
  const proxAno = m === 12 ? a + 1 : a;
  const proxMes = m === 12 ? 1 : m + 1;
  return { data: primeiroDiaUtil(proxAno, proxMes), dataOriginal: data };
}

/** Texto curto para a descrição: "(recebido em 30/10)". */
export const notaRecebido = (dataOriginal) => `(recebido em ${dataOriginal.slice(8, 10)}/${dataOriginal.slice(5, 7)})`;
