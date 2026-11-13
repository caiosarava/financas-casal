// Finanças do Casal — frontend (PWA, JS puro)

// ---------- Constantes ----------
const CATS = {
  'Mercado': '🛒', 'Farmácia': '💊', 'Padaria': '🥖', 'iFood': '🛵', 'Restaurante': '🍽️',
  'Transporte': '🚗', 'Combustível': '⛽', 'Contas da casa': '🏠', 'Saúde': '🩺',
  'Lazer': '🎉', 'Compras': '🛍️', 'Assinaturas': '📺', 'Outros': '📦',
};
const CATS_E = {
  'Salário': '💼', 'Pix recebido': '⚡', 'Depósito': '🏦', 'Transferência': '🔁', 'Rendimentos': '📈', 'Outras entradas': '💵',
};
const RAPIDOS = ['Mercado', 'Farmácia', 'Padaria', 'iFood'];
const RAPIDOS_E = ['Salário', 'Pix recebido', 'Depósito', 'Transferência'];
const ENDPOINT = { saida: '/api/gastos', entrada: '/api/entradas' };
const emojiDe = (tipo) => CATS[tipo] || CATS_E[tipo] || '📦';
const catsDe = (natureza) => (natureza === 'entrada' ? CATS_E : CATS);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v) => brl.format(v || 0);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const hoje = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseValor = (s) => {
  let t = String(s).trim().replace(/[R$\s]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
};

// ---------- Estado ----------
const state = {
  token: lerLS('fc_token'),
  user: null,
  config: null,
  mes: lerSS('fc_mes') || hoje().slice(0, 7),
  ano: new Date().getFullYear(),
  visao: lerLS('fc_visao') || 'todos',
  view: 'inicio',
  cache: {},          // mes -> { gastos[], entradas[] }
  metas: null,
  charts: {},
  importados: [],
  analises: {},       // cache de análises do Gemini por mês/visão
};

// Mês em exibição: lembrado durante a sessão (sobrevive a "atualizar a tela")
function lerSS(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function mudarMes(mes) {
  if (!/^\d{4}-\d{2}$/.test(mes || '')) return;
  state.mes = mes;
  try { sessionStorage.setItem('fc_mes', mes); } catch { /* ignore */ }
}

function lerLS(k) { try { return localStorage.getItem(k); } catch { return null; } }
function gravarLS(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } }

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (res.status === 401 && path !== '/api/auth') { sair(); throw new Error(data.error || 'Sessão expirada.'); }
  if (!res.ok) { const e = new Error(data.error || `Erro ${res.status}`); e.status = res.status; throw e; }
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}
const carregando = (on) => $('#carregando').classList.toggle('hidden', !on);

// ---------- Login ----------
async function iniciar() {
  try {
    state.config = await api('/api/config');
  } catch (e) {
    mostrarLogin(`Não foi possível carregar a configuração: ${e.message}`);
    return;
  }
  if (state.token) {
    try {
      const { user } = await api('/api/auth');
      state.user = user;
      return entrarNoApp();
    } catch { gravarLS('fc_token', null); state.token = null; }
  }
  mostrarLogin();
}

function mostrarLogin(erro = '') {
  $('#app').classList.add('hidden');
  $('#tela-login').classList.remove('hidden');
  $('#login-erro').textContent = erro;
  if (!state.config?.googleClientId) {
    $('#login-erro').textContent ||= 'GOOGLE_CLIENT_ID não configurado no servidor.';
    return;
  }
  const render = () => {
    if (!window.google?.accounts?.id) return setTimeout(render, 200);
    google.accounts.id.initialize({ client_id: state.config.googleClientId, callback: aoLogarGoogle, auto_select: true });
    google.accounts.id.renderButton($('#google-btn'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'pt-BR' });
    google.accounts.id.prompt();
  };
  render();
}

async function aoLogarGoogle({ credential }) {
  try {
    carregando(true);
    const { token, user } = await api('/api/auth', { method: 'POST', body: { credential } });
    state.token = token;
    state.user = user;
    gravarLS('fc_token', token);
    entrarNoApp();
  } catch (e) {
    $('#login-erro').textContent = e.message;
  } finally { carregando(false); }
}

function sair() {
  gravarLS('fc_token', null);
  state.token = null;
  state.user = null;
  state.cache = {};
  try { google.accounts.id.disableAutoSelect(); } catch { /* ignore */ }
  mostrarLogin();
}

