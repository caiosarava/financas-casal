// Acesso ao Google Sheets via conta de serviço (API REST v4).
import { JWT } from 'google-auth-library';
import { HttpError } from './auth.js';

export const SCHEMA = {
  Gastos: ['id', 'data', 'valor', 'tipo', 'descricao', 'usuario', 'compartilhado', 'origem', 'criado_em'],
  Metas: ['ano', 'escopo', 'valor', 'atualizado_por', 'atualizado_em'],
  Aportes: ['id', 'data', 'valor', 'escopo', 'usuario', 'obs', 'criado_em'],
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
export async function ensureSchema() {
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

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
