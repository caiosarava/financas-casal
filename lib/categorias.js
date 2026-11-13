// Categorias de gasto e de entrada (mantenha em sincronia com public/app.js).
export const CATEGORIAS = [
  'Mercado', 'Farmácia', 'Padaria', 'iFood', 'Restaurante', 'Transporte', 'Combustível',
  'Contas da casa', 'Saúde', 'Lazer', 'Compras', 'Assinaturas', 'Educação', 'Impostos e taxas',
  'Seguros', 'Tarifas e juros', 'Transferências', 'Outros',
];

export const CATEGORIAS_ENTRADA = [
  'Salário', 'Pix recebido', 'Depósito', 'Transferência', 'Rendimentos', 'Outras entradas',
];

const achar = (lista, padrao) => (tipo) => {
  if (!tipo) return padrao;
  const t = String(tipo).trim().toLowerCase();
  return lista.find((c) => c.toLowerCase() === t) || padrao;
};

export const normalizaCategoria = achar(CATEGORIAS, 'Outros');
export const normalizaEntrada = achar(CATEGORIAS_ENTRADA, 'Outras entradas');