function entrarNoApp() {
  $('#tela-login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#saudacao').textContent = `Olá, ${state.user.nome} 👋`;
  montarFormularioGasto();
  $$('#filtro-visao button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.visao));
  const params = new URLSearchParams(location.search);
  irPara(params.get('view') || 'inicio');
  if (params.get('acao') === 'novo') abrirGasto();
  if (params.get('acao') === 'entrada') abrirGasto(null, 'entrada');
}

// ---------- Navegação ----------
const TITULOS = { inicio: 'Início', gastos: 'Lançamentos', metas: 'Metas do ano', importar: 'Importar extrato' };
function irPara(view) {
  state.view = TITULOS[view] ? view : 'inicio';
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${state.view}`));
  $$('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  $('#titulo-tela').textContent = TITULOS[state.view];
  window.scrollTo(0, 0);
  atualizarView();
}

function atualizarView() {
  if (state.view === 'inicio') return renderInicio();
  if (state.view === 'gastos') return renderLista();
  if (state.view === 'metas') return renderMetas();
}

function mesLabel(mes) {
  const [a, m] = mes.split('-').map(Number);
  const t = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function deslocarMes(mes, delta) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function dadosDoMes(mes, forcar = false) {
  if (!state.cache[mes] || forcar) {
    const [g, e] = await Promise.all([api(`/api/gastos?mes=${mes}`), api(`/api/entradas?mes=${mes}`)]);
    state.cache[mes] = {
      gastos: g.itens.map((x) => ({ ...x, natureza: 'saida' })),
      entradas: e.itens.map((x) => ({ ...x, natureza: 'entrada' })),
    };
  }
  return state.cache[mes];
}

function filtrarVisao(gastos) {
  if (state.visao === 'casal') return gastos.filter((g) => g.compartilhado);
  if (state.visao === 'meus') return gastos.filter((g) => g.meu);
  return gastos;
}

const nomeDe = (email) => state.user.usuarios.find((u) => u.email === email)?.nome || email.split('@')[0];

// Cores: séries categóricas validadas (azul / laranja) — claro e escuro.
const escuro = () => matchMedia('(prefers-color-scheme: dark)').matches;
const COR_PESSOAS = () => (escuro() ? ['#3987e5', '#d95926'] : ['#2a78d6', '#eb6834']);
const corPessoa = (email) => {
  const i = state.user.usuarios.findIndex((u) => u.email === email);
  return COR_PESSOAS()[i < 0 ? 0 : i % 2];
};
const compacto = (v) => (v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${v}`);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ---------- Dashboard ----------
async function renderInicio() {
  $('#mes-label').textContent = mesLabel(state.mes);
  let atual, anterior;
  try {
    [atual, anterior] = await Promise.all([dadosDoMes(state.mes), dadosDoMes(deslocarMes(state.mes, -1))]);
  } catch (e) { toast(e.message); return; }
  if (state.view !== 'inicio') return;
  const g = filtrarVisao(atual.gastos);
  const gAnt = filtrarVisao(anterior.gastos);
  const ent = filtrarVisao(atual.entradas);
  const totalEnt = ent.reduce((s, x) => s + x.valor, 0);
  const total = g.reduce((s, x) => s + x.valor, 0);
  const totalAnt = gAnt.reduce((s, x) => s + x.valor, 0);

  $('#total-mes').textContent = fmt(total);
  if (totalAnt > 0) {
    const pct = ((total - totalAnt) / totalAnt) * 100;
    $('#comparativo').textContent = `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% vs mês anterior (${fmt(totalAnt)})`;
  } else {
    $('#comparativo').textContent = `${g.length} gasto${g.length === 1 ? '' : 's'} no mês`;
  }

  // Balanço do mês
  const saldo = totalEnt - total;
  $('#bal-entradas').textContent = fmt(totalEnt);
  $('#bal-gastos').textContent = fmt(total);
  $('#bal-saldo').textContent = `${saldo < 0 ? '−' : ''}${fmt(Math.abs(saldo))}`;
  $('#bal-saldo').className = saldo < 0 ? 'neg' : 'pos';

  // Por pessoa
  const soma = (lista, email) => lista.filter((x) => x.usuario === email).reduce((s, x) => s + x.valor, 0);
  $('#cards-pessoas').innerHTML = `<h3>Por pessoa</h3><table class="tabela-pessoas">
    <thead><tr><th></th><th>Entradas</th><th>Gastos</th></tr></thead><tbody>
    ${state.user.usuarios.map((u) => `<tr><td><i class="dot" style="background:${corPessoa(u.email)}"></i>${esc(u.nome)}</td>
      <td class="pos">${fmt(soma(ent, u.email))}</td><td>${fmt(soma(g, u.email))}</td></tr>`).join('')}
    <tr><td class="sub">Compartilhados</td><td>${fmt(ent.filter((x) => x.compartilhado).reduce((s, x) => s + x.valor, 0))}</td>
      <td>${fmt(g.filter((x) => x.compartilhado).reduce((s, x) => s + x.valor, 0))}</td></tr>
    </tbody></table>`;

  // Por tipo (barra horizontal, uma cor — magnitude)
  const porTipo = Object.keys(CATS)
    .map((t) => ({ t, v: g.filter((x) => x.tipo === t).reduce((s, x) => s + x.valor, 0) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);
  $('#legenda-tipo').innerHTML = porTipo.length
    ? porTipo.map((x) => `<li data-tipo="${esc(x.t)}"><span>${CATS[x.t]} ${esc(x.t)}</span><span>${((x.v / total) * 100).toFixed(0)}%</span></li>`).join('')
    : '';
  $$('#legenda-tipo li').forEach((li) => li.addEventListener('click', () => {
    $('#filtro-tipo').value = li.dataset.tipo;
    irPara('gastos');
  }));

  if (!window.Chart) { setTimeout(renderInicio, 300); return; }
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--border');
  const tooltip = { callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${fmt(c.parsed.x ?? c.parsed.y)}` } };

  desenhar('tipo', $('#chart-tipo'), porTipo.length ? {
    type: 'bar',
    data: {
      labels: porTipo.map((x) => `${CATS[x.t]} ${x.t}`),
      datasets: [{ data: porTipo.map((x) => x.v), backgroundColor: css('--primary'), borderRadius: 4, borderSkipped: 'start', barThickness: 14 }],
    },
    options: {
      indexAxis: 'y', maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed.x)} (${((c.parsed.x / total) * 100).toFixed(0)}%)` } } },
      scales: { x: { grid: { color: css('--border') }, ticks: { callback: compacto, maxTicksLimit: 5, maxRotation: 0 } }, y: { grid: { display: false } } },
      onClick: (_, els) => { if (els[0]) { $('#filtro-tipo').value = porTipo[els[0].index].t; irPara('gastos'); } },
    },
  } : null);
  $('#chart-tipo').parentElement.style.height = `${Math.max(160, porTipo.length * 30 + 40)}px`;

  // Por pessoa e tipo (barras empilhadas, uma série por pessoa)
  desenhar('pessoa', $('#chart-pessoa'), porTipo.length ? {
    type: 'bar',
    data: {
      labels: porTipo.map((x) => `${CATS[x.t]} ${x.t}`),
      datasets: state.user.usuarios.map((u) => ({
        label: u.nome,
        data: porTipo.map((x) => g.filter((y) => y.tipo === x.t && y.usuario === u.email).reduce((s, y) => s + y.valor, 0)),
        backgroundColor: corPessoa(u.email),
        borderColor: css('--card'), borderWidth: { right: 2 }, borderRadius: 4, borderSkipped: false, barThickness: 14,
      })),
    },
    options: {
      indexAxis: 'y', maintainAspectRatio: false,
      plugins: { legend: { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 5 } }, tooltip },
      scales: { x: { stacked: true, grid: { color: css('--border') }, ticks: { callback: compacto, maxTicksLimit: 5, maxRotation: 0 } }, y: { stacked: true, grid: { display: false } } },
    },
  } : null);
  $('#chart-pessoa').parentElement.style.height = `${Math.max(180, porTipo.length * 30 + 70)}px`;

  // Evolução acumulada: mês atual vs anterior
  const dias = new Date(...state.mes.split('-').map(Number), 0).getDate();
  const acumulado = (lista) => {
    const porDia = Array(31).fill(0);
    lista.forEach((x) => { porDia[Number(x.data.slice(8, 10)) - 1] += x.valor; });
    let s = 0;
    return porDia.map((v) => (s += v));
  };
  const ehMesAtual = state.mes === hoje().slice(0, 7);
  const diaHoje = Number(hoje().slice(8, 10));
  const serieAtual = acumulado(g).slice(0, dias).map((v, i) => (ehMesAtual && i + 1 > diaHoje ? null : v));
  desenhar('dia', $('#chart-dia'), (g.length || gAnt.length) ? {
    type: 'line',
    data: {
      labels: Array.from({ length: dias }, (_, i) => i + 1),
      datasets: [
        { label: 'Este mês', data: serieAtual, borderColor: css('--primary'), backgroundColor: css('--primary'), borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .2 },
        { label: 'Mês anterior', data: acumulado(gAnt).slice(0, dias), borderColor: css('--muted'), borderDash: [4, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: .2 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 2 } },
        tooltip: { callbacks: { title: (c) => `Dia ${c[0].label}`, label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: css('--border') }, ticks: { callback: compacto, maxTicksLimit: 5 } } },
    },
  } : null);

  renderMetasMini();
  renderCardAnalise();
}

function desenhar(nome, canvas, config) {
  state.charts[nome]?.destroy();
  delete state.charts[nome];
  const box = canvas.parentElement;
  box.querySelector('.vazio')?.remove();
  if (!config) {
    canvas.classList.add('hidden');
    box.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhum gasto neste mês.<br><small>Use ‹ › ou toque no nome do mês para ver outros meses.</small></p>');
    return;
  }
  canvas.classList.remove('hidden');
  state.charts[nome] = new Chart(canvas, config);
}

