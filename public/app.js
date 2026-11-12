// Finanças do Casal — frontend (PWA, JS puro)

// ---------- Constantes ----------
const CATS = {
  'Mercado': '🛒', 'Farmácia': '💊', 'Padaria': '🥖', 'iFood': '🛵', 'Restaurante': '🍽️',
  'Transporte': '🚗', 'Combustível': '⛽', 'Contas da casa': '🏠', 'Saúde': '🩺',
  'Lazer': '🎉', 'Compras': '🛍️', 'Assinaturas': '📺', 'Outros': '📦',
};
const RAPIDOS = ['Mercado', 'Farmácia', 'Padaria', 'iFood'];
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
  mes: hoje().slice(0, 7),
  ano: new Date().getFullYear(),
  visao: lerLS('fc_visao') || 'todos',
  view: 'inicio',
  cache: {},          // mes -> gastos[]
  metas: null,
  charts: {},
  importados: [],
};

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
}

// ---------- Navegação ----------
const TITULOS = { inicio: 'Início', gastos: 'Gastos', metas: 'Metas do ano', importar: 'Importar PDF' };
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

async function gastosDoMes(mes, forcar = false) {
  if (!state.cache[mes] || forcar) {
    const { gastos } = await api(`/api/gastos?mes=${mes}`);
    state.cache[mes] = gastos;
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
    [atual, anterior] = await Promise.all([gastosDoMes(state.mes), gastosDoMes(deslocarMes(state.mes, -1))]);
  } catch (e) { toast(e.message); return; }
  if (state.view !== 'inicio') return;
  const g = filtrarVisao(atual);
  const gAnt = filtrarVisao(anterior);
  const total = g.reduce((s, x) => s + x.valor, 0);
  const totalAnt = gAnt.reduce((s, x) => s + x.valor, 0);

  $('#total-mes').textContent = fmt(total);
  if (totalAnt > 0) {
    const pct = ((total - totalAnt) / totalAnt) * 100;
    $('#comparativo').textContent = `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% vs mês anterior (${fmt(totalAnt)})`;
  } else {
    $('#comparativo').textContent = `${g.length} gasto${g.length === 1 ? '' : 's'} no mês`;
  }

  // Por pessoa
  const porPessoa = state.user.usuarios.map((u) => ({
    ...u, total: g.filter((x) => x.usuario === u.email).reduce((s, x) => s + x.valor, 0),
  }));
  $('#cards-pessoas').innerHTML = `<small class="sub" style="margin:0">Por pessoa</small>${porPessoa.map((p) => `
    <div class="pessoa-linha"><span><i class="dot" style="background:${corPessoa(p.email)}"></i>${esc(p.nome)}</span><b>${fmt(p.total)}</b></div>`).join('')}
    <div class="pessoa-linha sub"><span>Compartilhados</span><b>${fmt(g.filter((x) => x.compartilhado).reduce((s, x) => s + x.valor, 0))}</b></div>`;

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
}

