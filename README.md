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
| **Lançamentos** | Gastos e entradas do mês agrupados por dia (entradas em verde com "+"), com filtro por tipo, só gastos ou só entradas, e filtro **Todos / 👫 Casal / 🔒 Só meus** (com o total do que está filtrado); dentro de **Casal**, dá para ver só o que foi registrado pelo **Caio** ou pela **Thiane**. No fim da lista, **🗑️ Apagar meus lançamentos** apaga, com confirmação, os lançamentos de quem está usando (do mês ou de todos os meses; gastos e/ou entradas) — os da outra pessoa nunca são afetados. Toque num lançamento seu para editar/excluir. |
| **🐷 Cofrinhos** | Quantos cofrinhos quiser, **do casal** (os dois veem e guardam) ou **só seus**, cada um com nome, emoji, meta e prazo opcionais. **＋ Guardar** e **↩ Resgatar** registram as movimentações; o cofrinho mostra o progresso e quanto guardar por mês para chegar à meta no prazo. A antiga meta anual vira automaticamente o cofrinho "Meta AAAA". |
| **✨ Análise com IA (NVIDIA)** | Card no Início que analisa o mês (respeitando o filtro Tudo/Casal/Meus) comparando com o mês anterior, e botão **"Analisar este extrato"** na revisão da importação. Traz resumo, alertas (ex.: parcelamento de fatura com juros, IOF, tarifas, cobranças possivelmente duplicadas), assinaturas recorrentes, parcelamentos em andamento e dicas de economia. |
| **Importar** | Upload do extrato bancário, fatura do cartão ou **demonstrativo de pagamento (holerite)** em **PDF, CSV, XLS, XLSX ou ODS**. No holerite, a entrada é o **salário líquido** e os descontos em folha de consumo (plano de saúde, odonto, seguro…) viram gastos; INSS/IRRF vêm desmarcados, e uma opção soma os descontos lançados à entrada para o saldo não descontar duas vezes. A IA (Claude) extrai **gastos e entradas** e identifica o tipo de cada um. Você revisa, troca gasto ↔ entrada, ajusta tipos, escolhe **👫 Casal ou 🔒 Só eu em cada lançamento** (ou aplica a todos os selecionados), desmarca duplicados e salva. Sem chave de IA, há leitores locais de reserva (para CSV/XLS eles reconhecem colunas como Data, Histórico/Descrição, Valor ou Débito/Crédito). |
| **📚 Arquivos já importados** | Na aba Importar, lista de todos os arquivos salvos: tipo (extrato, fatura, holerite), banco, período, quem importou e quando, e — nas suas importações — quantos gastos, entradas e transferências internas entraram. Ao escolher um arquivo que já foi importado, o app avisa na hora (pela impressão digital SHA-256 do arquivo). Cada lançamento importado guarda de qual importação veio (coluna `importacao`): **↩ Desfazer importação** apaga de uma vez os lançamentos daquele arquivo (inclusive os editados depois) e o tira do histórico; o ✕ remove só do histórico, sem apagar lançamentos. Se a gravação falhar no meio, o app desfaz o que já tinha gravado. |

### 🔁 Transferências internas (entre contas do casal)
Dinheiro que só **muda de conta** — por exemplo, a Thiane faz um Pix do Santander para o Nubank e depois paga a fatura do Nubank — não é gasto nem entrada. Na importação de **extratos**, o app marca como **"Transferência interna"**:
- Pix/TED/transferências cujo favorecido ou remetente é **a própria pessoa** ou **o parceiro** (reconhecidos pelo nome; o nome completo do perfil Google é guardado no login, e `NOMES_COMPLETOS` pode definir/ajustar);
- o **pagamento da fatura do cartão** no extrato (os gastos de verdade entram pela importação da própria fatura).

Elas ficam registradas (com ↔ na lista), mas **não entram em gastos, entradas, saldo, gráficos nem na análise com IA**. Na revisão, cada linha mostra o motivo e dá para trocar o tipo. Dentro da fatura, o crédito do pagamento continua sendo ignorado e Pix pagos no crédito continuam como gastos.

### 💳 Pagamento parcial e parcelamento de fatura
Quando a fatura não é paga inteira e o restante é parcelado, as parcelas que vêm nas faturas seguintes ("Parcelamento de fatura k/n") **devolvem compras que já foram contadas como gasto**. Contá-las de novo inflaria os gastos. Por isso o app:
- cadastra o parcelamento (total da fatura, quanto foi pago, nº e valor das parcelas) e calcula **valor financiado, juros e saldo devedor**;
- na importação do **extrato**, compara o pagamento da fatura com o total da fatura já importada e avisa **"Pagamento parcial… faltam R$ X"**, oferecendo o cadastro já preenchido;
- na importação da **fatura**, divide cada parcela em **amortização** (tipo "Parcelamento de fatura", fora dos gastos e do saldo) e **juros** ("Tarifas e juros", conta como gasto), e atualiza quantas parcelas já foram pagas; parcelamentos sem cadastro podem ser cadastrados ali mesmo;
- mostra no Início o card **💳 Parcelamentos de fatura** com parcelas pagas, quanto falta e os juros.