async function renderMetasMini() {
  try {
    if (!state.metas || state.metas.ano !== String(state.ano)) state.metas = await api(`/api/metas?ano=${state.ano}`);
  } catch { return; }
  const m = state.metas;
  const bloco = (titulo, r) => {
    const pct = r.meta ? Math.min(100, (r.guardado / r.meta) * 100) : 0;
    return `<div style="margin-top:8px"><div class="meta-num"><span>${titulo}</span><span><b style="font-size:.95rem">${fmt(r.guardado)}</b> / ${r.meta ? fmt(r.meta) : 'sem meta'}</span></div>
      <div class="progresso"><div style="width:${pct}%"></div></div></div>`;
  };
  $('#card-metas-mini').innerHTML = `<h3>🎯 Metas de ${m.ano}</h3>${bloco('👫 Casal', m.casal)}${bloco(`🙋 ${esc(state.user.nome)}`, m.individual)}`;
  $('#card-metas-mini').onclick = () => irPara('metas');
}

// ---------- Lista ----------
async function renderLista() {
  $('.mes-label-2').textContent = mesLabel(state.mes);
  const ul = $('#lista-gastos');
  let dados;
  try { dados = await dadosDoMes(state.mes); } catch (e) { toast(e.message); return; }
  const filtro = $('#filtro-tipo').value;
  let itens = [...dados.gastos, ...dados.entradas];
  if (filtro === '__saida') itens = dados.gastos;
  else if (filtro === '__entrada') itens = dados.entradas;
  else if (filtro) itens = itens.filter((g) => g.tipo === filtro);
  itens = filtrarVisao(itens).sort((a, b) => b.data.localeCompare(a.data) || (a.natureza === 'entrada' ? -1 : 1));
  if (!itens.length) { ul.innerHTML = '<li class="vazio">Nenhum lançamento neste mês.<br>Use ‹ › ou toque no nome do mês para ver outros meses.</li>'; return; }
  const sinal = (g) => (g.natureza === 'entrada' ? 1 : -1);
  let html = '';
  let diaAtual = '';
  for (const g of itens) {
    if (g.data !== diaAtual) {
      diaAtual = g.data;
      const totalDia = itens.filter((x) => x.data === g.data).reduce((s, x) => s + sinal(x) * x.valor, 0);
      const d = new Date(`${g.data}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
      html += `<li class="dia linha-entre"><span>${d.charAt(0).toUpperCase() + d.slice(1)}</span><span>${totalDia > 0 ? '+' : totalDia < 0 ? '−' : ''}${fmt(Math.abs(totalDia))}</span></li>`;
    }
    const entrada = g.natureza === 'entrada';
    html += `<li class="item" data-id="${esc(g.id)}" data-n="${g.natureza}">
      <span class="emoji" style="background:${corPessoa(g.usuario)}22">${emojiDe(g.tipo)}</span>
      <span class="info"><b>${esc(g.descricao || g.tipo)}</b>
        <small>${esc(g.tipo)} · ${esc(nomeDe(g.usuario))}${g.compartilhado ? '' : '<span class="badge">🔒 só eu</span>'}${g.origem === 'pdf' || g.origem === 'planilha' ? '<span class="badge">importado</span>' : ''}</small></span>
      <span class="valor ${entrada ? 'pos' : ''}">${entrada ? '+' : '−'}${fmt(g.valor)}</span></li>`;
  }
  ul.innerHTML = html;
  $$('li.item', ul).forEach((li) => li.addEventListener('click', () => {
    const g = itens.find((x) => x.id === li.dataset.id && x.natureza === li.dataset.n);
    if (g.meu) abrirGasto(g, g.natureza);
    else toast(`Registrado por ${nomeDe(g.usuario)} — só quem registrou pode editar.`);
  }));
}

// ---------- Formulário de lançamento (gasto ou entrada) ----------
const opcoes = (cats, sel) => Object.keys(cats).map((t) => `<option value="${t}" ${t === sel ? 'selected' : ''}>${cats[t]} ${t}</option>`).join('');

function montarFormularioGasto() {
  if (montarFormularioGasto.ok) return;
  montarFormularioGasto.ok = true;
  $('#filtro-tipo').innerHTML = `<option value="">Todos os lançamentos</option>
    <option value="__saida">💸 Só gastos</option><option value="__entrada">💰 Só entradas</option>
    <optgroup label="Gastos">${opcoes(CATS)}</optgroup><optgroup label="Entradas">${opcoes(CATS_E)}</optgroup>`;
  $('#sel-tipo').addEventListener('change', marcarRapido);
  $$('#seg-natureza button').forEach((b) => b.addEventListener('click', () => definirNatureza(b.dataset.n)));
}

function marcarRapido() {
  $$('#tipos-rapidos button').forEach((b) => b.classList.toggle('on', b.dataset.tipo === $('#sel-tipo').value));
}

function definirNatureza(natureza, tipo) {
  const f = $('#form-gasto');
  f.dataset.natureza = natureza;
  const entrada = natureza === 'entrada';
  $$('#seg-natureza button').forEach((b) => b.classList.toggle('on', b.dataset.n === natureza));
  const cats = catsDe(natureza);
  const padrao = tipo || lerLS(entrada ? 'fc_ultimo_tipo_e' : 'fc_ultimo_tipo') || (entrada ? 'Salário' : 'Mercado');
  $('#sel-tipo').innerHTML = opcoes(cats, cats[padrao] ? padrao : Object.keys(cats)[0]);
  $('#tipos-rapidos').innerHTML = (entrada ? RAPIDOS_E : RAPIDOS)
    .map((t) => `<button type="button" data-tipo="${t}">${cats[t]} ${t}</button>`).join('');
  $$('#tipos-rapidos button').forEach((b) => b.addEventListener('click', () => { $('#sel-tipo').value = b.dataset.tipo; marcarRapido(); }));
  marcarRapido();
  $('#inp-descricao').placeholder = entrada ? 'Ex.: salário de novembro' : 'Ex.: compra da semana';
  if (!f.id.value) $('#dlg-gasto-titulo').textContent = entrada ? 'Nova entrada' : 'Novo gasto';
  if (!f.id.value) {
    const comp = lerLS(entrada ? 'fc_ultimo_comp_e' : 'fc_ultimo_comp') || 'SIM';
    $$('input[name=compartilhado]', f).forEach((r) => { r.checked = r.value === comp; });
  }
}

function abrirGasto(g = null, natureza = 'saida') {
  const f = $('#form-gasto');
  f.reset();
  $('#gasto-erro').textContent = '';
  f.id.value = g?.id || '';
  f.valor.value = g ? String(g.valor.toFixed(2)).replace('.', ',') : '';
  f.data.value = g?.data || hoje();
  f.descricao.value = g?.descricao || '';
  definirNatureza(natureza, g?.tipo);
  if (g) $$('input[name=compartilhado]', f).forEach((r) => { r.checked = r.value === (g.compartilhado ? 'SIM' : 'NAO'); });
  $('#seg-natureza').classList.toggle('hidden', Boolean(g));
  if (g) $('#dlg-gasto-titulo').textContent = natureza === 'entrada' ? 'Editar entrada' : 'Editar gasto';
  $('#btn-excluir-gasto').classList.toggle('hidden', !g);
  $('#dlg-gasto').showModal();
  if (!g) setTimeout(() => f.valor.focus(), 50);
}

async function salvarGasto(ev) {
  ev.preventDefault();
  const f = ev.target;
  const natureza = f.dataset.natureza || 'saida';
  const entrada = natureza === 'entrada';
  const valor = parseValor(f.valor.value);
  if (!(valor > 0)) { $('#gasto-erro').textContent = 'Informe um valor maior que zero.'; return; }
  const body = {
    id: f.id.value || undefined,
    valor,
    tipo: f.tipo.value,
    data: f.data.value,
    descricao: f.descricao.value.trim(),
    compartilhado: $('input[name=compartilhado]:checked', f).value === 'SIM',
  };
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    await api(ENDPOINT[natureza], { method: body.id ? 'PUT' : 'POST', body });
    gravarLS(entrada ? 'fc_ultimo_tipo_e' : 'fc_ultimo_tipo', body.tipo);
    gravarLS(entrada ? 'fc_ultimo_comp_e' : 'fc_ultimo_comp', body.compartilhado ? 'SIM' : 'NAO');
    $('#dlg-gasto').close();
    toast(`${entrada ? 'Entrada' : 'Gasto'} ${body.id ? 'atualizad' : 'registrad'}${entrada ? 'a' : 'o'} ✔`);
    state.analises = {};
    state.cache = {};
    mudarMes(body.data.slice(0, 7));
    atualizarView();
  } catch (e) {
    $('#gasto-erro').textContent = e.message;
  } finally { btn.disabled = false; }
}

async function excluirGasto() {
  const f = $('#form-gasto');
  const id = f.id.value;
  const natureza = f.dataset.natureza || 'saida';
  if (!id || !confirm(`Excluir ${natureza === 'entrada' ? 'esta entrada' : 'este gasto'}?`)) return;
  try {
    await api(`${ENDPOINT[natureza]}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    $('#dlg-gasto').close();
    toast('Excluído');
    state.cache = {};
    state.analises = {};
    atualizarView();
  } catch (e) { $('#gasto-erro').textContent = e.message; }
}

// ---------- Análise com IA (Gemini) ----------
const chaveAnalise = () => `${state.mes}|${state.visao}`;

function renderCardAnalise() {
  const card = $('#card-analise');
  card.classList.toggle('hidden', !state.config?.geminiHabilitado);
  if (!state.config?.geminiHabilitado) return;
  const pronta = state.analises[chaveAnalise()];
  $('#btn-analise-atualizar').classList.toggle('hidden', !pronta);
  if (pronta) renderAnalise($('#analise-mes'), pronta);
  else {
    $('#analise-mes').innerHTML = `<p class="sub">O Gemini analisa os lançamentos de ${esc(mesLabel(state.mes).toLowerCase())} e aponta assinaturas, parcelamentos, tarifas, cobranças suspeitas e onde economizar.</p>
      <button class="btn largo" id="btn-analise-mes">Gerar análise</button>`;
    $('#btn-analise-mes').addEventListener('click', () => analisarMes());
  }
}

async function analisarMes(forcar = false) {
  const chave = chaveAnalise();
  if (state.analises[chave] && !forcar) return renderCardAnalise();
  const box = $('#analise-mes');
  box.innerHTML = '<p class="sub">✨ Analisando os lançamentos com o Gemini…</p><div class="spinner" style="margin:8px auto"></div>';
  try {
    state.analises[chave] = await api('/api/analise', { method: 'POST', body: { modo: 'mes', mes: state.mes, visao: state.visao } });
    if (chave === chaveAnalise()) renderCardAnalise();
  } catch (e) {
    box.innerHTML = `<p class="erro">${esc(e.message)}</p><button class="btn largo" id="btn-analise-mes">Tentar novamente</button>`;
    $('#btn-analise-mes').addEventListener('click', () => analisarMes(true));
  }
}

async function analisarImportacao() {
  const itens = state.importados.filter((t) => t.sel);
  const lista = itens.length ? itens : state.importados;
  const box = $('#import-analise');
  const btn = $('#btn-analise-import');
  btn.disabled = true;
  box.innerHTML = '<p class="sub">✨ Analisando o extrato com o Gemini…</p><div class="spinner" style="margin:8px auto"></div>';
  try {
    const dados = await api('/api/analise', {
      method: 'POST',
      body: {
        modo: 'importacao',
        ...state.importInfo,
        transacoes: lista.map(({ data, descricao, valor, natureza, tipo }) => ({ data, descricao, valor, natureza, tipo })),
      },
    });
    renderAnalise(box, dados);
    btn.classList.add('hidden');
  } catch (e) {
    box.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
  } finally { btn.disabled = false; }
}

function renderAnalise(el, a) {
  const icone = { alerta: '🚨', atencao: '⚠️', positivo: '✅', info: 'ℹ️' };
  const somaRec = a.recorrentes.reduce((s, r) => s + r.valor, 0);
  const somaParc = a.parcelamentos.reduce((s, p) => s + p.valor, 0);
  el.innerHTML = `
    <p class="resumo-ia">${esc(a.resumo)}</p>
    ${a.destaques.length ? `<ul class="destaques-ia">${a.destaques.map((d) => `<li class="${d.nivel}"><b>${icone[d.nivel]} ${esc(d.titulo)}</b>${esc(d.detalhe)}</li>`).join('')}</ul>` : ''}
    ${a.recorrentes.length ? `<h4>🔁 Recorrentes / assinaturas · ${fmt(somaRec)}</h4>
      <table class="tabela-ia">${a.recorrentes.map((r) => `<tr><td>${esc(r.descricao)}</td><td>${fmt(r.valor)}</td></tr>`).join('')}</table>` : ''}
    ${a.parcelamentos.length ? `<h4>💳 Parcelamentos · ${fmt(somaParc)} no período</h4>
      <table class="tabela-ia">${a.parcelamentos.map((p) => `<tr><td>${esc(p.descricao)} <span class="sub">${esc(p.parcela)}</span></td><td>${fmt(p.valor)}</td></tr>`).join('')}</table>` : ''}
    ${a.dicas.length ? `<h4>💡 Dicas</h4><ul class="dicas-ia">${a.dicas.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
    <small class="rodape-ia">Análise gerada por IA (${esc(a.modelo)}). Confira os valores antes de tomar decisões.</small>`;
}

// ---------- Metas ----------
async function renderMetas() {
  $('#ano-label').textContent = state.ano;
  const box = $('#metas-conteudo');
  try {
    state.metas = await api(`/api/metas?ano=${state.ano}`);
  } catch (e) { toast(e.message); return; }
  const m = state.metas;
  const anoAtual = Number(m.ano) === new Date().getFullYear();
  const mesesRestantes = anoAtual ? 12 - new Date().getMonth() : (Number(m.ano) > new Date().getFullYear() ? 12 : 0);
  const card = (escopo, titulo, r) => {
    const pct = r.meta ? (r.guardado / r.meta) * 100 : 0;
    const falta = Math.max(0, r.meta - r.guardado);
    const dica = r.meta && falta > 0 && mesesRestantes > 0
      ? `Faltam ${fmt(falta)} — cerca de ${fmt(falta / mesesRestantes)} por mês até dezembro.`
      : r.meta && falta === 0 ? '🎉 Meta atingida! Parabéns!' : 'Defina uma meta para acompanhar o progresso.';
    return `<div class="card meta-card">
      <h3><span>${titulo}</span><span class="sub" style="margin:0">${r.meta ? `${pct.toFixed(0)}%` : ''}</span></h3>
      <div class="meta-num"><span>Guardado<br><b>${fmt(r.guardado)}</b></span><span style="text-align:right">Meta ${m.ano}<br><b>${r.meta ? fmt(r.meta) : '—'}</b></span></div>
      <div class="progresso" role="progressbar" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${Math.min(100, pct)}%"></div></div>
      <p class="sub">${dica}</p>
      <div class="meta-acoes">
        <button class="btn" data-acao="meta" data-escopo="${escopo}">${r.meta ? 'Alterar meta' : 'Definir meta'}</button>
        <button class="btn primario" data-acao="aporte" data-escopo="${escopo}">＋ Guardar</button>
      </div>
      ${r.aportes.length ? `<ul class="aportes">${r.aportes.map((a) => `<li>
        <span>${a.data.split('-').reverse().join('/')} · ${esc(nomeDe(a.usuario))}${a.obs ? ` · ${esc(a.obs)}` : ''}</span>
        <span><b>${fmt(a.valor)}</b>${a.meu ? `<button data-del="${esc(a.id)}" aria-label="Excluir aporte">✕</button>` : ''}</span></li>`).join('')}</ul>` : ''}
    </div>`;
  };
  box.innerHTML = card('casal', '👫 Meta do casal', m.casal) + `<div style="height:12px"></div>` + card('individual', `🙋 Minha meta (${esc(state.user.nome)})`, m.individual);
  $$('[data-acao]', box).forEach((b) => b.addEventListener('click', () => abrirMeta(b.dataset.acao, b.dataset.escopo)));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Excluir este valor guardado?')) return;
    try { await api(`/api/metas?id=${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); toast('Excluído'); renderMetas(); } catch (e) { toast(e.message); }
  }));
}

