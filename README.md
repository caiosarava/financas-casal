# 💑 Finanças do Casal

PWA (web app instalável no Android) para o casal registrar gastos e entradas, acompanhar o mês num dashboard e guardar dinheiro para as metas do ano. Os dados ficam numa **planilha Google Sheets** no Drive do Caio.

- **Usuários:** apenas `caio.sarava@gmail.com` e `thianedepra@gmail.com` (login com Google).
- **Hospedagem:** Vercel, com deploy automático a partir do GitHub.
- **Stack:** HTML + CSS + JavaScript puro (sem build) no `public/`, funções serverless Node em `api/`.

## Funcionalidades

| Tela | O que faz |
|---|---|
| **Início** | Gastos do mês (comparado ao mês anterior), **balanço Entradas × Gastos × Saldo**, botão **＋ Registrar entrada**, entradas e gastos por pessoa, gráfico por tipo, gráfico por pessoa × tipo, evolução acumulada no mês e resumo das metas. Filtros **Tudo / Casal / Meus** e navegação entre meses. Tocar num tipo abre a lista filtrada. |
| **＋ (botão flutuante)** | Registrar gasto: valor, tipo (atalhos para Mercado, Farmácia, Padaria e iFood + outros tipos), data, descrição e **quem pode ver**: 👫 Casal (compartilhado) ou 🔒 Só eu. |
| **Registrar entrada** | No mesmo formulário (alternando 💸 Gasto / 💰 Entrada) ou pelo botão do dashboard: Salário, Pix recebido, Depósito, Transferência, Rendimentos e Outras entradas — também com opção casal / só eu. |
| **Lançamentos** | Gastos e entradas do mês agrupados por dia (entradas em verde com "+"), com filtro por tipo, só gastos ou só entradas. Toque num lançamento seu para editar/excluir. |
| **Metas** | Meta anual do **casal** e meta **individual**. Botão **＋ Guardar** registra cada valor guardado; a barra mostra o progresso e quanto falta por mês até dezembro. Metas individuais só aparecem para o dono. |
| **✨ Análise com IA (Gemini)** | Card no Início que analisa o mês (respeitando o filtro Tudo/Casal/Meus) comparando com o mês anterior, e botão **"Analisar este extrato"** na revisão da importação. Traz resumo, alertas (ex.: parcelamento de fatura com juros, IOF, tarifas, cobranças possivelmente duplicadas), assinaturas recorrentes, parcelamentos em andamento e dicas de economia. |
| **Importar** | Upload do extrato bancário ou fatura do cartão em **PDF, CSV, XLS, XLSX ou ODS**. A IA (Claude) extrai **gastos e entradas** e identifica o tipo de cada um. Você revisa, troca gasto ↔ entrada, ajusta tipos, desmarca duplicados e salva. Sem chave de IA, há leitores locais de reserva (para CSV/XLS eles reconhecem colunas como Data, Histórico/Descrição, Valor ou Débito/Crédito). |

### Regras de visibilidade (valem para gastos e entradas)
- Lançamento **compartilhado**: os dois veem e entra nos gráficos do casal.
- Lançamento **só eu**: aparece apenas para quem registrou.
- Só quem registrou pode editar ou excluir.

## Estrutura

```
public/            → front-end estático (PWA)
  index.html, styles.css, app.js, sw.js, manifest.webmanifest, icons/, vendor/chart.umd.min.js
api/               → funções serverless da Vercel
  config.js        → configurações públicas (client id do Google, categorias)
  auth.js          → login Google → token de sessão (30 dias)
  gastos.js        → listar / criar (1 ou vários) / editar / excluir gastos
  entradas.js      → o mesmo para entradas (salário, Pix, depósito, transferência…)
  metas.js         → metas anuais e valores guardados
  importar.js      → leitura do extrato (PDF ou planilha convertida em texto) com o Claude
  analise.js       → análise financeira dos lançamentos com o Gemini
lib/               → autenticação, acesso ao Sheets, categorias
```

A planilha usa as abas **Gastos**, **Entradas**, **Metas** e **Aportes** — as que faltarem são criadas automaticamente no primeiro uso.

---

## Configuração (passo a passo)

### 1. Planilha
1. Entre no Google Drive com **caio.sarava@gmail.com** e crie uma planilha em branco, ex.: *Finanças do Casal*.
2. Copie o **ID** da URL: `https://docs.google.com/spreadsheets/d/`**`ESTE_TRECHO`**`/edit`.

### 2. Projeto no Google Cloud
1. Acesse <https://console.cloud.google.com/>, crie um projeto (ex.: `financas-casal`).
2. **APIs e serviços → Biblioteca** → ative a **Google Sheets API**.