Ex.: fatura de R$ 1.000, pagos R$ 400, resto em 6× R$ 120 → gastos totais = R$ 1.000 (compras) + R$ 120 (juros), e não R$ 1.720.

### Regra do salário no mês seguinte (Thiane)
Uma **entrada do tipo Salário** registrada pela Thiane no **último dia útil do mês** (ou depois dele, em fim de semana/feriado) é considerada no **primeiro dia útil do mês seguinte**; a data original fica na descrição, ex.: "Liquido de vencimento (recebido em 30/10)". Dias úteis consideram fins de semana e feriados bancários nacionais (incluindo Carnaval, Sexta-feira Santa, Corpus Christi e 31/12). A regra é aplicada no servidor ao criar o lançamento (manual ou importado) e aparece como aviso no formulário e na revisão da importação; editar o lançamento depois respeita a data escolhida. Os e-mails da regra ficam em `REGRA_SALARIO_MES_SEGUINTE` (padrão `thianedepra@gmail.com`). Código: `public/regras.js`.

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
  analise.js       → análise financeira dos lançamentos com IA (API da NVIDIA, lib/nvidia.js)
  importacoes.js   → histórico de arquivos importados
  parcelamentos.js → parcelamentos de fatura (pagamento parcial)
lib/               → autenticação, acesso ao Sheets, categorias
```

A planilha usa as abas **Gastos**, **Entradas**, **Cofrinhos**, **Aportes** (movimentações dos cofrinhos), **Importacoes** (histórico de arquivos), **Usuarios** (nomes completos) e **Metas** (legado) — as que faltarem são criadas automaticamente no primeiro uso.

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

### 5b. (Opcional) Chave da API da NVIDIA (análise com IA)
Para a análise financeira com IA, crie uma chave em <https://build.nvidia.com/> → faça login → **Get API Key** (começa com `nvapi-`).
Cadastre-a **somente** na Vercel, na variável `NVIDIA_API_KEY` — nunca no código ou no repositório.
**Modelo escolhido automaticamente:** a NVIDIA aposenta modelos com frequência (erro 410 "end of life"), então o app consulta
a lista de modelos liberados para a chave (`/v1/models`), descarta os que não são de conversa (embeddings, imagem, áudio, moderação,
código…), prefere as famílias mais capazes e passa para o próximo se algum falhar; o que funcionou é reaproveitado nas análises seguintes.
Para fixar um modelo, use `NVIDIA_MODEL` (e opcionalmente `NVIDIA_MODELOS_RESERVA`) com IDs do catálogo do build.nvidia.com —
se eles forem aposentados, o app volta a escolher pelo catálogo.

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
| `REGRA_SALARIO_MES_SEGUINTE` | (opcional) e-mails da regra do salário no mês seguinte; padrão `thianedepra@gmail.com` |
| `NVIDIA_API_KEY` | (opcional) chave da API da NVIDIA (`nvapi-…`) — análise financeira com IA |
| `NVIDIA_MODEL` | (opcional) fixa o modelo; sem ele, o app escolhe pelo catálogo da NVIDIA |
| `NVIDIA_MODELOS_RESERVA` | (opcional) modelos de reserva, separados por vírgula, tentados antes do catálogo |

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
- **Bancos reconhecidos na leitura local de CSV/XLS:** C6 (conta: colunas Título/Descrição/Entrada/Saída; cartão: Categoria/Parcela/Valor em R$), Nubank, Itaú e formatos com colunas Data + Descrição + Valor (com sinal, Débito/Crédito, Entrada/Saída ou coluna Tipo D/C). Pagamento da fatura do cartão, saldos e aplicações/resgates são ignorados.
- **PDFs (leitura local e reserva da IA):** validado com fatura e extrato reais do Santander (totais conferidos com os do próprio PDF). O leitor junta textos "picotados" (extrato do app Santander), combina descrições em várias linhas (tipo acima, nome abaixo), aceita milhar com espaço/caractere invisível (R$ 1 600,00) e usa a posição das colunas na página — separa faturas com lançamentos em duas colunas (ex.: Santander), distingue Crédito/Débito/Saldo/US$ pelo cabeçalho, entende débitos com "-" no fim, datas só na primeira linha do dia e datas como "15 OUT"; ignora parcelas de próximas faturas, resumo, limites e tabelas de juros.
- **PDF com senha:** o app pede a senha ao abrir (ela é usada só no seu aparelho). Com a IA ligada, se o Claude não conseguir abrir o PDF, o texto é extraído no aparelho e enviado à IA.
- **Categorias:** gastos e entradas definidas em `lib/categorias.js` e `public/app.js` (mantenha as listas iguais).
- **Análise com IA e privacidade:** a análise do mês é montada no servidor só com os lançamentos que você pode ver (os "só eu" do outro nunca são enviados); do mês anterior vão apenas os totais. Na análise da importação, vão os lançamentos do arquivo enviado. Os dados são processados pela API da NVIDIA (build.nvidia.com), conforme os termos dela.
- **Privacidade:** o servidor filtra os gastos "só eu" antes de enviar ao app; a planilha em si contém todos os registros.