function abrirMeta(acao, escopo) {
  const f = $('#form-meta');
  f.reset();
  $('#meta-erro').textContent = '';
  f.acao.value = acao;
  f.escopo.value = escopo;
  f.data.value = hoje();
  const r = escopo === 'casal' ? state.metas.casal : state.metas.individual;
  if (acao === 'meta' && r.meta) f.valor.value = String(r.meta.toFixed(2)).replace('.', ',');
  $$('.so-aporte', f).forEach((el) => el.classList.toggle('hidden', acao !== 'aporte'));
  $('#dlg-meta-titulo').textContent = acao === 'meta'
    ? `Meta ${escopo === 'casal' ? 'do casal' : 'individual'} para ${state.ano}`
    : `Guardar dinheiro (${escopo === 'casal' ? 'casal' : 'individual'})`;
  $('#dlg-meta').showModal();
  setTimeout(() => f.valor.focus(), 50);
}

async function salvarMeta(ev) {
  ev.preventDefault();
  const f = ev.target;
  const valor = parseValor(f.valor.value);
  if (!(valor > 0)) { $('#meta-erro').textContent = 'Informe um valor maior que zero.'; return; }
  try {
    await api('/api/metas', {
      method: 'POST',
      body: { acao: f.acao.value, escopo: f.escopo.value, valor, ano: state.ano, data: f.data.value, obs: f.obs.value.trim() },
    });
    $('#dlg-meta').close();
    toast(f.acao.value === 'meta' ? 'Meta salva ✔' : 'Valor guardado ✔ 💰');
    state.metas = null;
    renderMetas();
  } catch (e) { $('#meta-erro').textContent = e.message; }
}