### 3. Conta de serviço (o app usa para ler/gravar na planilha)
1. **APIs e serviços → Credenciais → Criar credenciais → Conta de serviço**. Dê um nome e conclua.
2. Abra a conta criada → aba **Chaves → Adicionar chave → JSON**. Um arquivo será baixado.
3. Do JSON, você vai usar `client_email` e `private_key`.
4. Na planilha, clique em **Compartilhar** e adicione o `client_email` como **Editor**.

> A planilha continua sendo do Caio; a conta de serviço é apenas uma "editora" usada pelo servidor.

### 4. Login com Google (OAuth Client ID)
1. **APIs e serviços → Tela de consentimento OAuth**: tipo *Externo*, preencha nome do app e e-mail. Em **Usuários de teste**, adicione os dois e-mails (ou publique o app).
2. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**.
3. Em **Origens JavaScript autorizadas**, adicione a URL da Vercel (ex.: `https://financas-casal.vercel.app`) e, para testes locais, `http://localhost:3000`.
4. Copie o **ID do cliente**.

### 5. (Opcional, recomendado) Chave da API do Claude
Para a leitura inteligente de PDFs, crie uma chave em <https://console.anthropic.com/> (*API Keys*). Sem ela, o app usa o leitor local, que funciona melhor com extratos simples.

### 5b. (Opcional) Chave da API do Gemini
Para a análise financeira com IA, crie uma chave gratuita no **Google AI Studio**: <https://aistudio.google.com/apikey> → *Create API key*. O modelo padrão é `gemini-3.8-flash`; para usar outro, defina `GEMINI_MODEL`.

### 6. Deploy na Vercel
1. Em <https://vercel.com/new>, importe o repositório `caiosarava/financas-casal` (Framework: **Other**; não há build).
2. Em **Settings → Environment Variables**, cadastre:

| Variável | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | ID do cliente OAuth (passo 4) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` do JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` do JSON (cole inteiro, incluindo `-----BEGIN...`) |
| `SHEET_ID` | ID da planilha (passo 1) |
| `SESSION_SECRET` | texto aleatório longo (ex.: resultado de `openssl rand -hex 32`) |
| `ALLOWED_EMAILS` | `caio.sarava@gmail.com,thianedepra@gmail.com` |
| `USER_NAMES` | `caio.sarava@gmail.com:Caio,thianedepra@gmail.com:Thiane` |
| `ANTHROPIC_API_KEY` | (opcional) chave da API do Claude — leitura dos extratos |
| `GEMINI_API_KEY` | (opcional) chave da API do Gemini — análise financeira com IA |
| `GEMINI_MODEL` | (opcional) modelo do Gemini; padrão `gemini-3.8-flash` |
| `GEMINI_MODELOS_RESERVA` | (opcional) modelos usados quando o principal está sobrecarregado; padrão `gemini-3.8-flash-lite` |

3. Faça o deploy (ou **Redeploy** após cadastrar as variáveis).
4. Volte ao passo 4 e confira se a URL final da Vercel está nas origens autorizadas.

### 7. Instalar no Android
Abra a URL no **Chrome** → menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial"). Pressionar e segurar o ícone mostra o atalho **Registrar gasto**.

---

## Desenvolvimento local

```bash
npm install
cp .env.example .env.local   # preencha os valores
npx vercel dev               # http://localhost:3000
```

## Observações
- **Tamanho dos arquivos:** PDF até ~3 MB (limite de requisição da Vercel); planilhas até ~400 mil caracteres. Para arquivos maiores, exporte um período menor.
- **XLS/XLSX:** o leitor (SheetJS 0.20.3) é carregado sob demanda de `cdn.sheetjs.com` na primeira importação de planilha. CSV é lido sem bibliotecas (detecta `;`/`,` e acentuação UTF-8 ou Windows-1252).
- **Faturas de cartão → mês de vencimento:** quando o arquivo é uma fatura, todos os lançamentos são gravados na data de vencimento (detectada pela IA, pelo texto do PDF ou pelo nome do arquivo, ex.: `Nubank_2026-11-10.csv`; dá para ajustar na revisão). A data da compra fica na descrição, ex.: "Drogasil (compra 05/10)". Extratos bancários continuam com a data de cada movimentação.
- **Duplicados:** na importação, lançamentos já registrados por você (mesmo valor e data) vêm desmarcados e sinalizados. No modo fatura, lançamentos importados antes na data da compra são **movidos** para o vencimento em vez de duplicados.
- **Categorias:** gastos e entradas definidas em `lib/categorias.js` e `public/app.js` (mantenha as listas iguais).
- **Análise com Gemini e privacidade:** a análise do mês é montada no servidor só com os lançamentos que você pode ver (os "só eu" do outro nunca são enviados); do mês anterior vão apenas os totais. Na análise da importação, vão os lançamentos do arquivo enviado. Os dados são processados pela API do Google conforme os termos do Gemini API.
- **Privacidade:** o servidor filtra os gastos "só eu" antes de enviar ao app; a planilha em si contém todos os registros.
