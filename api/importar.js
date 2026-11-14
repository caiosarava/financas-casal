// Lê um extrato bancário / fatura de cartão (PDF, ou texto vindo de CSV/XLS/XLSX) com o Claude
// e devolve gastos e entradas encontrados, já classificados, para o usuário revisar antes de salvar.
import Anthropic from '@anthropic-ai/sdk';
import { handler, HttpError, requireUser } from '../lib/auth.js';
import { CATEGORIAS, CATEGORIAS_ENTRADA, normalizaCategoria, normalizaEntrada } from '../lib/categorias.js';

const MAX_PDF_BYTES = 3.2 * 1024 * 1024; // limite de corpo da Vercel é 4,5 MB (base64 ≈ +33%)
const MAX_TEXTO = 400_000; // caracteres de planilha convertida em texto

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['banco', 'tipo_documento', 'vencimento', 'transacoes'],
  properties: {
    banco: { type: 'string', description: 'Nome do banco ou emissor do cartão, se identificável.' },
    tipo_documento: { type: 'string', enum: ['extrato_bancario', 'fatura_cartao', 'holerite', 'outro'] },
    vencimento: { type: 'string', description: 'Data de vencimento da fatura do cartão (AAAA-MM-DD); string vazia se não for fatura ou se não for possível identificar.' },
    transacoes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['data', 'descricao', 'valor', 'natureza', 'tipo'],
        properties: {
          natureza: { type: 'string', enum: ['saida', 'entrada'], description: 'saida = gasto; entrada = dinheiro recebido.' },
          data: { type: 'string', description: 'Data da compra no formato AAAA-MM-DD.' },
          descricao: { type: 'string', description: 'Descrição do estabelecimento como aparece no documento, limpa.' },
          valor: { type: 'number', description: 'Valor positivo em reais (ex.: 123.45).' },
          tipo: { type: 'string', enum: [...CATEGORIAS, ...CATEGORIAS_ENTRADA] },
        },
      },
    },
  },
};