// ---------- Importação de extrato / fatura (PDF, CSV, XLS, XLSX) ----------
function lerBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const ehPdf = (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
const ehCsv = (file) => /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv';

async function importarPdf(file) {
  if (!file) return;
  const status = $('#import-status');
  $('#import-revisao').classList.add('hidden');
  const pdf = ehPdf(file);
  status.textContent = state.config.iaHabilitada ? '🤖 Lendo o arquivo com IA… isso pode levar até 1 minuto.' : '📄 Lendo o arquivo…';
  carregando(true);
  let resultado;
  try {
    // Planilhas viram uma tabela (linhas × colunas) antes de qualquer coisa
    const linhas = pdf ? null : await lerPlanilha(file);
    if (linhas && !linhas.length) throw new Error('A planilha está vazia.');
    const local = () => (pdf ? lerPdfLocal(file) : interpretarTabela(linhas));
    if (state.config.iaHabilitada) {
      try {
        const body = pdf
          ? { pdf: await lerBase64(file) }
          : { texto: linhas.map((l) => l.map((c) => String(c).replace(/\|/g, '/')).join(' | ')).join('\n'), nome: file.name };
        resultado = await api('/api/importar', { method: 'POST', body });
        resultado.metodo = 'ia';
      } catch (e) {
        if (e.status === 501 || e.status === 413 || e.status >= 500) {
          status.textContent = `IA indisponível (${e.message}). Usando leitura local…`;
          resultado = await local();
        } else throw e;
      }
    } else {
      resultado = await local();
    }
  } catch (e) {
    status.textContent = `❌ ${e.message}`;
    carregando(false);
    return;
  }

  state.importInfo = { tipoDocumento: resultado.tipoDocumento, vencimento: resultado.vencimento, banco: resultado.banco, nomeArquivo: file.name };
  $('#import-analise').innerHTML = '';
  $('#btn-analise-import').classList.remove('hidden');
  state.importados = resultado.transacoes.map((t) => ({
    ...t, natureza: t.natureza === 'entrada' ? 'entrada' : 'saida', origem: pdf ? 'pdf' : 'planilha',
  }));

  // Fatura de cartão: por padrão tudo vai para o mês de vencimento
  const fatura = resultado.tipoDocumento === 'fatura_cartao';
  let venc = resultado.vencimento || '';
  let palpite = false;
  if (fatura && !venc) {
    const m = file.name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
    if (m) venc = `${m[1]}-${m[2]}-${m[3]}`;
    else if (state.importados.length) {
      venc = `${deslocarMes(state.importados.map((t) => t.data).sort().pop().slice(0, 7), 1)}-10`;
      palpite = true;
    }
  }
  $('#import-usar-venc').checked = fatura;
  $('#import-venc').value = venc;
  $('#import-venc-aviso').textContent = palpite ? '⚠️ Vencimento estimado — confira a data da sua fatura.' : '';
  state.cache = {};
  await avaliarImportados();
  carregando(false);

  if (!state.importados.length) {
    status.textContent = 'Nenhum lançamento encontrado neste arquivo.';
    return;
  }
  const qtd = (n) => state.importados.filter((t) => t.natureza === n).length;
  status.textContent = `✅ ${qtd('saida')} gastos e ${qtd('entrada')} entradas encontrados${resultado.banco ? ` · ${resultado.banco}` : ''}${resultado.metodo === 'local' ? ' · leitura local, confira os tipos' : ''}.`;
  renderImportados();
}

function renderImportados() {
  $('#import-lista').innerHTML = state.importados.map((t, i) => `<li data-i="${i}" class="${t.natureza === 'entrada' ? 'entrada' : ''}">
    <input type="checkbox" data-k="sel" ${t.sel ? 'checked' : ''} aria-label="Selecionar">
    <div class="campos">
      <input type="text" class="desc" data-k="descricao" value="${esc(t.descricao)}" aria-label="Descrição">
      <input type="date" data-k="data" value="${t.data}" aria-label="Data">
      <input inputmode="decimal" data-k="valor" value="${t.valor.toFixed(2).replace('.', ',')}" aria-label="Valor">
      <select data-k="natureza" aria-label="Gasto ou entrada">
        <option value="saida" ${t.natureza === 'saida' ? 'selected' : ''}>💸 Gasto</option>
        <option value="entrada" ${t.natureza === 'entrada' ? 'selected' : ''}>💰 Entrada</option>
      </select>
      <select data-k="tipo" aria-label="Tipo">${opcoes(catsDe(t.natureza), t.tipo)}</select>
      ${t.dup ? '<small class="erro desc" style="margin:0">⚠️ Possível duplicado (já existe lançamento com mesmo valor)</small>' : ''}
      ${t.mover ? `<small class="sub desc" style="margin:0">↪️ Já importado em ${t.mover.data.split('-').reverse().join('/')} — será movido para o vencimento</small>` : ''}
    </div></li>`).join('');
  $('#import-titulo').textContent = `Revise os lançamentos (${state.importados.length})`;
  $('#import-analise-box').classList.toggle('hidden', !state.config.geminiHabilitado);
  atualizarResumoImport();
  $('#import-revisao').classList.remove('hidden');
}

function faturaAtiva() {
  const venc = $('#import-venc').value;
  $('#import-venc-campo').classList.toggle('hidden', !$('#import-usar-venc').checked);
  return { ativo: $('#import-usar-venc').checked && /^\d{4}-\d{2}-\d{2}$/.test(venc), venc };
}

const dataCurta = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const descricaoFatura = (t) => (/\(compra \d{2}\/\d{2}\)/.test(t.descricao) ? t.descricao : `${t.descricao} (compra ${dataCurta(t.data)})`);

// Compara com o que já está salvo: marca duplicados e, no modo fatura, lançamentos já
// importados na data da compra (que serão movidos para o vencimento em vez de duplicados).
async function avaliarImportados() {
  const f = faturaAtiva();
  const meses = new Set(state.importados.map((t) => t.data.slice(0, 7)));
  if (f.ativo) meses.add(f.venc.slice(0, 7));
  const dados = await Promise.all([...meses].map((m) => dadosDoMes(m).catch(() => ({ gastos: [], entradas: [] }))));
  const existentes = dados.flatMap((d) => [...d.gastos, ...d.entradas]).filter((g) => g.meu);
  const usados = new Set();
  const achar = (t, cond) => {
    const g = existentes.find((x) => !usados.has(x.natureza + x.id) && x.natureza === t.natureza && Math.abs(x.valor - t.valor) < 0.01 && cond(x));
    if (g) usados.add(g.natureza + g.id);
    return g;
  };
  for (const t of state.importados) {
    t.dup = false;
    t.mover = null;
    if (f.ativo) {
      const prefixo = t.descricao.slice(0, 12);
      if (achar(t, (x) => x.data === f.venc && (x.descricao || '').startsWith(prefixo))) t.dup = true;
      else t.mover = achar(t, (x) => x.data === t.data && x.origem !== 'manual') || null;
    } else if (achar(t, (x) => x.data === t.data)) t.dup = true;
    t.sel = !t.dup;
  }
}

function atualizarResumoImport() {
  const sel = state.importados.filter((t) => t.sel);
  const soma = (n) => sel.filter((t) => t.natureza === n).reduce((s, t) => s + (t.valor || 0), 0);
  $('#import-resumo').textContent = `Selecionados: ${sel.length} · gastos ${fmt(soma('saida'))} · entradas ${fmt(soma('entrada'))}`;
}

async function salvarImportados() {
  const sel = state.importados.filter((t) => t.sel);
  if (!sel.length) { toast('Selecione ao menos um lançamento.'); return; }
  if (sel.some((t) => !(t.valor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(t.data))) { toast('Há lançamentos com valor ou data inválidos.'); return; }
  const f = faturaAtiva();
  if ($('#import-usar-venc').checked && !f.ativo) { toast('Informe a data de vencimento da fatura.'); return; }
  const comp = { saida: $('#import-compartilhar').checked, entrada: $('#import-compartilhar-ent').checked };
  // No modo fatura, a data passa a ser o vencimento e a data da compra vai para a descrição
  const final = (t) => (f.ativo ? { ...t, data: f.venc, descricao: descricaoFatura(t) } : t);
  const btn = $('#btn-salvar-import');
  btn.disabled = true;
  carregando(true);
  try {
    let movidos = 0;
    for (const natureza of ['saida', 'entrada']) {
      const daNatureza = sel.filter((t) => t.natureza === natureza).map(final);
      const novos = daNatureza.filter((t) => !t.mover)
        .map(({ data, valor, tipo, descricao, origem }) => ({ data, valor, tipo, descricao, origem, compartilhado: comp[natureza] }));
      const mover = daNatureza.filter((t) => t.mover)
        .map(({ data, valor, tipo, descricao, mover: g }) => ({ id: g.id, data, valor, tipo, descricao, compartilhado: g.compartilhado }));
      if (novos.length) await api(ENDPOINT[natureza], { method: 'POST', body: { itens: novos } });
      if (mover.length) await api(ENDPOINT[natureza], { method: 'PUT', body: { itens: mover } });
      movidos += mover.length;
    }
    const mesesImp = [...new Set(sel.map((t) => final(t).data.slice(0, 7)))].sort();
    toast(`${sel.length} lançamentos salvos em ${mesesImp.map((m) => mesLabel(m).toLowerCase()).join(', ')}${movidos ? ` (${movidos} movidos para o vencimento)` : ''} ✔`);
    state.importados = [];
    state.cache = {};
    state.analises = {};
    $('#import-revisao').classList.add('hidden');
    $('#import-status').textContent = '';
    $('#input-pdf').value = '';
    mudarMes(mesesImp[mesesImp.length - 1]);
    irPara('inicio');
  } catch (e) { toast(e.message); } finally { btn.disabled = false; carregando(false); }
}

// ----- Leitura local (sem IA) -----
const PALAVRAS = [
  ['iFood', /ifood|ifd\*|rappi|z[eé] delivery|aiqfome|james delivery/i],
  ['Mercado', /mercad|supermerc|atacad|assa[ií]|carrefour|p[aã]o de a[cç]|zaffari|angeloni|hortifr|sacol[aã]o|a[cç]ougue|big ?bom|condor|savegnago|muffato|giassi|bistek|cooper|nacional|dia\s?%?brasil/i],
  ['Farmácia', /farm|drog|raia|pacheco|panvel|pague ?menos|nissei|droga/i],
  ['Padaria', /padar|panific|confeit|p[aã]es|bakery/i],
  ['Restaurante', /restaur|lanch|pizz|burger|bar |churrasc|sushi|cafe|caf[eé]|outback|mc ?donald|bk |subway|habib/i],
  ['Transporte', /uber|99 ?app|99pop|cabify|estacion|pedag|sem parar|conectcar|veloe|metr[oô]|[oô]nibus|bilhete|passagem/i],
  ['Combustível', /posto|combust|shell|ipiranga|petrobras|br mania|ale /i],
  ['Contas da casa', /energia|enel|cemig|copel|celesc|light|sabesp|[aá]gua|saneam|g[aá]s|comg[aá]s|internet|vivo|claro|tim |oi |net |condom|aluguel|iptu/i],
  ['Assinaturas', /netflix|spotify|amazon prime|prime video|disney|hbo|max\.com|globoplay|youtube|apple\.com|icloud|google|deezer|paramount|chatgpt|openai|anthropic|claude/i],
  ['Saúde', /hospital|cl[ií]nica|laborat|m[eé]dic|odonto|dent|unimed|amil|academia|smart ?fit|bluefit|psic/i],
  ['Lazer', /cinema|cinemark|ingresso|sympla|hotel|airbnb|booking|decolar|latam|gol |azul |show|teatro|parque/i],
  ['Compras', /amazon|mercado ?livre|mercadolivre|shopee|magalu|magazine|americanas|renner|riachuelo|c&a|zara|centauro|netshoes|shein|aliexpress|kabum|leroy|loja/i],
];
const PALAVRAS_E = [
  ['Salário', /sal[aá]rio|folha|pagto sal|pr[oó][- ]?labore|proventos|vencimentos|adiant/i],
  ['Rendimentos', /rendimento|juros|dividend|remunera[cç][aã]o/i],
  ['Pix recebido', /pix/i],
  ['Depósito', /dep[oó]sito|dep\.?\s|deposito/i],
  ['Transferência', /ted|doc|transf/i],
];
// Linhas que não são lançamentos (saldos, totais, pagamento da fatura, investimentos)
const IGNORAR = /saldo|^total|total (da|de|geral)|pagamento (efetuado|recebido|da fatura)|pagto fatura|pagamento fatura|limite|aplica[cç][aã]o|resgate|invest/i;
const PARECE_ENTRADA = /sal[aá]rio|recebid|dep[oó]sito|cr[eé]dito em conta|estorno|reembolso|rendimento|proventos|ted recebida|pix recebido|transfer[eê]ncia recebida/i;

function categorizar(desc, natureza = 'saida') {
  for (const [cat, re] of natureza === 'entrada' ? PALAVRAS_E : PALAVRAS) if (re.test(desc)) return cat;
  return natureza === 'entrada' ? 'Outras entradas' : 'Outros';
}

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Não foi possível carregar o leitor de arquivos. Verifique a internet.'));
    document.head.appendChild(s);
  });
}

