// Histórico de importações (arquivos de extrato/fatura/holerite já importados).
// GET → { itens: [...] }  ·  POST → registra uma importação  ·  DELETE ?id= → remove do histórico (só as próprias)
// Os dois usuários veem o histórico; quantidades e valores só aparecem nas importações da própria pessoa
// (podem incluir lançamentos privados).
import { handler, HttpError, requireUser, userNames } from '../lib/auth.js';
import { readAll, appendRows, deleteRow, newId } from '../lib/sheets.js';

const TIPOS = ['extrato_bancario', 'fatura_cartao', 'holerite', 'outro'];
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => Math.round((Number(v) || 0) * 100) / 100;
const int = (v) => Math.max(0, Math.round(Number(v) || 0));

export default handler(async (req) => {
  const email = requireUser(req);

  if (req.method === 'GET') {
    const nomes = userNames();
    const itens = (await readAll('Importacoes'))
      .map((i) => {
        const meu = i.usuario === email;
        return {
          id: String(i.id), criadoEm: String(i.criado_em), usuario: i.usuario, nomeUsuario: nomes[i.usuario] || i.usuario, meu,
          nomeArquivo: i.nome_arquivo, hash: String(i.hash || ''), tipoDocumento: i.tipo_documento, banco: i.banco,
          periodoInicio: String(i.periodo_inicio || ''), periodoFim: String(i.periodo_fim || ''),
          ...(meu ? {
            gastos: { qtd: int(i.qtd_gastos), total: num(i.total_gastos) },
            entradas: { qtd: int(i.qtd_entradas), total: num(i.total_entradas) },
            internas: { qtd: int(i.qtd_internas), total: num(i.total_internas) },
          } : {}),
        };
      })
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    return { itens };
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    const nome = String(b.nomeArquivo || '').trim().slice(0, 150);
    if (!nome) throw new HttpError(400, 'Nome do arquivo ausente.');
    const periodo = (d) => (DATA_RE.test(String(d || '')) ? String(d) : '');
    const registro = {
      id: newId(), criado_em: new Date().toISOString(), usuario: email, nome_arquivo: nome,
      hash: /^[a-f0-9]{64}$/.test(String(b.hash || '')) ? b.hash : '',
      tipo_documento: TIPOS.includes(b.tipoDocumento) ? b.tipoDocumento : 'outro',
      banco: String(b.banco || '').slice(0, 60),
      periodo_inicio: periodo(b.periodoInicio), periodo_fim: periodo(b.periodoFim),
      qtd_gastos: int(b.gastos?.qtd), total_gastos: num(b.gastos?.total),
      qtd_entradas: int(b.entradas?.qtd), total_entradas: num(b.entradas?.total),
      qtd_internas: int(b.internas?.qtd), total_internas: num(b.internas?.total),
    };
    await appendRows('Importacoes', [registro]);
    return { id: registro.id };
  }

  if (req.method === 'DELETE') {
    const id = (req.query || {}).id;
    const atual = (await readAll('Importacoes')).find((i) => String(i.id) === String(id));
    if (!atual) throw new HttpError(404, 'Importação não encontrada.');
    if (atual.usuario !== email) throw new HttpError(403, 'Só quem importou pode remover do histórico.');
    await deleteRow('Importacoes', atual.__row);
    return { ok: true };
  }

  throw new HttpError(405, 'Método não permitido.');
});