function desenhar(nome, canvas, config) {
  state.charts[nome]?.destroy();
  delete state.charts[nome];
  const box = canvas.parentElement;
  box.querySelector('.vazio')?.remove();
  if (!config) {
    canvas.classList.add('hidden');
    box.insertAdjacentHTML('beforeend', '<p class="vazio">Nenhum gasto neste período.</p>');
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
  let gastos;
  try { gastos = await gastosDoMes(state.mes); } catch (e) { toast(e.message); return; }
  const tipo = $('#filtro-tipo').value;
  gastos = filtrarVisao(gastos).filter((g) => !tipo || g.tipo === tipo);
  if (!gastos.length) { ul.innerHTML = '<li class="vazio">Nenhum gasto encontrado.<br>Toque em ＋ para registrar.</li>'; return; }
  let html = '';
  let diaAtual = '';
  for (const g of gastos) {
    if (g.data !== diaAtual) {
      diaAtual = g.data;
      const totalDia = gastos.filter((x) => x.data === g.data).reduce((s, x) => s + x.valor, 0);
      const d = new Date(`${g.data}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
      html += `<li class="dia linha-entre"><span>${d}</span><span>${fmt(totalDia)}</span></li>`;
    }
    html += `<li class="item" data-id="${esc(g.id)}">
      <span class="emoji" style="background:${corPessoa(g.usuario)}22">${CATS[g.tipo] || '📦'}</span>
      <span class="info"><b>${esc(g.descricao || g.tipo)}</b>
        <small>${esc(g.tipo)} · ${esc(nomeDe(g.usuario))}${g.compartilhado ? '' : '<span class="badge">🔒 só eu</span>'}${g.origem === 'pdf' ? '<span class="badge">PDF</span>' : ''}</small></span>
      <span class="valor">${fmt(g.valor)}</span></li>`;
  }
  ul.innerHTML = html;
  $$('li.item', ul).forEach((li) => li.addEventListener('click', () => {
    const g = gastos.find((x) => x.id === li.dataset.id);
    if (g.meu) abrirGasto(g);
    else toast(`Registrado por ${nomeDe(g.usuario)} — só quem registrou pode editar.`);
  }));
}

// ---------- Formulário de gasto ----------
function montarFormularioGasto() {
  if (montarFormularioGasto.ok) return;
  montarFormularioGasto.ok = true;
  const opts = Object.keys(CATS).map((t) => `<option value="${t}">${CATS[t]} ${t}</option>`).join('');
  $('#sel-tipo').innerHTML = opts;
  $('#filtro-tipo').insertAdjacentHTML('beforeend', opts);
  $('#tipos-rapidos').innerHTML = RAPIDOS.map((t) => `<button type="button" data-tipo="${t}">${CATS[t]} ${t}</button>`).join('');
  const marcarRapido = () => $$('#tipos-rapidos button').forEach((b) => b.classList.toggle('on', b.dataset.tipo === $('#sel-tipo').value));
  $$('#tipos-rapidos button').forEach((b) => b.addEventListener('click', () => { $('#sel-tipo').value = b.dataset.tipo; marcarRapido(); }));
  $('#sel-tipo').addEventListener('change', marcarRapido);
  abrirGasto.marcarRapido = marcarRapido;
}

function abrirGasto(g = null) {
  const f = $('#form-gasto');
  f.reset();
  $('#gasto-erro').textContent = '';
  f.id.value = g?.id || '';
  f.valor.value = g ? String(g.valor.toFixed(2)).replace('.', ',') : '';
  f.tipo.value = g?.tipo || lerLS('fc_ultimo_tipo') || 'Mercado';
  f.data.value = g?.data || hoje();
  f.descricao.value = g?.descricao || '';
  const comp = g ? (g.compartilhado ? 'SIM' : 'NAO') : (lerLS('fc_ultimo_comp') || 'SIM');
  $$('input[name=compartilhado]', f).forEach((r) => { r.checked = r.value === comp; });
  $('#dlg-gasto-titulo').textContent = g ? 'Editar gasto' : 'Novo gasto';
  $('#btn-excluir-gasto').classList.toggle('hidden', !g);
  abrirGasto.marcarRapido?.();
  $('#dlg-gasto').showModal();
  if (!g) setTimeout(() => f.valor.focus(), 50);
}

async function salvarGasto(ev) {
  ev.preventDefault();
  const f = ev.target;
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
    await api('/api/gastos', { method: body.id ? 'PUT' : 'POST', body });
    gravarLS('fc_ultimo_tipo', body.tipo);
    gravarLS('fc_ultimo_comp', body.compartilhado ? 'SIM' : 'NAO');
    $('#dlg-gasto').close();
    toast(body.id ? 'Gasto atualizado ✔' : 'Gasto registrado ✔');
    state.cache = {};
    state.mes = body.data.slice(0, 7);
    atualizarView();
  } catch (e) {
    $('#gasto-erro').textContent = e.message;
  } finally { btn.disabled = false; }
}

async function excluirGasto() {
  const id = $('#form-gasto').id.value;
  if (!id || !confirm('Excluir este gasto?')) return;
  try {
    await api(`/api/gastos?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    $('#dlg-gasto').close();
    toast('Gasto excluído');
    state.cache = {};
    atualizarView();
  } catch (e) { $('#gasto-erro').textContent = e.message; }
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

// ---------- Importação de PDF ----------
function lerBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function importarPdf(file) {
  if (!file) return;
  const status = $('#import-status');
  $('#import-revisao').classList.add('hidden');
  status.textContent = state.config.iaHabilitada ? '🤖 Lendo o documento com IA… isso pode levar até 1 minuto.' : '📄 Lendo o documento…';
  carregando(true);
  let resultado;
  try {
    if (state.config.iaHabilitada) {
      try {
        resultado = await api('/api/importar', { method: 'POST', body: { pdf: await lerBase64(file) } });
      } catch (e) {
        if (e.status === 501 || e.status === 413 || e.status >= 500) {
          status.textContent = `IA indisponível (${e.message}). Usando leitura local…`;
          resultado = await lerPdfLocal(file);
        } else throw e;
      }
    } else {
      resultado = await lerPdfLocal(file);
    }
  } catch (e) {
    status.textContent = `❌ ${e.message}`;
    carregando(false);
    return;
  }

  // Marca possíveis duplicados (mesma data e valor já registrados por mim)
  const meses = [...new Set(resultado.transacoes.map((t) => t.data.slice(0, 7)))];
  const existentes = (await Promise.all(meses.map((m) => gastosDoMes(m, true).catch(() => [])))).flat().filter((g) => g.meu);
  state.importados = resultado.transacoes.map((t) => {
    const dup = existentes.some((g) => g.data === t.data && Math.abs(g.valor - t.valor) < 0.01);
    return { ...t, dup, sel: !dup };
  });
  carregando(false);

  if (!state.importados.length) {
    status.textContent = 'Nenhum gasto encontrado neste PDF.';
    return;
  }
  const total = state.importados.reduce((s, t) => s + t.valor, 0);
  status.textContent = `✅ ${state.importados.length} gastos encontrados (${fmt(total)})${resultado.banco ? ` · ${resultado.banco}` : ''}${resultado.metodo === 'local' ? ' · leitura local, confira os tipos' : ''}.`;
  renderImportados();
}

function renderImportados() {
  const opts = (sel) => Object.keys(CATS).map((t) => `<option value="${t}" ${t === sel ? 'selected' : ''}>${CATS[t]} ${t}</option>`).join('');
  $('#import-lista').innerHTML = state.importados.map((t, i) => `<li data-i="${i}">
    <input type="checkbox" data-k="sel" ${t.sel ? 'checked' : ''} aria-label="Selecionar">
    <div class="campos">
      <input type="text" class="desc" data-k="descricao" value="${esc(t.descricao)}" aria-label="Descrição">
      <input type="date" data-k="data" value="${t.data}" aria-label="Data">
      <input inputmode="decimal" data-k="valor" value="${t.valor.toFixed(2).replace('.', ',')}" aria-label="Valor">
      <select data-k="tipo" class="desc" aria-label="Tipo">${opts(t.tipo)}</select>
      ${t.dup ? '<small class="erro desc" style="margin:0">⚠️ Possível duplicado (já existe gasto com mesma data e valor)</small>' : ''}
    </div></li>`).join('');
  $('#import-titulo').textContent = `Revise os gastos (${state.importados.length})`;
  $('#import-revisao').classList.remove('hidden');
}

async function salvarImportados() {
  const compartilhado = $('#import-compartilhar').checked;
  const lista = state.importados.filter((t) => t.sel).map((t) => ({ ...t, compartilhado, origem: 'pdf' }));
  if (!lista.length) { toast('Selecione ao menos um gasto.'); return; }
  if (lista.some((t) => !(t.valor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(t.data))) { toast('Há gastos com valor ou data inválidos.'); return; }
  const btn = $('#btn-salvar-import');
  btn.disabled = true;
  carregando(true);
  try {
    await api('/api/gastos', { method: 'POST', body: { gastos: lista.map(({ data, valor, tipo, descricao, compartilhado: c, origem }) => ({ data, valor, tipo, descricao, compartilhado: c, origem })) } });
    toast(`${lista.length} gastos importados ✔`);
    state.importados = [];
    state.cache = {};
    $('#import-revisao').classList.add('hidden');
    $('#import-status').textContent = '';
    $('#input-pdf').value = '';
    state.mes = lista.map((t) => t.data).sort().pop().slice(0, 7);
    irPara('inicio');
  } catch (e) { toast(e.message); } finally { btn.disabled = false; carregando(false); }
}

// Leitura local (sem IA): extrai o texto do PDF com pdf.js e procura linhas com data + valor.
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
const IGNORAR = /saldo|total|pagamento (efetuado|recebido)|pagto fatura|pagamento fatura|estorno|cr[eé]dito|recebid|sal[aá]rio|rendimento|resgate|aplica[cç][aã]o|transf(er[eê]ncia)? (entre|mesma)|limite|juros sobre saldo|ted recebida|pix recebido|dep[oó]sito/i;

function categorizar(desc) {
  for (const [cat, re] of PALAVRAS) if (re.test(desc)) return cat;
  return 'Outros';
}

async function carregarPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Não foi possível carregar o leitor de PDF.'));
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return window.pdfjsLib;
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
  const reValor = /(-\s?)?(?:R\$\s?)?(\d{1,3}(?:\.\d{3})*,\d{2})(\s?-|\s?D\b)?/g;
  const candidatos = [];
  for (const linha of linhas) {
    const md = linha.match(reData);
    if (!md) continue;
    const valores = [...linha.matchAll(reValor)];
    if (!valores.length) continue;
    const v = valores[valores.length > 1 ? valores.length - 2 : 0]; // ignora coluna de saldo, se houver
    const usado = valores.length > 1 && /saldo/i.test(texto) ? v : valores[valores.length - 1];
    const negativo = Boolean(usado[1] || usado[3]);
    const valor = Number(usado[2].replace(/\./g, '').replace(',', '.'));
    let descricao = linha.replace(md[0], '').replace(usado[0], '').replace(reValor, '').replace(/\s+/g, ' ').trim();
    if (!valor || IGNORAR.test(descricao) || descricao.length < 2) continue;
    const dia = Number(md[1]);
    const mes = Number(md[2]);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) continue;
    let ano = md[3] ? Number(md[3].length === 2 ? `20${md[3]}` : md[3]) : anoDoc;
    if (!md[3] && mes > new Date().getMonth() + 1 && ano === new Date().getFullYear()) ano -= 1;
    candidatos.push({
      data: `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
      descricao: descricao.slice(0, 120),
      valor,
      negativo,
      tipo: categorizar(descricao),
    });
  }
  // Em extratos, débitos costumam vir com sinal negativo: se houver negativos, usa só eles.
  const temNegativos = candidatos.some((c) => c.negativo) && candidatos.some((c) => !c.negativo);
  const transacoes = candidatos.filter((c) => !temNegativos || c.negativo).map(({ negativo, ...c }) => c);
  return { banco: '', transacoes, metodo: 'local' };
}

// ---------- Eventos ----------
function ligarEventos() {
  $$('.nav button').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.view)));
  $('#fab').addEventListener('click', () => abrirGasto());
  $('#btn-sair').addEventListener('click', () => { if (confirm('Sair do aplicativo?')) sair(); });
  $$('[data-mes]').forEach((b) => b.addEventListener('click', () => { state.mes = deslocarMes(state.mes, Number(b.dataset.mes)); atualizarView(); }));
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
    else t[k] = e.target.value;
  });
  $('#import-todos').addEventListener('change', (e) => {
    state.importados.forEach((t) => { t.sel = e.target.checked; });
    $$('#import-lista input[data-k=sel]').forEach((c) => { c.checked = e.target.checked; });
  });
  $('#btn-salvar-import').addEventListener('click', salvarImportados);
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
