// Acesso ao Google Sheets via conta de serviço (API REST v4).
import { JWT } from 'google-auth-library';
import { HttpError } from './auth.js';

export const SCHEMA = {
  Gastos: ['id', 'data', 'valor', 'tipo', 'descricao', 'usuario', 'compartilhado', 'origem', 'criado_em'],
  Entradas: ['id', 'data', 'valor', 'tipo', 'descricao', 'usuario', 'compartilhado', 'origem', 'criado_em'],
  Metas: ['ano', 'escopo', 'valor', 'atualizado_por', 'atualizado_em'], // legado (metas anuais → migradas para Cofrinhos)
  Cofrinhos: ['id', 'nome', 'emoji', 'escopo', 'meta', 'prazo', 'criado_por', 'criado_em'],
  Aportes: ['id', 'data', 'valor', 'escopo', 'usuario', 'obs', 'criado_em', 'cofrinho'],
};

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
let jwt;
let sheetIds = null; // { Gastos: gid, ... }

function sheetId() {
  const id = process.env.SHEET_ID;
  if (!id) throw new HttpError(500, 'SHEET_ID não configurado.');
  return id;
}

async function token() {
  if (!jwt) {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (!email || !key) throw new HttpError(500, 'Credenciais da conta de serviço não configuradas.');
    jwt = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  const { token: t } = await jwt.getAccessToken();
  return t;
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}/${sheetId()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(502, `Google Sheets (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Garante que as abas e cabeçalhos existem (executa uma vez por instância). */
let schemaPromise = null;
export function ensureSchema() {
  // Uma única verificação por instância, mesmo com várias leituras em paralelo
  schemaPromise ||= prepararSchema().catch((e) => { schemaPromise = null; throw e; });
  return schemaPromise;
}

async function prepararSchema() {
  if (sheetIds) return sheetIds;
  const meta = await call('?fields=sheets.properties');
  const existing = Object.fromEntries(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const missing = Object.keys(SCHEMA).filter((t) => existing[t] === undefined);
  if (missing.length) {
    const r = await call(':batchUpdate', {
      method: 'POST',
      body: { requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) },
    });
    r.replies.forEach((rep) => { existing[rep.addSheet.properties.title] = rep.addSheet.properties.sheetId; });
    await call('/values:batchUpdate', {
      method: 'POST',
      body: {
        valueInputOption: 'RAW',
        data: missing.map((t) => ({ range: `${t}!A1`, values: [SCHEMA[t]] })),
      },
    });
  }
  // Abas que já existiam podem ter cabeçalho antigo (ex.: Aportes sem a coluna "cofrinho"): completa as colunas novas
  const antigas = Object.keys(SCHEMA).filter((t) => !missing.includes(t));
  if (antigas.length) {
    const qs = antigas.map((t) => `ranges=${encodeURIComponent(`${t}!1:1`)}`).join('&');
    const r = await call(`/values:batchGet?${qs}`);
    const corrigir = (r.valueRanges || []).map((vr, i) => ({ t: antigas[i], atual: (vr.values && vr.values[0]) || [] }))
      .filter(({ t, atual }) => atual.length < SCHEMA[t].length && atual.every((c, j) => c === SCHEMA[t][j]));
    if (corrigir.length) {
      await call('/values:batchUpdate', {
        method: 'POST',
        body: { valueInputOption: 'RAW', data: corrigir.map(({ t }) => ({ range: `${t}!A1`, values: [SCHEMA[t]] })) },
      });
    }
  }
  sheetIds = existing;
  return sheetIds;
}

const colLetter = (n) => String.fromCharCode(64 + n);

/** Lê todas as linhas de uma aba como objetos (com __row = número da linha na planilha). */
export async function readAll(tab) {
  await ensureSchema();
  const cols = SCHEMA[tab];
  const r = await call(`/values/${encodeURIComponent(`${tab}!A2:${colLetter(cols.length)}`)}?valueRenderOption=UNFORMATTED_VALUE`);
  return (r.values || []).map((row, i) => {
    const obj = { __row: i + 2 };
    cols.forEach((c, j) => { obj[c] = row[j] ?? ''; });
    return obj;
  }).filter((o) => o[cols[0]] !== '');
}

const toRow = (tab, obj) => SCHEMA[tab].map((c) => (obj[c] === undefined || obj[c] === null ? '' : obj[c]));

export async function appendRows(tab, objs) {
  if (!objs.length) return;
  await ensureSchema();
  await call(`/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: { values: objs.map((o) => toRow(tab, o)) },
  });
}

export async function updateRow(tab, rowNumber, obj) {
  await ensureSchema();
  const cols = SCHEMA[tab];
  await call(`/values/${encodeURIComponent(`${tab}!A${rowNumber}:${colLetter(cols.length)}${rowNumber}`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: { values: [toRow(tab, obj)] },
  });
}

/** Atualiza várias linhas de uma vez: [{ row, obj }] */
export async function updateRows(tab, updates) {
  if (!updates.length) return;
  await ensureSchema();
  const cols = SCHEMA[tab];
  await call('/values:batchUpdate', {
    method: 'POST',
    body: {
      valueInputOption: 'RAW',
      data: updates.map(({ row, obj }) => ({ range: `${tab}!A${row}:${colLetter(cols.length)}${row}`, values: [toRow(tab, obj)] })),
    },
  });
}

export async function deleteRow(tab, rowNumber) {
  const ids = await ensureSchema();
  await call(':batchUpdate', {
    method: 'POST',
    body: {
      requests: [{
        deleteDimension: {
          range: { sheetId: ids[tab], dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
        },
      }],
    },
  });
}

/** Apaga várias linhas de uma aba numa única chamada (de baixo para cima, para não deslocar índices). */
export async function deleteRows(tab, rowNumbers) {
  if (!rowNumbers.length) return;
  const ids = await ensureSchema();
  const ordenadas = [...new Set(rowNumbers)].sort((a, b) => b - a);
  // Junta linhas consecutivas num único intervalo
  const intervalos = [];
  for (const r of ordenadas) {
    const ult = intervalos[intervalos.length - 1];
    if (ult && ult.inicio - 1 === r) ult.inicio = r;
    else intervalos.push({ inicio: r, fim: r });
  }
  await call(':batchUpdate', {
    method: 'POST',
    body: {
      requests: intervalos.map(({ inicio, fim }) => ({
        deleteDimension: { range: { sheetId: ids[tab], dimension: 'ROWS', startIndex: inicio - 1, endIndex: fim } },
      })),
    },
  });
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
