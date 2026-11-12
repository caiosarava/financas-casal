import { handler } from '../lib/auth.js';
import { CATEGORIAS, CATEGORIAS_ENTRADA } from '../lib/categorias.js';

export default handler(async () => ({
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  categorias: CATEGORIAS,
  categoriasEntrada: CATEGORIAS_ENTRADA,
  iaHabilitada: Boolean(process.env.ANTHROPIC_API_KEY),
}));