const SYSTEM = `Você extrai lançamentos de extratos bancários e faturas de cartão de crédito brasileiros.
O documento pode vir como PDF ou como texto de uma planilha (CSV/XLS) com colunas separadas por " | ".

Para cada lançamento, defina "natureza":
- "saida" (gasto): compras, débitos, Pix/TED enviados, PAGAMENTOS DE CONTAS E BOLETOS (luz, água, gás, internet,
  telefone, condomínio, aluguel, escola, seguros, tributos), débitos automáticos, assinaturas, tarifas, IOF, juros, saques.
- "entrada": salários, depósitos, Pix recebidos, TED/DOC/transferências recebidas, rendimentos, reembolsos e estornos.

NÃO inclua: saldo anterior/atual/do dia, totais e subtotais, limites, aplicações e resgates de investimento,
e o pagamento da própria fatura do cartão de crédito (no extrato: "Pagamento de fatura"; na fatura: "Inclusão de pagamento",
"Pagamento recebido") — as compras do cartão entram pela própria fatura. Boletos de outras contas NÃO são pagamento de fatura: inclua-os.

Layouts comuns (ex.: Santander, Itaú, Bradesco, Banco do Brasil):
- Faturas podem listar os lançamentos em DUAS COLUNAS lado a lado e ter uma seção por cartão (titular e adicionais): inclua todas.
- IGNORE seções de parcelas FUTURAS ("Compras parceladas - próximas faturas", "Lançamentos futuros", "Parcelas a vencer"):
  só entram as parcelas cobradas nesta fatura. Ignore também resumo da fatura, pagamento mínimo, limites, tabelas de juros/CET,
  opções de parcelamento da fatura e cotação do dólar.
- Em faturas, valores negativos ou com "-" são créditos (estornos → entrada; pagamento da fatura → ignorar).
- Em extratos, débitos podem aparecer com "-" no fim (ex.: 189,90-) e a data pode aparecer só na primeira movimentação do dia:
  as linhas seguintes sem data pertencem ao mesmo dia. Ignore "Saldo anterior", "Saldo do dia" e a coluna de saldo.
- Em compras internacionais, use o valor em R$ (não o valor em US$).
- Fatura Santander: o "Detalhamento da Fatura" traz, para cada cartão (titular e adicionais), as seções "Pagamento e Demais
  Créditos", "Parcelamentos" e "Despesas" — inclua todas (as parcelas listadas ali são as cobradas nesta fatura). Ignore
  "Resumo da Fatura", "Saldo total consolidado de obrigações futuras", "Histórico de Faturas", anuidade com valor 0,00 e números
  soltos (1 dígito) antes da data, que são apenas marcadores.
- Extrato do app Santander: cada movimentação ocupa três linhas — tipo acima ("Pix enviado", "Pagamento de boleto outros bancos",
  "Debito visa electron brasil"), data com valor e saldo no meio, e o nome do favorecido abaixo. Combine tipo e nome na descrição
  (ex.: "Pix enviado - Fulano"). Valores podem usar espaço como separador de milhar (R$ 1 600,00). "Liquido de vencimento" é salário.

Demonstrativo de pagamento (holerite/contracheque): tipo_documento "holerite". Gere UMA entrada "Salário" com o
valor do TOTAL LÍQUIDO na data de pagamento ("Dt. pagt."), descrição "Salário líquido - <empresa> (ref. MM/AAAA)".
Descontos de consumo (plano de saúde/assistência médica, odontológica, coparticipação, seguro de vida, previdência privada,
empréstimo consignado, contribuições, vale-transporte, refeição) viram saídas na mesma data com descrição "<desconto> (desconto em folha)".
NÃO inclua proventos brutos, INSS, IRRF, FGTS, bases de cálculo nem "salário contratual/nominal".

Regras gerais:
- Compras parceladas: registre só a parcela cobrada neste documento; acrescente "(parcela X/Y)" à descrição.
- Datas sem ano: deduza o ano pelo período do documento (fatura de janeiro com compra em dezembro = ano anterior). Formato AAAA-MM-DD.
- Valores sempre positivos, em reais, com ponto decimal. Em planilhas, sinal negativo ou colunas "Débito"/"Crédito" indicam a natureza;
  em faturas de cartão, valores positivos costumam ser compras e negativos, pagamentos/estornos.
- Descrição: o estabelecimento ou a contraparte, limpo e legível. Em planilhas com mais de uma coluna descritiva
  (ex.: C6 "Título" + "Descrição"), combine-as, ex.: "Pagamento de boleto - CPFL Paulista".
- Planilhas: colunas "Entrada"/"Crédito" = entrada e "Saída"/"Débito" = saída; ignore colunas de saldo, cotação e valores em US$
  (use o valor em R$). Se houver coluna "Parcela" (ex.: 2/4), acrescente "(parcela 2/4)" à descrição. Se o banco informar uma
  coluna "Categoria", use-a como pista para a categoria.

Categorias de SAÍDA:
  Mercado (supermercados, atacarejos, hortifruti, açougue), Farmácia (drogarias), Padaria (padarias, confeitarias, cafeterias de bairro),
  iFood (iFood, Rappi, Zé Delivery e apps de entrega de comida), Restaurante (restaurantes, bares, lanchonetes presenciais),
  Transporte (Uber, 99, ônibus, metrô, estacionamento, pedágio), Combustível (postos), Contas da casa (luz, água, gás, internet, telefone, condomínio, aluguel, IPTU),
  Saúde (médicos, exames, planos, dentista, academia), Lazer (cinema, viagens, hotéis, eventos), Compras (lojas, e-commerce, vestuário, eletrônicos),
  Assinaturas (streaming, softwares, serviços recorrentes), Educação (escola, faculdade, cursos, material escolar),
  Impostos e taxas (DARF, DAS, IPVA, IPTU, licenciamento, taxas públicas), Seguros (auto, vida, residencial, cartão protegido),
  Tarifas e juros (tarifas bancárias, cesta de serviços, anuidade, IOF, juros, multas),
  Transferências (Pix/TED/DOC enviados a pessoas, quando não for um estabelecimento identificável), Outros (o que não se encaixar).
  Boleto ou débito automático de concessionária (energia, água, gás, telefone, internet) ou condomínio/aluguel = Contas da casa.
Categorias de ENTRADA:
  Salário (salário, pró-labore, folha, adiantamento salarial), Pix recebido, Depósito, Transferência (TED/DOC/transferências recebidas),
  Rendimentos (juros, rendimentos, dividendos), Outras entradas (reembolsos, estornos e o restante).

Vencimento: em faturas de cartão, informe a data de vencimento da fatura (aparece como "Vencimento" no PDF;
em planilhas, costuma estar no nome do arquivo, ex.: Nubank_2026-11-10.csv). Mantenha em cada transação a data da COMPRA.

Se o documento não for um extrato ou fatura, devolva a lista de transações vazia.`;

