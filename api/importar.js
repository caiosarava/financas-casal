// Lê um PDF de extrato bancário / fatura de cartão com o Claude e devolve os gastos
// encontrados, já classificados, para o usuário revisar antes de salvar.
import Anthropic from '@anthropic-ai/sdk';
import { handler, HttpError, requireUser } from '../lib/auth.js';
import { CATEGORIAS, normalizaCategoria } from '../lib/categorias.js';

const MAX_PDF_BYTES = 3.2 * 1024 * 1024; // limite de corpo da Vercel é 4,5 MB (base64 ≈ +33%)

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['banco', 'tipo_documento', 'transacoes'],
  properties: {
    banco: { type: 'string', description: 'Nome do banco ou emissor do cartão, se identificável.' },
    tipo_documento: { type: 'string', enum: ['extrato_bancario', 'fatura_cartao', 'outro'] },
    transacoes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['data', 'descricao', 'valor', 'tipo'],
        properties: {
          data: { type: 'string', description: 'Data da compra no formato AAAA-MM-DD.' },
          descricao: { type: 'string', description: 'Descrição do estabelecimento como aparece no documento, limpa.' },
          valor: { type: 'number', description: 'Valor positivo em reais (ex.: 123.45).' },
          tipo: { type: 'string', enum: CATEGORIAS },
        },
      },
    },
  },
};

const SYSTEM = `Você extrai gastos de extratos bancários e faturas de cartão de crédito brasileiros.

Regras:
- Inclua apenas SAÍDAS de dinheiro que representam consumo: compras, débitos, Pix enviados a estabelecimentos, boletos de contas, assinaturas, tarifas.
- NÃO inclua: créditos, salários, estornos, Pix recebidos, rendimentos, transferências entre contas do próprio titular, aplicações/resgates de investimento, saldo anterior, pagamento da própria fatura do cartão, totais e subtotais.
- Compras parceladas: registre só a parcela cobrada neste documento; acrescente "(parcela X/Y)" à descrição.
- Datas sem ano: deduza o ano pelo período do documento (fatura de janeiro com compra em dezembro = ano anterior).
- Valores sempre positivos, em reais, com ponto decimal.
- Classifique cada gasto em uma categoria:
  Mercado (supermercados, atacarejos, hortifruti, açougue), Farmácia (drogarias), Padaria (padarias, confeitarias, cafeterias de bairro),
  iFood (iFood, Rappi, Zé Delivery e apps de entrega de comida), Restaurante (restaurantes, bares, lanchonetes presenciais),
  Transporte (Uber, 99, ônibus, metrô, estacionamento, pedágio), Combustível (postos), Contas da casa (luz, água, gás, internet, telefone, condomínio, aluguel, IPTU),
  Saúde (médicos, exames, planos, dentista, academia), Lazer (cinema, viagens, hotéis, eventos), Compras (lojas, e-commerce, vestuário, eletrônicos),
  Assinaturas (streaming, softwares, serviços recorrentes), Outros (tarifas e o que não se encaixar).
- Se o documento não for um extrato ou fatura, devolva a lista de transações vazia.`;

let client;

export default handler(async (req) => {
  requireUser(req);
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido.');
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(501, 'Leitura com IA não configurada (ANTHROPIC_API_KEY ausente).');
  }

  const pdf = String((req.body || {}).pdf || '').replace(/^data:application\/pdf;base64,/, '').replace(/\s/g, '');
  if (!pdf) throw new HttpError(400, 'Envie o PDF em base64 no campo "pdf".');
  if (pdf.length * 0.75 > MAX_PDF_BYTES) throw new HttpError(413, 'PDF muito grande (máx. ~3 MB). Divida o arquivo e tente de novo.');

  client ||= new Anthropic();

  let message;
  try {
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
          { type: 'text', text: 'Extraia todos os gastos deste documento.' },
        ],
      }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Muitas leituras seguidas. Aguarde um minuto e tente de novo.');
    if (err instanceof Anthropic.BadRequestError) throw new HttpError(400, `Não foi possível ler o PDF: ${err.message}`);
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(500, 'ANTHROPIC_API_KEY inválida.');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `Falha na IA: ${err.message}`);
    throw err;
  }

  if (message.stop_reason === 'refusal') throw new HttpError(422, 'A IA não conseguiu processar este documento.');
  if (message.stop_reason === 'max_tokens') throw new HttpError(422, 'Documento muito longo. Divida o PDF em partes menores.');

  const texto = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    throw new HttpError(502, 'Resposta da IA em formato inesperado.');
  }

  const transacoes = (dados.transacoes || [])
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.data) && Number(t.valor) > 0)
    .map((t) => ({
      data: t.data,
      descricao: String(t.descricao || '').slice(0, 200),
      valor: Math.round(Math.abs(Number(t.valor)) * 100) / 100,
      tipo: normalizaCategoria(t.tipo),
    }));

  return { banco: dados.banco || '', tipoDocumento: dados.tipo_documento, transacoes, metodo: 'ia' };
});
