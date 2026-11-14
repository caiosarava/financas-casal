import { handler } from '../lib/auth.js';
import { CATEGORIAS, CATEGORIAS_ENTRADA } from '../lib/categorias.js';
import { emailsSalarioMesSeguinte } from './entradas.js';

export default handler(async () => ({
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  categorias: CATEGORIAS,
  categoriasEntrada: CATEGORIAS_ENTRADA,
  iaHabilitada: Boolean(process.env.ANTHROPIC_API_KEY),
  geminiHabilitado: Boolean(process.env.GEMINI_API_KEY),
  regraSalarioMesSeguinte: emailsSalarioMesSeguinte(),
}));
