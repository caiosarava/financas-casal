import { handler } from '../lib/auth.js';
import { CATEGORIAS } from '../lib/categorias.js';

export default handler(async () => ({
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  categorias: CATEGORIAS,
  iaHabilitada: Boolean(process.env.ANTHROPIC_API_KEY),
}));