let client;

export default handler(async (req) => {
  requireUser(req);
  if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido.');
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(501, 'Leitura com IA não configurada (ANTHROPIC_API_KEY ausente).');
  }

  const body = req.body || {};
  const pdf = String(body.pdf || '').replace(/^data:application\/pdf;base64,/, '').replace(/\s/g, '');
  const texto = String(body.texto || '');
  let documento;
  if (pdf) {
    if (pdf.length * 0.75 > MAX_PDF_BYTES) throw new HttpError(413, 'PDF muito grande (máx. ~3 MB). Divida o arquivo e tente de novo.');
    documento = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } };
  } else if (texto.trim()) {
    if (texto.length > MAX_TEXTO) throw new HttpError(413, 'Planilha muito grande. Exporte um período menor (ex.: um mês) e tente de novo.');
    const nome = String(body.nome || 'planilha').slice(0, 100);
    documento = { type: 'text', text: `<planilha nome="${nome.replace(/"/g, '')}">\n${texto}\n</planilha>` };
  } else {
    throw new HttpError(400, 'Envie o PDF em base64 no campo "pdf" ou o conteúdo da planilha no campo "texto".');
  }

  client ||= new Anthropic();

  let message;
  try {
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          documento,
          { type: 'text', text: 'Extraia todos os gastos e entradas deste documento.' },
        ],
      }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Muitas leituras seguidas. Aguarde um minuto e tente de novo.');
    if (err instanceof Anthropic.BadRequestError) throw new HttpError(400, `Não foi possível ler o arquivo: ${err.message}`);
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(500, 'ANTHROPIC_API_KEY inválida.');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `Falha na IA: ${err.message}`);
    throw err;
  }

  if (message.stop_reason === 'refusal') throw new HttpError(422, 'A IA não conseguiu processar este documento.');
  if (message.stop_reason === 'max_tokens') throw new HttpError(422, 'Documento muito longo. Divida o PDF em partes menores.');

  const resposta = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let dados;
  try {
    dados = JSON.parse(resposta);
  } catch {
    throw new HttpError(502, 'Resposta da IA em formato inesperado.');
  }

  const transacoes = (dados.transacoes || [])
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.data) && Number(t.valor) !== 0)
    .map((t) => {
      const natureza = t.natureza === 'entrada' ? 'entrada' : 'saida';
      return {
        data: t.data,
        descricao: String(t.descricao || '').slice(0, 200),
        valor: Math.round(Math.abs(Number(t.valor)) * 100) / 100,
        natureza,
        tipo: natureza === 'entrada' ? normalizaEntrada(t.tipo) : normalizaCategoria(t.tipo),
      };
    });

  const vencimento = /^\d{4}-\d{2}-\d{2}$/.test(dados.vencimento || '') ? dados.vencimento : '';
  return { banco: dados.banco || '', tipoDocumento: dados.tipo_documento, vencimento, transacoes, metodo: 'ia' };
});
