// Categorias de gasto e de entrada (mantenha em sincronia com public/app.js).
export const CATEGORIAS = [
  'Mercado', 'Farmácia', 'Padaria', 'iFood', 'Restaurante', 'Transporte', 'Combustível',
  'Contas da casa', 'Saúde', 'Lazer', 'Compras', 'Assinaturas', 'Educação', 'Impostos e taxas',
  'Seguros', 'Tarifas e juros', 'Transferências', 'Transferência interna', 'Parcelamento de fatura', 'Outros',
];

export const CATEGORIAS_ENTRADA = [
  'Salário', 'Pix recebido', 'Depósito', 'Transferência', 'Rendimentos', 'Outras entradas', 'Transferência interna',
];

// Movimentação entre contas do próprio usuário ou entre o casal (Pix para a própria conta, pagamento da
// fatura do cartão pelo extrato…): fica registrada, mas NÃO entra em gastos, entradas, saldo e gráficos.
export const TIPO_INTERNO = 'Transferência interna';

// Amortização de parcelamento de fatura: devolve compras que já foram contadas como gasto na fatura original.
// Também fica fora de gastos/saldo; os juros do parcelamento são lançados à parte como "Tarifas e juros".
export const TIPO_PARCELAMENTO_FATURA = 'Parcelamento de fatura';
export const TIPOS_FORA_DO_SALDO = new Set([TIPO_INTERNO, TIPO_PARCELAMENTO_FATURA]);

const achar = (lista, padrao) => (tipo) => {
  if (!tipo) return padrao;
  const t = String(tipo).trim().toLowerCase();
  return lista.find((c) => c.toLowerCase() === t) || padrao;
};

export const normalizaCategoria = achar(CATEGORIAS, 'Outros');
export const normalizaEntrada = achar(CATEGORIAS_ENTRADA, 'Outras entradas');
