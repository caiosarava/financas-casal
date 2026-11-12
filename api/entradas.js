import { criarHandlerLancamentos } from '../lib/lancamentos.js';
import { normalizaEntrada } from '../lib/categorias.js';

export default criarHandlerLancamentos({ aba: 'Entradas', normaliza: normalizaEntrada, nome: 'Entrada' });
