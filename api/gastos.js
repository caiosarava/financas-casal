import { criarHandlerLancamentos } from '../lib/lancamentos.js';
import { normalizaCategoria } from '../lib/categorias.js';

export default criarHandlerLancamentos({ aba: 'Gastos', normaliza: normalizaCategoria, nome: 'Gasto' });
