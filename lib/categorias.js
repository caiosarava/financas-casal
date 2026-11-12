// Categorias de gasto (mantenha em sincronia com public/app.js).
export const CATEGORIAS = [
  'Mercado', 'Farmácia', 'Padaria', 'iFood', 'Restaurante', 'Transporte', 'Combustível',
  'Contas da casa', 'Saúde', 'Lazer', 'Compras', 'Assinaturas', 'Outros',
];

export function normalizaCategoria(tipo) {
  if (!tipo) return 'Outros';
  const t = String(tipo).trim().toLowerCase();
  return CATEGORIAS.find((c) => c.toLowerCase() === t) || 'Outros';
}
