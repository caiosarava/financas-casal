import { criarHandlerLancamentos } from '../lib/lancamentos.js';
import { normalizaEntrada } from '../lib/categorias.js';
import { ajusteSalarioMesSeguinte, notaRecebido, EMAILS_SALARIO_MES_SEGUINTE_PADRAO } from '../public/regras.js';

// Usuários cujo salário recebido no último dia útil do mês conta no 1º dia útil do mês seguinte
export const emailsSalarioMesSeguinte = () => (process.env.REGRA_SALARIO_MES_SEGUINTE
  ? process.env.REGRA_SALARIO_MES_SEGUINTE.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  : EMAILS_SALARIO_MES_SEGUINTE_PADRAO);

function regraSalario(item, email) {
  const ajuste = ajusteSalarioMesSeguinte({ data: item.data, tipo: item.tipo }, email, emailsSalarioMesSeguinte());
  if (!ajuste) return item;
  const nota = notaRecebido(ajuste.dataOriginal);
  const descricao = item.descricao.includes('(recebido em') ? item.descricao : `${item.descricao} ${nota}`.trim();
  return { ...item, data: ajuste.data, descricao: descricao.slice(0, 200) };
}

export default criarHandlerLancamentos({ aba: 'Entradas', normaliza: normalizaEntrada, nome: 'Entrada', regraNovo: regraSalario });