async function carregarPdfJs() {
  if (!window.pdfjsLib) {
    await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  return window.pdfjsLib;
}

// Converte texto/célula em número no formato brasileiro ou internacional
function numeroBR(v) {
  if (typeof v === 'number') return v;
  let t = String(v ?? '').trim();
  if (!t) return NaN;
  let neg = /^-|-$|^\(.*\)$|\bD$/i.test(t);
  t = t.replace(/[R$\s()]/g, '').replace(/[DC]$/i, '').replace(/^-|-$/g, '');
  if (!/^[\d.,]+$/.test(t)) return NaN;
  if (t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

// Converte célula de data (Date, número serial do Excel ou texto) em AAAA-MM-DD
function dataISO(v, anoPadrao) {
  if (v instanceof Date && !Number.isNaN(v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) { // serial do Excel
    const d = new Date(Math.round((v - 25569) * 864e5));
    return d.toISOString().slice(0, 10);
  }
  const t = String(v ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  const ano = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : anoPadrao;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Lê CSV (com detecção de separador e codificação) ou XLS/XLSX/ODS → matriz de células
async function lerPlanilha(file) {
  const buf = await file.arrayBuffer();
  if (ehCsv(file)) {
    let texto;
    try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { texto = new TextDecoder('windows-1252').decode(buf); }
    return parseCsv(texto.replace(/^﻿/, ''));
  }
  if (!window.XLSX) await carregarScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
  const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
  const linhas = [];
  for (const nome of wb.SheetNames) {
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '', blankrows: false });
    linhas.push(...rows);
  }
  return linhas.filter((l) => l.some((c) => String(c).trim() !== ''));
}

function parseCsv(texto) {
  const amostra = texto.split(/\r?\n/).slice(0, 20).join('\n');
  const sep = [';', ',', '\t', '|'].map((c) => [c, amostra.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some((x) => x.trim())) linhas.push(linha.map((x) => x.trim()));
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim())) linhas.push(linha.map((x) => x.trim()));
  return linhas;
}

// Identifica colunas (data, descrição, valor ou débito/crédito) e monta os lançamentos
function interpretarTabela(linhas) {
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let iCab = linhas.findIndex((l) => l.some((c) => /^data|date/.test(norm(c))) && l.some((c) => /valor|debito|credito|amount|quantia|montante/.test(norm(c))));
  let col = {};
  if (iCab >= 0) {
    const cab = linhas[iCab].map(norm);
    const achar = (re, exceto) => cab.findIndex((c) => re.test(c) && !(exceto && exceto.test(c)));
    col = {
      data: achar(/^data|date/),
      desc: achar(/descri|historico|lancamento|estabelecimento|title|titulo|memo|detalhe|identificacao/),
      valor: achar(/valor|amount|quantia|montante/, /saldo|dolar|us\$|usd/),
      debito: achar(/debito|saida/),
      credito: achar(/credito|entrada/),
    };
  } else {
    // Sem cabeçalho: deduz pelas primeiras linhas (data, texto mais longo, último número)
    iCab = -1;
    const exemplo = linhas.find((l) => l.some((c) => dataISO(c, 2000)) && l.some((c) => !Number.isNaN(numeroBR(c))));
    if (!exemplo) throw new Error('Não encontrei colunas de data e valor na planilha.');
    col.data = exemplo.findIndex((c) => dataISO(c, 2000));
    col.valor = exemplo.map((c, i) => [c, i]).filter(([c, i]) => i !== col.data && !Number.isNaN(numeroBR(c))).map(([, i]) => i)[0];
    col.desc = exemplo.map((c, i) => [String(c), i]).filter(([, i]) => i !== col.data && i !== col.valor).sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? -1;
    col.debito = -1;
    col.credito = -1;
  }
  if (col.data < 0 || (col.valor < 0 && col.debito < 0 && col.credito < 0)) throw new Error('Não encontrei colunas de data e valor na planilha.');

  const anoAtual = new Date().getFullYear();
  const brutos = [];
  for (const l of linhas.slice(iCab + 1)) {
    const data = dataISO(l[col.data], anoAtual);
    if (!data) continue;
    const descricao = String(col.desc >= 0 ? l[col.desc] : l.filter((_, i) => i !== col.data && i !== col.valor).join(' ')).replace(/\s+/g, ' ').trim();
    let valor;
    let natureza = null;
    if (col.debito >= 0 || col.credito >= 0) {
      const deb = col.debito >= 0 ? numeroBR(l[col.debito]) : NaN;
      const cre = col.credito >= 0 ? numeroBR(l[col.credito]) : NaN;
      if (!Number.isNaN(deb) && deb !== 0) { valor = Math.abs(deb); natureza = 'saida'; }
      else if (!Number.isNaN(cre) && cre !== 0) { valor = Math.abs(cre); natureza = 'entrada'; }
      else if (col.valor >= 0) valor = numeroBR(l[col.valor]);
    } else valor = numeroBR(l[col.valor]);
    if (!Number.isFinite(valor) || valor === 0 || IGNORAR.test(descricao)) continue;
    brutos.push({ data, descricao: descricao.slice(0, 120), valor, natureza });
  }
  // Coluna única de valor: o sinal define a natureza. Em extratos, negativos = gastos;
  // em faturas de cartão (maioria positiva), positivos = compras e negativos = estornos/créditos.
  const semNat = brutos.filter((b) => !b.natureza);
  const negativos = semNat.filter((b) => b.valor < 0).length;
  const ehFatura = negativos < semNat.length / 2;
  for (const b of semNat) {
    if (ehFatura) b.natureza = b.valor < 0 || PARECE_ENTRADA.test(b.descricao) ? 'entrada' : 'saida';
    else b.natureza = b.valor < 0 ? 'saida' : 'entrada';
  }
  const transacoes = brutos.map((b) => ({
    data: b.data, descricao: b.descricao, valor: Math.round(Math.abs(b.valor) * 100) / 100,
    natureza: b.natureza, tipo: categorizar(b.descricao, b.natureza),
  }));
  const tipoDocumento = semNat.length && ehFatura ? 'fatura_cartao' : 'extrato_bancario';
  return { banco: '', tipoDocumento, vencimento: '', transacoes, metodo: 'local' };
}

async function lerPdfLocal(file) {
  const pdfjs = await carregarPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const linhas = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { items } = await page.getTextContent();
    const porY = new Map();
    for (const it of items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!porY.has(y)) porY.set(y, []);
      porY.get(y).push(it);
    }
    [...porY.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => {
      linhas.push(its.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim());
    });
  }
  const texto = linhas.join('\n');
  const anoDoc = Number((texto.match(/\b(20\d{2})\b/) || [])[1]) || new Date().getFullYear();
  const reData = /\b(\d{2})[/.-](\d{2})(?:[/.-](\d{2,4}))?\b/;
  const reValor = /(-\s?)?(?:R\$\s?)?(\d{1,3}(?:\.\d{3})*,\d{2})(\s?-|\s?[DC]\b)?/g;
  const temSaldo = /saldo/i.test(texto);
  const candidatos = [];
  for (const linha of linhas) {
    const md = linha.match(reData);
    if (!md) continue;
    const valores = [...linha.matchAll(reValor)];
    if (!valores.length) continue;
    const usado = valores.length > 1 && temSaldo ? valores[valores.length - 2] : valores[valores.length - 1]; // ignora coluna de saldo
    const negativo = Boolean(usado[1] || /-|D/.test(usado[3] || ''));
    const credito = /C/.test(usado[3] || '');
    const valor = Number(usado[2].replace(/\./g, '').replace(',', '.'));
    const descricao = linha.replace(md[0], '').replace(reValor, '').replace(/\s+/g, ' ').trim();
    if (!valor || IGNORAR.test(descricao) || descricao.length < 2) continue;
    const dia = Number(md[1]);
    const mes = Number(md[2]);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) continue;
    let ano = md[3] ? Number(md[3].length === 2 ? `20${md[3]}` : md[3]) : anoDoc;
    if (!md[3] && mes > new Date().getMonth() + 1 && ano === new Date().getFullYear()) ano -= 1;
    candidatos.push({
      data: `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
      descricao: descricao.slice(0, 120), valor, negativo, credito,
    });
  }
  // Extratos: débitos costumam vir negativos (ou com "D"); se houver os dois sinais, positivos são entradas.
  const temSinais = candidatos.some((c) => c.negativo) && candidatos.some((c) => !c.negativo);
  const transacoes = candidatos.map((c) => {
    const natureza = c.credito || (temSinais ? !c.negativo : PARECE_ENTRADA.test(c.descricao)) ? 'entrada' : 'saida';
    return { data: c.data, descricao: c.descricao, valor: c.valor, natureza, tipo: categorizar(c.descricao, natureza) };
  });
  const fatura = /fatura|cart[aã]o de cr[eé]dito|limite (total|dispon)/i.test(texto);
  const mv = texto.match(/venc[a-z]*\D{0,25}(\d{2})[/.-](\d{2})[/.-](\d{2,4})/i);
  const vencimento = fatura && mv ? `${mv[3].length === 2 ? `20${mv[3]}` : mv[3]}-${mv[2]}-${mv[1]}` : '';
  return { banco: '', tipoDocumento: fatura ? 'fatura_cartao' : 'extrato_bancario', vencimento, transacoes, metodo: 'local' };
}

// ---------- Eventos ----------
function ligarEventos() {
  $$('.nav button').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.view)));
  $('#fab').addEventListener('click', () => abrirGasto());
  $('#btn-nova-entrada').addEventListener('click', () => abrirGasto(null, 'entrada'));
  $('#btn-analise-mes').addEventListener('click', () => analisarMes());
  $('#btn-analise-atualizar').addEventListener('click', () => analisarMes(true));
  $('#btn-analise-import').addEventListener('click', analisarImportacao);
  $('#btn-sair').addEventListener('click', () => { if (confirm('Sair do aplicativo?')) sair(); });
  $$('[data-mes]').forEach((b) => b.addEventListener('click', () => { mudarMes(deslocarMes(state.mes, Number(b.dataset.mes))); atualizarView(); }));
  // Tocar no nome do mês abre um seletor para pular direto para qualquer mês
  $$('.mes-nav .mes-label').forEach((el) => el.addEventListener('click', () => {
    const inp = $('#inp-mes');
    inp.value = state.mes;
    try { inp.showPicker(); } catch {
      const m = prompt('Ir para o mês (AAAA-MM):', state.mes);
      if (m) { mudarMes(m.trim()); atualizarView(); }
    }
  }));
  $('#inp-mes').addEventListener('change', (e) => { if (e.target.value) { mudarMes(e.target.value); atualizarView(); } });
  $$('[data-ano]').forEach((b) => b.addEventListener('click', () => { state.ano += Number(b.dataset.ano); state.metas = null; renderMetas(); }));
  $$('#filtro-visao button').forEach((b) => b.addEventListener('click', () => {
    state.visao = b.dataset.v;
    gravarLS('fc_visao', state.visao);
    $$('#filtro-visao button').forEach((x) => x.classList.toggle('on', x === b));
    renderInicio();
  }));
  $('#filtro-tipo').addEventListener('change', renderLista);
  $('#form-gasto').addEventListener('submit', salvarGasto);
  $('#btn-excluir-gasto').addEventListener('click', excluirGasto);
  $('#form-meta').addEventListener('submit', salvarMeta);
  $$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  $('#input-pdf').addEventListener('change', (e) => importarPdf(e.target.files[0]));
  $('#import-lista').addEventListener('input', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const t = state.importados[Number(li.dataset.i)];
    const k = e.target.dataset.k;
    if (k === 'sel') t.sel = e.target.checked;
    else if (k === 'valor') t.valor = parseValor(e.target.value);
    else if (k === 'natureza') {
      t.natureza = e.target.value;
      t.tipo = categorizar(t.descricao, t.natureza);
      li.classList.toggle('entrada', t.natureza === 'entrada');
      $('select[data-k=tipo]', li).innerHTML = opcoes(catsDe(t.natureza), t.tipo);
    } else t[k] = e.target.value;
    atualizarResumoImport();
  });
  $('#import-todos').addEventListener('change', (e) => {
    state.importados.forEach((t) => { t.sel = e.target.checked; });
    $$('#import-lista input[data-k=sel]').forEach((c) => { c.checked = e.target.checked; });
    atualizarResumoImport();
  });
  $('#btn-salvar-import').addEventListener('click', salvarImportados);
  const reavaliar = async () => { await avaliarImportados(); renderImportados(); };
  $('#import-usar-venc').addEventListener('change', reavaliar);
  $('#import-venc').addEventListener('change', () => { $('#import-venc-aviso').textContent = ''; reavaliar(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.view === 'inicio' && renderInicio());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user) { state.cache = {}; state.metas = null; atualizarView(); }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

ligarEventos();
iniciar();
