const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => crypto.randomUUID();
const clone = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const LOCAL_PLAYERS = 'arena_maker_v2_players';
const LOCAL_TOURNAMENTS = 'arena_maker_v2_tournaments';
const PLAYER_COLORS = ['#7c5cff', '#2dd4a8', '#38bdf8', '#fb7185', '#fbbf24', '#a78bfa', '#f97316', '#22c55e'];

const state = {
  config: null,
  supabase: null,
  session: null,
  user: null,
  localMode: true,
  players: [],
  tournaments: [],
  view: 'dashboard',
  activeTournamentId: null,
  tournamentTab: 'overview',
  playerSearch: '',
  zipPayload: null,
  wizard: null
};

const viewMeta = {
  dashboard: ['PAINEL', 'Visão geral'],
  players: ['CADASTRO', 'Jogadores'],
  tournaments: ['COMPETIÇÕES', 'Campeonatos'],
  importer: ['PUBLICAÇÃO', 'Publicar ZIP no GitHub']
};

const formatName = (format) => ({ league: 'Liga', knockout: 'Mata-mata', mixed: 'Misto' }[format] || format);
const modeName = (mode) => mode === 'teams' ? 'Equipes' : 'Individual';
const playerById = (id) => state.players.find((player) => player.id === id);
const tournamentById = (id) => state.tournaments.find((tournament) => tournament.id === id);
const participantName = (tournament, id) => tournament.participants.find((item) => item.id === id)?.name || 'A definir';

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'J';
}

function avatarHtml(player, sizeClass = '') {
  const style = `--player-color:${escapeHtml(player?.color || PLAYER_COLORS[0])}`;
  if (player?.avatar_url) {
    return `<div class="avatar ${sizeClass}" style="${style}"><img src="${escapeHtml(player.avatar_url)}" alt=""></div>`;
  }
  return `<div class="avatar ${sizeClass}" style="${style}">${escapeHtml(initials(player?.name))}</div>`;
}

function toast(message, type = '') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('#toastRoot').append(item);
  window.setTimeout(() => item.remove(), 3400);
}

function openModal(content, size = '') {
  $('#modalRoot').innerHTML = `<div class="modal-backdrop" data-modal-backdrop><div class="modal ${size}">${content}</div></div>`;
  $('[data-modal-backdrop]').addEventListener('click', (event) => {
    if (event.target.matches('[data-modal-backdrop]')) closeModal();
  });
}

function closeModal() {
  $('#modalRoot').innerHTML = '';
}

async function loadPublicConfig() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Configuração indisponível');
    return await response.json();
  } catch {
    return { supabaseConfigured: false, githubImporterConfigured: false };
  }
}

async function init() {
  state.config = await loadPublicConfig();
  bindStaticEvents();

  if (state.config.supabaseConfigured && window.supabase?.createClient) {
    state.supabase = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data } = await state.supabase.auth.getSession();
    state.session = data.session;
    state.user = data.session?.user || null;

    state.supabase.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      state.user = session?.user || null;
      if (session) await enterCloudMode();
    });
  }

  if (state.session) await enterCloudMode();
  else showAuth();
}

function bindStaticEvents() {
  $('#loginForm').addEventListener('submit', loginWithMagicLink);
  $('#continueLocalBtn').addEventListener('click', enterLocalMode);
  $('#logoutBtn').addEventListener('click', logout);
  $('#newPlayerQuickBtn').addEventListener('click', () => openPlayerModal());
  $('#newTournamentBtn').addEventListener('click', openTournamentWizard);

  $$('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
}

function showAuth() {
  $('#authScreen').classList.remove('hidden');
  $('#appShell').classList.add('hidden');
  if (!state.config.supabaseConfigured) {
    $('#authMessage').textContent = 'Supabase ainda não configurado. Você pode usar o modo local e conectar depois.';
  }
}

async function loginWithMagicLink(event) {
  event.preventDefault();
  if (!state.supabase) {
    $('#authMessage').textContent = 'Configure as variáveis do Supabase no Vercel antes de entrar.';
    return;
  }
  const email = $('#loginEmail').value.trim();
  $('#authMessage').textContent = 'Enviando link...';
  const { error } = await state.supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  });
  $('#authMessage').textContent = error ? error.message : 'Link enviado. Abra seu e-mail para entrar.';
}

async function enterCloudMode() {
  state.localMode = false;
  $('#authScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  $('#logoutBtn').classList.remove('hidden');
  setSyncStatus(true);
  await loadCloudData();
  renderAll();
}

function enterLocalMode() {
  state.localMode = true;
  state.user = null;
  state.session = null;
  $('#authScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  $('#logoutBtn').classList.add('hidden');
  setSyncStatus(false);
  loadLocalData();
  renderAll();
}

async function logout() {
  if (state.supabase) await state.supabase.auth.signOut();
  state.session = null;
  state.user = null;
  state.players = [];
  state.tournaments = [];
  showAuth();
}

function setSyncStatus(online) {
  const card = $('#syncStatus');
  card.innerHTML = `
    <span class="status-dot ${online ? 'online' : ''}"></span>
    <div><strong>${online ? 'Supabase conectado' : 'Modo local'}</strong><span>${online ? 'Sincronização ativa' : 'Dados neste navegador'}</span></div>`;
}

function loadLocalData() {
  try { state.players = JSON.parse(localStorage.getItem(LOCAL_PLAYERS) || '[]'); } catch { state.players = []; }
  try { state.tournaments = JSON.parse(localStorage.getItem(LOCAL_TOURNAMENTS) || '[]'); } catch { state.tournaments = []; }
}

function saveLocalData() {
  localStorage.setItem(LOCAL_PLAYERS, JSON.stringify(state.players));
  localStorage.setItem(LOCAL_TOURNAMENTS, JSON.stringify(state.tournaments));
}

async function loadCloudData() {
  const [playersResult, tournamentsResult] = await Promise.all([
    state.supabase.from('players').select('*').order('created_at', { ascending: true }),
    state.supabase.from('tournaments').select('*').order('created_at', { ascending: false })
  ]);
  if (playersResult.error) toast(playersResult.error.message, 'error');
  if (tournamentsResult.error) toast(tournamentsResult.error.message, 'error');
  state.players = playersResult.data || [];
  state.tournaments = (tournamentsResult.data || []).map((row) => ({ ...row.state, id: row.id }));
}

async function persistPlayer(player) {
  const index = state.players.findIndex((item) => item.id === player.id);
  if (index >= 0) state.players[index] = player;
  else state.players.push(player);

  if (state.localMode) {
    saveLocalData();
  } else {
    const payload = { ...player, owner_id: state.user.id, updated_at: now() };
    const { error } = await state.supabase.from('players').upsert(payload);
    if (error) throw error;
  }
  renderAll();
}

async function removePlayer(id) {
  state.players = state.players.filter((player) => player.id !== id);
  if (state.localMode) saveLocalData();
  else {
    const { error } = await state.supabase.from('players').delete().eq('id', id);
    if (error) throw error;
  }
  renderAll();
}

async function persistTournament(tournament) {
  tournament.updatedAt = now();
  const index = state.tournaments.findIndex((item) => item.id === tournament.id);
  if (index >= 0) state.tournaments[index] = tournament;
  else state.tournaments.unshift(tournament);

  if (state.localMode) {
    saveLocalData();
  } else {
    const payload = {
      id: tournament.id,
      owner_id: state.user.id,
      name: tournament.name,
      game: tournament.game,
      mode: tournament.mode,
      format: tournament.format,
      status: tournament.championId ? 'finished' : 'active',
      state: tournament,
      updated_at: now()
    };
    const { error } = await state.supabase.from('tournaments').upsert(payload);
    if (error) throw error;
  }
  renderAll();
}

async function removeTournament(id) {
  state.tournaments = state.tournaments.filter((tournament) => tournament.id !== id);
  if (state.localMode) saveLocalData();
  else {
    const { error } = await state.supabase.from('tournaments').delete().eq('id', id);
    if (error) throw error;
  }
  closeModal();
  renderAll();
}

function navigate(view) {
  state.view = view;
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $('#viewEyebrow').textContent = viewMeta[view][0];
  $('#viewTitle').textContent = viewMeta[view][1];
  renderView(view);
}

function renderAll() {
  renderView('dashboard');
  renderView('players');
  renderView('tournaments');
  renderView('importer');
}

function renderView(view) {
  if (view === 'dashboard') renderDashboard();
  if (view === 'players') renderPlayers();
  if (view === 'tournaments') renderTournaments();
  if (view === 'importer') renderImporter();
}

function aggregatePlayerStats() {
  const map = new Map(state.players.map((player) => [player.id, { player, pj: 0, v: 0, e: 0, d: 0, titles: 0, mvps: 0, pts: 0 }]));
  for (const tournament of state.tournaments) {
    for (const row of individualStats(tournament)) {
      if (!map.has(row.id)) continue;
      const item = map.get(row.id);
      item.pj += row.pj; item.v += row.v; item.e += row.e; item.d += row.d; item.mvps += row.mvps; item.pts += row.pts;
    }
    if (tournament.championId) {
      const champion = tournament.participants.find((participant) => participant.id === tournament.championId);
      const ids = tournament.mode === 'individual' ? [champion?.linkedPlayerId] : (champion?.members || []).map((member) => member.id);
      ids.filter(Boolean).forEach((id) => { if (map.has(id)) map.get(id).titles += 1; });
    }
  }
  return [...map.values()].sort((a, b) => b.titles - a.titles || b.pts - a.pts || b.v - a.v || a.player.name.localeCompare(b.player.name));
}

function renderDashboard() {
  const finished = state.tournaments.filter((tournament) => tournament.championId).length;
  const matches = state.tournaments.reduce((sum, tournament) => sum + tournament.matches.filter((match) => match.played && !match.isBye).length, 0);
  const ranking = aggregatePlayerStats();
  const recent = [...state.tournaments].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5);

  $('#view-dashboard').innerHTML = `
    <div class="grid cols-4">
      ${kpiCard('Jogadores ativos', state.players.length, '◉', 'Cadastro permanente')}
      ${kpiCard('Campeonatos', state.tournaments.length, '◇', `${finished} finalizados`)}
      ${kpiCard('Partidas registradas', matches, '▤', 'Histórico consolidado')}
      ${kpiCard('Maior campeão', ranking[0]?.player.name || '—', '⌁', ranking[0] ? `${ranking[0].titles} título(s)` : 'Sem resultados')}
    </div>

    <div class="grid cols-2" style="margin-top:16px;">
      <div class="card">
        <div class="card-head"><div><h2>Campeonatos recentes</h2><p class="muted">Continue de onde parou</p></div></div>
        <div class="card-body">
          ${recent.length ? `<div class="tournament-list">${recent.map(tournamentRowHtml).join('')}</div>` : emptyHtml('◇', 'Nenhum campeonato criado', 'Cadastre os jogadores e monte sua primeira competição.', 'Criar campeonato', 'data-create-tournament')}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Ranking geral</h2><p class="muted">Resultados somados entre campeonatos</p></div></div>
        <div class="card-body">
          ${ranking.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Jogador</th><th class="num">Títulos</th><th class="num">J</th><th class="num">V</th><th class="num">MVP</th></tr></thead><tbody>${ranking.slice(0, 8).map((row, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(row.player.name)}</strong></td><td class="num">${row.titles}</td><td class="num">${row.pj}</td><td class="num">${row.v}</td><td class="num">${row.mvps}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><p>Os rankings aparecerão conforme os resultados forem registrados.</p></div>`}
        </div>
      </div>
    </div>`;

  bindDynamicCommon($('#view-dashboard'));
}

function kpiCard(label, value, icon, detail) {
  return `<div class="card kpi"><div class="kpi-top"><span>${escapeHtml(label)}</span><span class="kpi-icon">${icon}</span></div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`;
}

function emptyHtml(icon, title, text, buttonText = '', buttonAttr = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${buttonText ? `<button class="button primary" ${buttonAttr}>${escapeHtml(buttonText)}</button>` : ''}</div>`;
}

function renderPlayers() {
  const query = state.playerSearch.toLowerCase();
  const players = state.players.filter((player) => `${player.name} ${player.nickname || ''}`.toLowerCase().includes(query));
  $('#view-players').innerHTML = `
    <div class="toolbar">
      <div class="search"><input id="playerSearch" type="search" placeholder="Buscar jogador..." value="${escapeHtml(state.playerSearch)}"></div>
      <button class="button primary" data-new-player>Adicionar jogador</button>
    </div>
    ${players.length ? `<div class="player-grid">${players.map(playerCardHtml).join('')}</div>` : emptyHtml('◉', 'Nenhum jogador encontrado', state.players.length ? 'Tente outro nome na busca.' : 'Crie uma lista permanente de jogadores. Depois, basta selecionar quem participará.', 'Adicionar jogador', 'data-new-player')}`;

  $('#playerSearch')?.addEventListener('input', (event) => {
    state.playerSearch = event.target.value;
    renderPlayers();
    $('#playerSearch')?.focus();
  });
  $$('[data-new-player]', $('#view-players')).forEach((button) => button.addEventListener('click', () => openPlayerModal()));
  $$('[data-edit-player]', $('#view-players')).forEach((button) => button.addEventListener('click', () => openPlayerModal(button.dataset.editPlayer)));
  $$('[data-delete-player]', $('#view-players')).forEach((button) => button.addEventListener('click', async () => {
    const player = playerById(button.dataset.deletePlayer);
    if (!confirm(`Excluir ${player?.name}? Os campeonatos antigos manterão o nome salvo.`)) return;
    try { await removePlayer(button.dataset.deletePlayer); toast('Jogador excluído.'); } catch (error) { toast(error.message, 'error'); }
  }));
}

function playerCardHtml(player) {
  const stats = aggregatePlayerStats().find((row) => row.player.id === player.id);
  return `<article class="card player-card" style="--player-color:${escapeHtml(player.color)}">
    <div class="player-main">${avatarHtml(player)}<div class="player-copy"><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.nickname || 'Sem apelido')}</span></div></div>
    <div class="tournament-meta"><span class="badge">${stats?.pj || 0} jogos</span><span class="badge">${stats?.v || 0} vitórias</span><span class="badge">${stats?.titles || 0} títulos</span></div>
    <div class="player-actions"><button class="button small secondary" data-edit-player="${player.id}">Editar</button><button class="button small ghost" data-delete-player="${player.id}">Excluir</button></div>
  </article>`;
}

function openPlayerModal(playerId = null) {
  const current = playerId ? playerById(playerId) : null;
  const color = current?.color || PLAYER_COLORS[state.players.length % PLAYER_COLORS.length];
  openModal(`
    <div class="modal-head"><h2>${current ? 'Editar jogador' : 'Novo jogador'}</h2><button class="icon-button" data-close>×</button></div>
    <form id="playerForm">
      <div class="modal-body stack">
        <label class="field"><span>Nome do jogador</span><input id="playerName" value="${escapeHtml(current?.name || '')}" placeholder="Ex.: Milton" required></label>
        <div class="grid cols-2">
          <label class="field"><span>Apelido ou ID no jogo</span><input id="playerNickname" value="${escapeHtml(current?.nickname || '')}" placeholder="Ex.: Figueiredo97"></label>
          <label class="field"><span>Cor de identificação</span><input id="playerColor" type="color" value="${escapeHtml(color)}"></label>
        </div>
        <label class="field"><span>URL da foto (opcional)</span><input id="playerAvatar" type="url" value="${escapeHtml(current?.avatar_url || '')}" placeholder="https://..."></label>
      </div>
      <div class="modal-foot"><button class="button ghost" type="button" data-close>Cancelar</button><button class="button primary" type="submit">Salvar jogador</button></div>
    </form>`, 'medium');

  $$('[data-close]', $('#modalRoot')).forEach((button) => button.addEventListener('click', closeModal));
  $('#playerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#playerName').value.trim();
    if (!name) return;
    const player = {
      id: current?.id || uid(),
      name,
      nickname: $('#playerNickname').value.trim(),
      color: $('#playerColor').value,
      avatar_url: $('#playerAvatar').value.trim(),
      active: true,
      created_at: current?.created_at || now(),
      updated_at: now()
    };
    try { await persistPlayer(player); closeModal(); toast('Jogador salvo.'); } catch (error) { toast(error.message, 'error'); }
  });
}

function renderTournaments() {
  const tournaments = [...state.tournaments].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  $('#view-tournaments').innerHTML = `
    <div class="toolbar"><div class="muted">${tournaments.length} campeonato(s) salvo(s)</div><button class="button primary" data-create-tournament>Novo campeonato</button></div>
    ${tournaments.length ? `<div class="tournament-list">${tournaments.map(tournamentRowHtml).join('')}</div>` : emptyHtml('◇', 'Sua arena ainda está vazia', 'Crie campeonatos de qualquer tamanho usando os jogadores cadastrados.', 'Criar campeonato', 'data-create-tournament')}`;
  bindDynamicCommon($('#view-tournaments'));
}

function tournamentRowHtml(tournament) {
  const played = tournament.matches.filter((match) => match.played && !match.isBye).length;
  const total = tournament.matches.filter((match) => !match.isBye).length;
  return `<article class="card tournament-row">
    <div><strong>${escapeHtml(tournament.name)}</strong><div class="tournament-meta"><span class="badge">${escapeHtml(tournament.game)}</span><span class="badge">${formatName(tournament.format)}</span><span class="badge">${modeName(tournament.mode)}</span><span class="badge ${tournament.championId ? 'done' : 'live'}">${tournament.championId ? 'Finalizado' : `${played}/${total} jogos`}</span></div></div>
    <div class="row-actions"><button class="button small secondary" data-open-tournament="${tournament.id}">Abrir</button></div>
  </article>`;
}

function bindDynamicCommon(root) {
  $$('[data-create-tournament]', root).forEach((button) => button.addEventListener('click', openTournamentWizard));
  $$('[data-open-tournament]', root).forEach((button) => button.addEventListener('click', () => openTournament(button.dataset.openTournament)));
}

function openTournamentWizard() {
  if (state.players.length < 2) {
    toast('Cadastre pelo menos dois jogadores primeiro.', 'error');
    openPlayerModal();
    return;
  }
  state.wizard = {
    step: 1,
    name: '', game: '', usageLabel: 'Escolha usada', mode: 'individual', format: 'league',
    selectedPlayerIds: [], teamCount: 2, teamAssignments: {}, teamNames: {},
    leagueLegs: 1, thirdPlace: true, groupCount: 2, qualifiers: 1, groupLegs: 1
  };
  renderWizard();
}

function renderWizard() {
  const wizard = state.wizard;
  openModal(`
    <div class="modal-head"><div><span class="eyebrow">NOVO CAMPEONATO</span><h2>Configurar competição</h2></div><button class="icon-button" data-close>×</button></div>
    <div class="modal-body">
      <div class="stepper"><div class="step ${wizard.step === 1 ? 'active' : ''}">1. Informações</div><div class="step ${wizard.step === 2 ? 'active' : ''}">2. Jogadores</div><div class="step ${wizard.step === 3 ? 'active' : ''}">3. Formato</div></div>
      <div id="wizardContent">${wizard.step === 1 ? wizardStepOne() : wizard.step === 2 ? wizardStepTwo() : wizardStepThree()}</div>
    </div>
    <div class="modal-foot"><button class="button ghost" data-wizard-back ${wizard.step === 1 ? 'disabled' : ''}>Voltar</button><button class="button primary" data-wizard-next>${wizard.step === 3 ? 'Criar campeonato' : 'Continuar'}</button></div>`);

  $('[data-close]').addEventListener('click', closeModal);
  $('[data-wizard-back]').addEventListener('click', () => { saveWizardScreen(); state.wizard.step -= 1; renderWizard(); });
  $('[data-wizard-next]').addEventListener('click', async () => {
    try {
      saveWizardScreen();
      validateWizardStep();
      if (wizard.step < 3) { wizard.step += 1; prepareWizardStep(); renderWizard(); }
      else await finishWizard();
    } catch (error) { toast(error.message, 'error'); }
  });
  bindWizardScreen();
}

function wizardStepOne() {
  const wizard = state.wizard;
  return `<div class="stack">
    <div class="grid cols-2">
      <label class="field"><span>Nome do campeonato</span><input id="wName" value="${escapeHtml(wizard.name)}" placeholder="Ex.: Copa de Sábado #12"></label>
      <label class="field"><span>Jogo</span><input id="wGame" value="${escapeHtml(wizard.game)}" placeholder="Ex.: League of Legends, EA FC 26"></label>
    </div>
    <label class="field"><span>Nome do dado extra por participante</span><input id="wUsageLabel" value="${escapeHtml(wizard.usageLabel)}" placeholder="Campeão usado, time escolhido..."></label>
    <div><span class="muted" style="font-size:.78rem;">Modo de disputa</span><div class="choice-grid" style="grid-template-columns:repeat(2,minmax(0,1fr)); margin-top:8px;">
      ${choiceRadio('wMode', 'individual', 'Individual', 'Cada jogador disputa e pontua por conta própria.', wizard.mode)}
      ${choiceRadio('wMode', 'teams', 'Equipes', 'O resultado vale para o time, mas as estatísticas são individuais.', wizard.mode)}
    </div></div>
  </div>`;
}

function choiceRadio(name, value, title, description, current) {
  return `<label class="choice ${current === value ? 'selected' : ''}"><input type="radio" name="${name}" value="${value}" ${current === value ? 'checked' : ''}><strong>${title}</strong><span>${description}</span></label>`;
}

function wizardStepTwo() {
  const wizard = state.wizard;
  return `<div class="stack">
    <div><h3 style="margin:0 0 5px;">Selecione quem vai jogar</h3><p class="muted" style="margin:0; font-size:.82rem;">${wizard.selectedPlayerIds.length} jogador(es) selecionado(s). A quantidade pode mudar em cada campeonato.</p></div>
    <div class="inline-create"><input id="quickPlayerName" placeholder="Adicionar um novo jogador sem sair daqui"><button class="button secondary" data-quick-add-player>Adicionar</button></div>
    <div class="select-player-grid">${state.players.map((player) => {
      const selected = wizard.selectedPlayerIds.includes(player.id);
      return `<label class="select-player ${selected ? 'selected' : ''}"><input type="checkbox" value="${player.id}" ${selected ? 'checked' : ''}>${avatarHtml(player)}<div class="player-copy"><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.nickname || '')}</span></div></label>`;
    }).join('')}</div>
  </div>`;
}

function wizardStepThree() {
  const wizard = state.wizard;
  return `<div class="stack">
    <div><span class="muted" style="font-size:.78rem;">Formato do campeonato</span><div class="choice-grid" style="margin-top:8px;">
      ${choiceRadio('wFormat', 'league', 'Liga', 'Todos contra todos com classificação.', wizard.format)}
      ${choiceRadio('wFormat', 'knockout', 'Mata-mata', 'Chave automática com folgas quando necessário.', wizard.format)}
      ${choiceRadio('wFormat', 'mixed', 'Misto', 'Fase de grupos seguida por mata-mata.', wizard.format)}
    </div></div>
    <div id="formatOptions">${formatOptionsHtml()}</div>
    ${wizard.mode === 'teams' ? teamBuilderHtml() : ''}
  </div>`;
}

function formatOptionsHtml() {
  const wizard = state.wizard;
  if (wizard.format === 'league') return `<div class="grid cols-2"><label class="field"><span>Turnos</span><select id="wLeagueLegs"><option value="1" ${wizard.leagueLegs === 1 ? 'selected' : ''}>Turno único</option><option value="2" ${wizard.leagueLegs === 2 ? 'selected' : ''}>Ida e volta</option></select></label></div>`;
  if (wizard.format === 'knockout') return `<label class="choice selected"><input id="wThirdPlace" type="checkbox" ${wizard.thirdPlace ? 'checked' : ''}><strong>Disputa de 3º lugar</strong><span>Cria a partida automaticamente a partir das semifinais.</span></label>`;
  return `<div class="grid cols-3"><label class="field"><span>Quantidade de grupos</span><input id="wGroupCount" type="number" min="1" max="${wizard.selectedPlayerIds.length}" value="${wizard.groupCount}"></label><label class="field"><span>Classificados por grupo</span><input id="wQualifiers" type="number" min="1" value="${wizard.qualifiers}"></label><label class="field"><span>Turnos nos grupos</span><select id="wGroupLegs"><option value="1" ${wizard.groupLegs === 1 ? 'selected' : ''}>Turno único</option><option value="2" ${wizard.groupLegs === 2 ? 'selected' : ''}>Ida e volta</option></select></label></div><label class="choice selected"><input id="wThirdPlace" type="checkbox" ${wizard.thirdPlace ? 'checked' : ''}><strong>Disputa de 3º lugar</strong><span>Será criada no mata-mata final.</span></label>`;
}

function teamBuilderHtml() {
  const wizard = state.wizard;
  const selected = wizard.selectedPlayerIds.map(playerById).filter(Boolean);
  return `<div class="card card-pad">
    <div class="toolbar" style="margin-bottom:12px;"><div><h3 style="margin:0 0 4px;">Montagem das equipes</h3><div class="muted" style="font-size:.78rem;">Cada jogador deve estar em uma equipe.</div></div><div style="display:flex; gap:8px;"><input id="wTeamCount" type="number" min="2" max="${Math.max(2, selected.length)}" value="${wizard.teamCount}" style="width:84px;"><button class="button small secondary" data-shuffle-teams>Sortear equipes</button></div></div>
    <div class="assign-list">${selected.map((player) => `<div class="assign-row"><div class="player-main">${avatarHtml(player)}<strong>${escapeHtml(player.name)}</strong></div><select data-team-assignment="${player.id}">${Array.from({ length: wizard.teamCount }, (_, index) => `<option value="${index}" ${Number(wizard.teamAssignments[player.id]) === index ? 'selected' : ''}>${escapeHtml(wizard.teamNames[index] || `Equipe ${index + 1}`)}</option>`).join('')}</select></div>`).join('')}</div>
    <div class="grid cols-2" style="margin-top:14px;">${Array.from({ length: wizard.teamCount }, (_, index) => `<label class="field"><span>Nome da equipe ${index + 1}</span><input data-team-name="${index}" value="${escapeHtml(wizard.teamNames[index] || `Equipe ${index + 1}`)}"></label>`).join('')}</div>
  </div>`;
}

function bindWizardScreen() {
  $$('.choice input', $('#modalRoot')).forEach((input) => input.addEventListener('change', () => {
    $$('.choice', input.closest('.choice-grid') || input.parentElement.parentElement).forEach((choice) => choice.classList.remove('selected'));
    input.closest('.choice')?.classList.add('selected');
    if (input.name === 'wFormat') { state.wizard.format = input.value; $('#formatOptions').innerHTML = formatOptionsHtml(); bindWizardScreen(); }
  }));

  $$('input[type="checkbox"]', $('#wizardContent')).forEach((input) => {
    if (input.closest('.select-player')) input.addEventListener('change', () => input.closest('.select-player').classList.toggle('selected', input.checked));
  });

  $('[data-quick-add-player]')?.addEventListener('click', async () => {
    const name = $('#quickPlayerName').value.trim();
    if (!name) return;
    const player = { id: uid(), name, nickname: '', color: PLAYER_COLORS[state.players.length % PLAYER_COLORS.length], avatar_url: '', active: true, created_at: now(), updated_at: now() };
    try { await persistPlayer(player); state.wizard.selectedPlayerIds.push(player.id); renderWizard(); } catch (error) { toast(error.message, 'error'); }
  });

  $('[data-shuffle-teams]')?.addEventListener('click', () => {
    saveWizardScreen();
    const shuffled = shuffle(state.wizard.selectedPlayerIds);
    shuffled.forEach((id, index) => { state.wizard.teamAssignments[id] = index % state.wizard.teamCount; });
    renderWizard();
  });

  $('#wTeamCount')?.addEventListener('change', () => {
    saveWizardScreen();
    state.wizard.teamCount = Math.max(2, Math.min(Number($('#wTeamCount').value) || 2, state.wizard.selectedPlayerIds.length));
    normalizeTeamAssignments();
    renderWizard();
  });
}

function saveWizardScreen() {
  const wizard = state.wizard;
  if (wizard.step === 1) {
    wizard.name = $('#wName')?.value.trim() || wizard.name;
    wizard.game = $('#wGame')?.value.trim() || wizard.game;
    wizard.usageLabel = $('#wUsageLabel')?.value.trim() || 'Escolha usada';
    wizard.mode = $('input[name="wMode"]:checked')?.value || wizard.mode;
  } else if (wizard.step === 2) {
    wizard.selectedPlayerIds = $$('input[type="checkbox"]:checked', $('#wizardContent')).map((input) => input.value);
  } else {
    wizard.format = $('input[name="wFormat"]:checked')?.value || wizard.format;
    wizard.leagueLegs = Number($('#wLeagueLegs')?.value || wizard.leagueLegs);
    wizard.thirdPlace = $('#wThirdPlace')?.checked ?? wizard.thirdPlace;
    wizard.groupCount = Number($('#wGroupCount')?.value || wizard.groupCount);
    wizard.qualifiers = Number($('#wQualifiers')?.value || wizard.qualifiers);
    wizard.groupLegs = Number($('#wGroupLegs')?.value || wizard.groupLegs);
    if (wizard.mode === 'teams') {
      wizard.teamCount = Number($('#wTeamCount')?.value || wizard.teamCount);
      $$('[data-team-assignment]', $('#wizardContent')).forEach((select) => { wizard.teamAssignments[select.dataset.teamAssignment] = Number(select.value); });
      $$('[data-team-name]', $('#wizardContent')).forEach((input) => { wizard.teamNames[input.dataset.teamName] = input.value.trim() || `Equipe ${Number(input.dataset.teamName) + 1}`; });
    }
  }
}

function validateWizardStep() {
  const wizard = state.wizard;
  if (wizard.step === 1) {
    if (!wizard.name) throw new Error('Informe o nome do campeonato.');
    if (!wizard.game) throw new Error('Informe o jogo.');
  }
  if (wizard.step === 2 && wizard.selectedPlayerIds.length < 2) throw new Error('Selecione pelo menos dois jogadores.');
  if (wizard.step === 3) {
    const participantCount = wizard.mode === 'teams' ? wizard.teamCount : wizard.selectedPlayerIds.length;
    if (participantCount < 2) throw new Error('É necessário ter pelo menos dois participantes ou equipes.');
    if (wizard.format === 'mixed') {
      if (wizard.groupCount < 1 || wizard.groupCount > participantCount) throw new Error('Quantidade de grupos inválida.');
      const smallestGroup = Math.floor(participantCount / wizard.groupCount);
      if (wizard.qualifiers < 1 || wizard.qualifiers > smallestGroup) throw new Error(`Cada grupo terá pelo menos ${smallestGroup} participante(s). Ajuste os classificados.`);
    }
    if (wizard.mode === 'teams') {
      const counts = Array.from({ length: wizard.teamCount }, () => 0);
      wizard.selectedPlayerIds.forEach((id) => counts[Number(wizard.teamAssignments[id])]++);
      if (counts.some((count) => count === 0)) throw new Error('Todas as equipes precisam ter pelo menos um jogador.');
    }
  }
}

function prepareWizardStep() {
  const wizard = state.wizard;
  if (wizard.step === 3 && wizard.mode === 'teams') {
    wizard.teamCount = Math.min(Math.max(2, wizard.teamCount), wizard.selectedPlayerIds.length);
    normalizeTeamAssignments();
  }
}

function normalizeTeamAssignments() {
  const wizard = state.wizard;
  wizard.selectedPlayerIds.forEach((id, index) => {
    if (!Number.isInteger(wizard.teamAssignments[id]) || wizard.teamAssignments[id] >= wizard.teamCount) wizard.teamAssignments[id] = index % wizard.teamCount;
  });
  for (let index = 0; index < wizard.teamCount; index++) if (!wizard.teamNames[index]) wizard.teamNames[index] = `Equipe ${index + 1}`;
}

async function finishWizard() {
  const wizard = state.wizard;
  const participants = wizard.mode === 'individual'
    ? wizard.selectedPlayerIds.map((id) => { const player = playerById(id); return { id: uid(), linkedPlayerId: id, name: player.name, members: [] }; })
    : Array.from({ length: wizard.teamCount }, (_, index) => ({
        id: uid(), name: wizard.teamNames[index] || `Equipe ${index + 1}`,
        members: wizard.selectedPlayerIds.filter((id) => Number(wizard.teamAssignments[id]) === index).map((id) => ({ id, name: playerById(id).name }))
      }));

  const tournament = buildTournament({
    name: wizard.name, game: wizard.game, mode: wizard.mode, format: wizard.format, participants,
    settings: { usageLabel: wizard.usageLabel, leagueLegs: wizard.leagueLegs, thirdPlace: wizard.thirdPlace, groupCount: wizard.groupCount, qualifiers: wizard.qualifiers, groupLegs: wizard.groupLegs }
  });
  try {
    await persistTournament(tournament);
    closeModal();
    toast('Campeonato criado e confrontos sorteados.');
    openTournament(tournament.id);
  } catch (error) { toast(error.message, 'error'); }
}

function createMatch({ stage, round, group = null, homeId = null, awayId = null, bracketRound = null, label = '' }) {
  const bye = Boolean(homeId && !awayId);
  return { id: uid(), stage, round, group, bracketRound, label, homeId, awayId, homeScore: '', awayScore: '', winnerId: bye ? homeId : null, played: bye, isBye: bye, homeLineup: [], awayLineup: [], homeUsage: '', awayUsage: '', mvpId: '', notes: '' };
}

function roundRobin(ids, { stage = 'Liga', group = null, legs = 1 } = {}) {
  let entries = [...ids];
  if (entries.length % 2 === 1) entries.push(null);
  const rounds = entries.length - 1;
  const half = entries.length / 2;
  const matches = [];
  let rotation = [...entries];
  for (let round = 1; round <= rounds; round++) {
    for (let index = 0; index < half; index++) {
      const a = rotation[index]; const b = rotation[rotation.length - 1 - index];
      if (!a || !b) continue;
      const homeId = round % 2 === 0 ? b : a; const awayId = round % 2 === 0 ? a : b;
      matches.push(createMatch({ stage, round, group, homeId, awayId, label: `Rodada ${round}` }));
    }
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)];
  }
  if (legs === 2) {
    matches.push(...matches.map((match) => createMatch({ stage, round: match.round + rounds, group, homeId: match.awayId, awayId: match.homeId, label: `Rodada ${match.round + rounds}` })));
  }
  return matches;
}

function nextPowerOfTwo(number) { let value = 1; while (value < number) value *= 2; return value; }
function knockoutLabel(count) { return ({ 2: 'Final', 4: 'Semifinal', 8: 'Quartas de final', 16: 'Oitavas de final', 32: '16 avos de final' }[count] || `Mata-mata com ${count} participantes`); }
function createKnockoutFirstRound(ids, seeded = false) {
  const ordered = seeded ? [...ids] : shuffle(ids);
  const size = nextPowerOfTwo(ordered.length);
  const byeCount = size - ordered.length;
  const matches = []; let cursor = 0;
  for (let index = 0; index < byeCount; index++) matches.push(createMatch({ stage: 'Mata-mata', round: 1, bracketRound: 1, homeId: ordered[cursor++], awayId: null, label: knockoutLabel(size) }));
  while (cursor < ordered.length) matches.push(createMatch({ stage: 'Mata-mata', round: 1, bracketRound: 1, homeId: ordered[cursor++], awayId: ordered[cursor++] || null, label: knockoutLabel(size) }));
  return matches;
}
function distributeGroups(ids, count) {
  const groups = Array.from({ length: count }, (_, index) => ({ name: `Grupo ${String.fromCharCode(65 + index)}`, ids: [] }));
  shuffle(ids).forEach((id, index) => { const cycle = Math.floor(index / count); const position = index % count; const target = cycle % 2 === 0 ? position : count - 1 - position; groups[target].ids.push(id); });
  return groups;
}
function initializeLineups(tournament, matches = tournament.matches) {
  matches.forEach((match) => {
    if (tournament.mode === 'individual') {
      const home = tournament.participants.find((participant) => participant.id === match.homeId);
      const away = tournament.participants.find((participant) => participant.id === match.awayId);
      match.homeLineup = home?.linkedPlayerId ? [home.linkedPlayerId] : [];
      match.awayLineup = away?.linkedPlayerId ? [away.linkedPlayerId] : [];
    } else {
      match.homeLineup = tournament.participants.find((participant) => participant.id === match.homeId)?.members.map((member) => member.id) || [];
      match.awayLineup = tournament.participants.find((participant) => participant.id === match.awayId)?.members.map((member) => member.id) || [];
    }
  });
}
function buildTournament({ name, game, mode, format, participants, settings }) {
  const tournament = { id: uid(), name, game, mode, format, participants, settings, createdAt: now(), updatedAt: now(), matches: [], groups: [], knockoutStarted: format === 'knockout', championId: null };
  const ids = participants.map((participant) => participant.id);
  if (format === 'league') tournament.matches = roundRobin(ids, { legs: settings.leagueLegs });
  else if (format === 'knockout') tournament.matches = createKnockoutFirstRound(ids);
  else {
    tournament.groups = distributeGroups(ids, settings.groupCount);
    tournament.matches = tournament.groups.flatMap((group) => roundRobin(group.ids, { stage: 'Fase de grupos', group: group.name, legs: settings.groupLegs }));
  }
  initializeLineups(tournament);
  return tournament;
}

function standingsFor(tournament, ids, matches) {
  const stats = Object.fromEntries(ids.map((id) => [id, { id, pj: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0 }]));
  matches.forEach((match) => {
    if (!match.played || match.isBye || !match.homeId || !match.awayId || !stats[match.homeId] || !stats[match.awayId]) return;
    const hs = Number(match.homeScore); const as = Number(match.awayScore); const home = stats[match.homeId]; const away = stats[match.awayId];
    home.pj++; away.pj++; home.gp += hs; home.gc += as; away.gp += as; away.gc += hs;
    if (hs > as) { home.v++; home.pts += 3; away.d++; } else if (as > hs) { away.v++; away.pts += 3; home.d++; } else { home.e++; away.e++; home.pts++; away.pts++; }
  });
  Object.values(stats).forEach((row) => row.sg = row.gp - row.gc);
  return Object.values(stats).sort((a, b) => b.pts - a.pts || b.v - a.v || b.sg - a.sg || b.gp - a.gp || participantName(tournament, a.id).localeCompare(participantName(tournament, b.id)));
}
function overallStats(tournament) { return standingsFor(tournament, tournament.participants.map((participant) => participant.id), tournament.matches); }
function allMembers(tournament) {
  return tournament.mode === 'individual'
    ? tournament.participants.map((participant) => ({ id: participant.linkedPlayerId, name: participant.name, teamName: participant.name }))
    : tournament.participants.flatMap((team) => team.members.map((member) => ({ ...member, teamName: team.name })));
}
function individualStats(tournament) {
  const result = Object.fromEntries(allMembers(tournament).filter((member) => member.id).map((member) => [member.id, { ...member, pj: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0, mvps: 0 }]));
  tournament.matches.forEach((match) => {
    if (!match.played || match.isBye || !match.homeId || !match.awayId) return;
    const hs = Number(match.homeScore); const as = Number(match.awayScore); const homeResult = hs > as ? 'v' : hs < as ? 'd' : 'e'; const awayResult = hs < as ? 'v' : hs > as ? 'd' : 'e';
    (match.homeLineup || []).forEach((id) => { const row = result[id]; if (!row) return; row.pj++; row[homeResult]++; row.gp += hs; row.gc += as; row.pts += homeResult === 'v' ? 3 : homeResult === 'e' ? 1 : 0; });
    (match.awayLineup || []).forEach((id) => { const row = result[id]; if (!row) return; row.pj++; row[awayResult]++; row.gp += as; row.gc += hs; row.pts += awayResult === 'v' ? 3 : awayResult === 'e' ? 1 : 0; });
    if (match.mvpId && result[match.mvpId]) result[match.mvpId].mvps++;
  });
  Object.values(result).forEach((row) => row.sg = row.gp - row.gc);
  return Object.values(result).sort((a, b) => b.pts - a.pts || b.v - a.v || b.sg - a.sg || b.mvps - a.mvps || a.name.localeCompare(b.name));
}
function updateChampion(tournament) {
  if (tournament.format === 'league') {
    if (tournament.matches.filter((match) => !match.isBye).every((match) => match.played)) tournament.championId = overallStats(tournament)[0]?.id || null;
  } else {
    const final = tournament.matches.find((match) => match.stage === 'Mata-mata' && match.label === 'Final');
    if (final?.played) tournament.championId = final.winnerId;
  }
}
function latestKnockoutRound(tournament) { return Math.max(0, ...tournament.matches.filter((match) => match.stage === 'Mata-mata').map((match) => match.bracketRound || 0)); }
function advanceKnockout(tournament) {
  const round = latestKnockoutRound(tournament); if (!round) return;
  const matches = tournament.matches.filter((match) => match.stage === 'Mata-mata' && match.bracketRound === round);
  if (!matches.length || matches.some((match) => !match.played) || tournament.matches.some((match) => match.stage === 'Mata-mata' && match.bracketRound === round + 1)) return;
  const winners = matches.map((match) => match.winnerId).filter(Boolean);
  if (winners.length === 1) { tournament.championId = winners[0]; return; }
  const next = [];
  for (let index = 0; index < winners.length; index += 2) next.push(createMatch({ stage: 'Mata-mata', round: round + 1, bracketRound: round + 1, homeId: winners[index], awayId: winners[index + 1] || null, label: knockoutLabel(winners.length) }));
  if (winners.length === 2 && tournament.settings.thirdPlace && matches.length === 2 && !tournament.matches.some((match) => match.stage === '3º lugar')) {
    const losers = matches.map((match) => match.winnerId === match.homeId ? match.awayId : match.homeId).filter(Boolean);
    if (losers.length === 2) next.push(createMatch({ stage: '3º lugar', round: round + 1, homeId: losers[0], awayId: losers[1], label: 'Disputa de 3º lugar' }));
  }
  tournament.matches.push(...next); initializeLineups(tournament, next);
}
async function startMixedKnockout(tournament) {
  if (tournament.knockoutStarted) return;
  if (tournament.matches.filter((match) => match.stage === 'Fase de grupos' && !match.isBye).some((match) => !match.played)) throw new Error('Finalize todos os jogos dos grupos primeiro.');
  const qualifiers = [];
  tournament.groups.forEach((group) => {
    const table = standingsFor(tournament, group.ids, tournament.matches.filter((match) => match.group === group.name));
    qualifiers.push(...table.slice(0, tournament.settings.qualifiers).map((row, index) => ({ id: row.id, rank: index + 1, group: group.name })));
  });
  qualifiers.sort((a, b) => a.rank - b.rank || a.group.localeCompare(b.group));
  const ordered = qualifiers.map((row) => row.id); const seeded = [];
  while (ordered.length) { seeded.push(ordered.shift()); if (ordered.length) seeded.push(ordered.pop()); }
  const matches = createKnockoutFirstRound(seeded, true); tournament.matches.push(...matches); tournament.knockoutStarted = true; initializeLineups(tournament, matches); await persistTournament(tournament);
}

function openTournament(id) {
  state.activeTournamentId = id;
  renderTournamentModal();
}

function renderTournamentModal() {
  const tournament = tournamentById(state.activeTournamentId); if (!tournament) return;
  updateChampion(tournament);
  const content = tournamentTabHtml(tournament);
  openModal(`
    <div class="modal-head"><div><span class="eyebrow">${escapeHtml(tournament.game)}</span><h2>${escapeHtml(tournament.name)}</h2></div><button class="icon-button" data-close>×</button></div>
    <div class="modal-body"><div class="tournament-shell"><aside class="tournament-menu">${['overview','matches','standings','players'].map((tab) => `<button class="${state.tournamentTab === tab ? 'active' : ''}" data-tournament-tab="${tab}">${({overview:'Resumo',matches:'Partidas',standings:'Classificação',players:'Estatísticas'})[tab]}</button>`).join('')}</aside><div>${content}</div></div></div>`);
  $('[data-close]').addEventListener('click', closeModal);
  $$('[data-tournament-tab]').forEach((button) => button.addEventListener('click', () => { state.tournamentTab = button.dataset.tournamentTab; renderTournamentModal(); }));
  $$('[data-edit-match]').forEach((button) => button.addEventListener('click', () => openMatchModal(tournament.id, button.dataset.editMatch)));
  $('[data-start-knockout]')?.addEventListener('click', async () => { try { await startMixedKnockout(tournament); toast('Mata-mata gerado.'); renderTournamentModal(); } catch (error) { toast(error.message, 'error'); } });
  $('[data-reroll]')?.addEventListener('click', async () => { try { rerollTournament(tournament); await persistTournament(tournament); toast('Confrontos sorteados novamente.'); renderTournamentModal(); } catch (error) { toast(error.message, 'error'); } });
  $('[data-delete-tournament]')?.addEventListener('click', async () => { if (!confirm(`Excluir ${tournament.name}?`)) return; try { await removeTournament(tournament.id); toast('Campeonato excluído.'); } catch (error) { toast(error.message, 'error'); } });
}

function tournamentTabHtml(tournament) {
  if (state.tournamentTab === 'matches') return matchesHtml(tournament);
  if (state.tournamentTab === 'standings') return standingsHtml(tournament);
  if (state.tournamentTab === 'players') return playerStatsHtml(tournament);
  const played = tournament.matches.filter((match) => match.played && !match.isBye).length;
  const total = tournament.matches.filter((match) => !match.isBye).length;
  const canReroll = played === 0;
  const groupsDone = tournament.format === 'mixed' && !tournament.knockoutStarted && tournament.matches.filter((match) => match.stage === 'Fase de grupos' && !match.isBye).every((match) => match.played);
  return `<div class="stack">
    ${tournament.championId ? `<div class="notice success"><strong>Campeão:</strong> ${escapeHtml(participantName(tournament, tournament.championId))}</div>` : ''}
    <div class="grid cols-3">${kpiCard('Participantes', tournament.participants.length, '◉', modeName(tournament.mode))}${kpiCard('Partidas', `${played}/${total}`, '▤', 'Resultados registrados')}${kpiCard('Formato', formatName(tournament.format), '◇', tournament.knockoutStarted ? 'Chave ativa' : 'Fase inicial')}</div>
    <div class="card card-pad"><h3>Participantes</h3><div class="member-list" style="margin-top:12px;">${tournament.participants.map((participant) => `<span class="member-chip"><strong>${escapeHtml(participant.name)}</strong>${tournament.mode === 'teams' ? ` · ${participant.members.map((member) => escapeHtml(member.name)).join(', ')}` : ''}</span>`).join('')}</div></div>
    ${groupsDone ? `<button class="button primary" data-start-knockout>Gerar mata-mata com os classificados</button>` : ''}
    <div style="display:flex; gap:8px; flex-wrap:wrap;"><button class="button secondary" data-reroll ${canReroll ? '' : 'disabled'}>Sortear confrontos novamente</button><button class="button danger" data-delete-tournament>Excluir campeonato</button></div>
  </div>`;
}

function matchGroupKey(match) { return `${match.stage}|${match.group || ''}|${match.label || `Rodada ${match.round}`}`; }
function matchesHtml(tournament) {
  const groups = new Map();
  tournament.matches.forEach((match) => { const key = matchGroupKey(match); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(match); });
  return `<div class="match-list">${[...groups.values()].map((matches) => {
    const first = matches[0]; const title = first.group ? `${first.group} · ${first.label}` : first.label || first.stage;
    return `<div class="round-block"><div class="round-title"><span>${escapeHtml(title)}</span><span>${matches.filter((match) => match.played).length}/${matches.length}</span></div>${matches.map((match) => {
      if (match.isBye) return `<div class="match-row"><div class="match-team winner">${escapeHtml(participantName(tournament, match.homeId))}</div><div class="score">—</div><div class="vs"></div><div class="score"></div><div class="match-team away subtle">Folga</div><span class="badge">Classificado</span></div>`;
      return `<div class="match-row"><div class="match-team ${match.winnerId === match.homeId ? 'winner' : ''}">${escapeHtml(participantName(tournament, match.homeId))}</div><div class="score">${match.played ? escapeHtml(match.homeScore) : '—'}</div><div class="vs">×</div><div class="score">${match.played ? escapeHtml(match.awayScore) : '—'}</div><div class="match-team away ${match.winnerId === match.awayId ? 'winner' : ''}">${escapeHtml(participantName(tournament, match.awayId))}</div><button class="button small secondary" data-edit-match="${match.id}">${match.played ? 'Editar' : 'Resultado'}</button></div>`;
    }).join('')}</div>`;
  }).join('')}</div>`;
}

function standingsTable(tournament, rows, title) {
  return `<div class="card"><div class="card-head"><h3>${escapeHtml(title)}</h3></div><div class="card-body"><div class="table-wrap"><table><thead><tr><th>#</th><th>Participante</th><th class="num">J</th><th class="num">V</th><th class="num">E</th><th class="num">D</th><th class="num">GP</th><th class="num">GC</th><th class="num">SG</th><th class="num">Pts</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(participantName(tournament, row.id))}</strong></td><td class="num">${row.pj}</td><td class="num">${row.v}</td><td class="num">${row.e}</td><td class="num">${row.d}</td><td class="num">${row.gp}</td><td class="num">${row.gc}</td><td class="num">${row.sg}</td><td class="num"><strong>${row.pts}</strong></td></tr>`).join('')}</tbody></table></div></div></div>`;
}
function standingsHtml(tournament) {
  if (tournament.format === 'mixed' && tournament.groups.length) return `<div class="stack">${tournament.groups.map((group) => standingsTable(tournament, standingsFor(tournament, group.ids, tournament.matches.filter((match) => match.group === group.name)), group.name)).join('')}${tournament.knockoutStarted ? standingsTable(tournament, overallStats(tournament), 'Desempenho geral') : ''}</div>`;
  return standingsTable(tournament, overallStats(tournament), tournament.format === 'league' ? 'Tabela da liga' : 'Desempenho geral');
}
function playerStatsHtml(tournament) {
  const rows = individualStats(tournament);
  return `<div class="card"><div class="card-head"><div><h3>Desempenho individual</h3><p class="muted">Em equipes, cada jogador escalado recebe o resultado.</p></div></div><div class="card-body"><div class="table-wrap"><table><thead><tr><th>#</th><th>Jogador</th><th>Equipe</th><th class="num">J</th><th class="num">V</th><th class="num">E</th><th class="num">D</th><th class="num">Pts</th><th class="num">MVP</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.teamName)}</td><td class="num">${row.pj}</td><td class="num">${row.v}</td><td class="num">${row.e}</td><td class="num">${row.d}</td><td class="num">${row.pts}</td><td class="num">${row.mvps}</td></tr>`).join('')}</tbody></table></div></div></div>`;
}

function openMatchModal(tournamentId, matchId) {
  const tournament = tournamentById(tournamentId); const match = tournament.matches.find((item) => item.id === matchId); if (!match) return;
  const homeRoster = rosterFor(tournament, match.homeId); const awayRoster = rosterFor(tournament, match.awayId); const allRoster = [...homeRoster, ...awayRoster];
  openModal(`
    <div class="modal-head"><div><span class="eyebrow">${escapeHtml(match.label || match.stage)}</span><h2>${escapeHtml(participantName(tournament, match.homeId))} × ${escapeHtml(participantName(tournament, match.awayId))}</h2></div><button class="icon-button" data-close>×</button></div>
    <form id="matchForm"><div class="modal-body stack">
      <div class="grid cols-2"><label class="field"><span>Placar — ${escapeHtml(participantName(tournament, match.homeId))}</span><input id="mHomeScore" type="number" min="0" value="${escapeHtml(match.homeScore)}" required></label><label class="field"><span>Placar — ${escapeHtml(participantName(tournament, match.awayId))}</span><input id="mAwayScore" type="number" min="0" value="${escapeHtml(match.awayScore)}" required></label></div>
      <div class="grid cols-2"><label class="field"><span>${escapeHtml(tournament.settings.usageLabel)} — casa</span><input id="mHomeUsage" value="${escapeHtml(match.homeUsage)}"></label><label class="field"><span>${escapeHtml(tournament.settings.usageLabel)} — visitante</span><input id="mAwayUsage" value="${escapeHtml(match.awayUsage)}"></label></div>
      ${(tournament.format !== 'league' || match.stage === 'Mata-mata' || match.stage === '3º lugar') ? `<label class="field"><span>Vencedor em caso de empate</span><select id="mTieWinner"><option value="">Não necessário</option><option value="${match.homeId}" ${match.winnerId === match.homeId ? 'selected' : ''}>${escapeHtml(participantName(tournament, match.homeId))}</option><option value="${match.awayId}" ${match.winnerId === match.awayId ? 'selected' : ''}>${escapeHtml(participantName(tournament, match.awayId))}</option></select></label>` : ''}
      <label class="field"><span>MVP da partida</span><select id="mMvp"><option value="">Sem MVP</option>${allRoster.map((player) => `<option value="${player.id}" ${match.mvpId === player.id ? 'selected' : ''}>${escapeHtml(player.name)}</option>`).join('')}</select></label>
      ${tournament.mode === 'teams' ? `<div class="grid cols-2">${lineupHtml('home', participantName(tournament, match.homeId), homeRoster, match.homeLineup)}${lineupHtml('away', participantName(tournament, match.awayId), awayRoster, match.awayLineup)}</div>` : ''}
      <label class="field"><span>Observações</span><textarea id="mNotes" placeholder="Pênaltis, melhor de três, detalhes da partida...">${escapeHtml(match.notes)}</textarea></label>
    </div><div class="modal-foot"><button class="button ghost" type="button" data-back-tournament>Voltar</button><button class="button primary" type="submit">Salvar resultado</button></div></form>`, 'medium');
  $('[data-close]').addEventListener('click', closeModal);
  $('[data-back-tournament]').addEventListener('click', renderTournamentModal);
  $('#matchForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const homeScore = Number($('#mHomeScore').value); const awayScore = Number($('#mAwayScore').value);
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore < 0 || awayScore < 0) throw new Error('Informe um placar válido.');
      let winnerId = homeScore > awayScore ? match.homeId : awayScore > homeScore ? match.awayId : null;
      const requiresWinner = tournament.format !== 'league' && match.stage !== 'Fase de grupos';
      if (!winnerId && requiresWinner) winnerId = $('#mTieWinner')?.value || null;
      if (!winnerId && requiresWinner) throw new Error('Escolha quem avançou no empate.');
      match.homeScore = homeScore; match.awayScore = awayScore; match.winnerId = winnerId; match.played = true;
      match.homeUsage = $('#mHomeUsage').value.trim(); match.awayUsage = $('#mAwayUsage').value.trim(); match.mvpId = $('#mMvp').value; match.notes = $('#mNotes').value.trim();
      if (tournament.mode === 'teams') {
        match.homeLineup = $$('input[name="lineup-home"]:checked').map((input) => input.value);
        match.awayLineup = $$('input[name="lineup-away"]:checked').map((input) => input.value);
        if (!match.homeLineup.length || !match.awayLineup.length) throw new Error('Selecione ao menos um jogador de cada equipe.');
      }
      advanceKnockout(tournament); updateChampion(tournament); await persistTournament(tournament); toast('Resultado salvo.'); renderTournamentModal();
    } catch (error) { toast(error.message, 'error'); }
  });
}
function rosterFor(tournament, participantId) {
  const participant = tournament.participants.find((item) => item.id === participantId); if (!participant) return [];
  return tournament.mode === 'individual' ? [{ id: participant.linkedPlayerId, name: participant.name }] : participant.members;
}
function lineupHtml(side, teamName, roster, selected) {
  return `<div class="card card-pad"><strong>Escalação — ${escapeHtml(teamName)}</strong><div class="member-list" style="margin-top:10px;">${roster.map((player) => `<label class="member-chip"><input type="checkbox" name="lineup-${side}" value="${player.id}" ${(selected || []).includes(player.id) ? 'checked' : ''} style="width:auto;">${escapeHtml(player.name)}</label>`).join('')}</div></div>`;
}
function rerollTournament(tournament) {
  if (tournament.matches.some((match) => match.played && !match.isBye)) throw new Error('Não é possível sortear novamente depois de registrar resultados.');
  const ids = tournament.participants.map((participant) => participant.id); tournament.championId = null; tournament.knockoutStarted = tournament.format === 'knockout'; tournament.groups = [];
  if (tournament.format === 'league') tournament.matches = roundRobin(shuffle(ids), { legs: tournament.settings.leagueLegs });
  else if (tournament.format === 'knockout') tournament.matches = createKnockoutFirstRound(ids);
  else { tournament.groups = distributeGroups(ids, tournament.settings.groupCount); tournament.matches = tournament.groups.flatMap((group) => roundRobin(group.ids, { stage: 'Fase de grupos', group: group.name, legs: tournament.settings.groupLegs })); }
  initializeLineups(tournament);
}

function renderImporter() {
  const configured = Boolean(state.config.githubImporterConfigured);
  const canPublish = configured && !state.localMode && state.session;
  $('#view-importer').innerHTML = `
    <div class="grid cols-2">
      <div class="card card-pad">
        <div class="dropzone" id="zipDropzone"><div class="empty-icon">⇧</div><h3>Arraste o ZIP do projeto</h3><p>Ou selecione um arquivo. Ele será aberto no navegador e enviado em um único commit.</p><label class="button primary" for="zipInput">Selecionar ZIP</label><input id="zipInput" type="file" accept=".zip,application/zip"></div>
        <div id="zipSummary" class="file-summary"></div>
      </div>
      <div class="stack">
        <div class="card card-pad"><h3>Publicação automática</h3><p class="muted" style="line-height:1.6;">O token do GitHub não fica no HTML. A função do Vercel autentica como GitHub App, cria os arquivos, gera um commit único e atualiza a branch configurada.</p>${configured ? `<div class="notice success">Integração do GitHub configurada no servidor.</div>` : `<div class="notice warning">As variáveis da GitHub App ainda precisam ser configuradas no Vercel.</div>`}</div>
        <div class="card card-pad stack">
          <label class="field"><span>Mensagem do commit</span><input id="commitMessage" value="Atualização via Arena Maker"></label>
          <label class="choice selected"><input id="replaceRepo" type="checkbox"><strong>Espelhar o conteúdo do ZIP</strong><span>Exclui do repositório os arquivos que não estiverem no ZIP, preservando .github/workflows.</span></label>
          <button id="publishZipBtn" class="button primary wide" ${canPublish ? '' : 'disabled'}>Fazer commit no GitHub</button>
          <div class="progress"><span id="uploadProgress"></span></div>
          <div id="publishResult"></div>
          ${state.localMode ? `<div class="notice warning">Entre com sua conta do Supabase para autorizar a publicação.</div>` : ''}
        </div>
      </div>
    </div>`;
  bindImporterEvents();
}

function bindImporterEvents() {
  const dropzone = $('#zipDropzone'); const input = $('#zipInput');
  input?.addEventListener('change', () => input.files[0] && processZip(input.files[0]));
  ['dragenter','dragover'].forEach((name) => dropzone?.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach((name) => dropzone?.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone?.addEventListener('drop', (event) => { const file = event.dataTransfer.files[0]; if (file) processZip(file); });
  $('#publishZipBtn')?.addEventListener('click', publishZip);
}

async function processZip(file) {
  try {
    if (!file.name.toLowerCase().endsWith('.zip')) throw new Error('Selecione um arquivo ZIP.');
    const zip = await window.JSZip.loadAsync(file);
    let entries = Object.values(zip.files).filter((entry) => !entry.dir && !entry.name.startsWith('__MACOSX/') && !entry.name.includes('/.git/') && !entry.name.includes('/node_modules/'));
    if (!entries.length) throw new Error('O ZIP não possui arquivos válidos.');
    const firstParts = entries.map((entry) => entry.name.split('/')[0]);
    const commonRoot = firstParts.every((part) => part === firstParts[0]) && entries.every((entry) => entry.name.includes('/')) ? `${firstParts[0]}/` : '';
    const files = []; let rawBytes = 0;
    for (const entry of entries) {
      const path = entry.name.slice(commonRoot.length).replace(/^\/+/, '');
      if (!path || path.startsWith('.github/workflows/') || path === '.env' || path.includes('/.env')) continue;
      const bytes = await entry.async('uint8array'); rawBytes += bytes.byteLength;
      if (rawBytes > 3_000_000) throw new Error('O conteúdo extraído passou de 3 MB. Nesta versão, reduza imagens/arquivos grandes do ZIP.');
      const base64 = uint8ToBase64(bytes);
      files.push({ path, content: base64, encoding: 'base64' });
    }
    state.zipPayload = { name: file.name, files, rawBytes };
    $('#zipSummary').classList.add('show');
    $('#zipSummary').innerHTML = `<strong>${escapeHtml(file.name)}</strong><div class="tournament-meta"><span class="badge">${files.length} arquivos</span><span class="badge">${formatBytes(rawBytes)} extraídos</span></div><p class="muted" style="font-size:.78rem; margin:10px 0 0;">${files.slice(0, 6).map((item) => escapeHtml(item.path)).join(' · ')}${files.length > 6 ? ' …' : ''}</p>`;
    toast('ZIP preparado para publicação.');
  } catch (error) { state.zipPayload = null; toast(error.message, 'error'); }
}

function uint8ToBase64(bytes) {
  let binary = ''; const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}
function formatBytes(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`; }

async function publishZip() {
  if (!state.zipPayload) return toast('Selecione um ZIP primeiro.', 'error');
  if (!state.session) return toast('Entre com o Supabase para publicar.', 'error');
  const progress = $('#uploadProgress'); const result = $('#publishResult');
  try {
    progress.style.width = '20%'; result.innerHTML = '<div class="notice">Preparando commit...</div>';
    const response = await fetch('/api/github-import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.session.access_token}` },
      body: JSON.stringify({ files: state.zipPayload.files, message: $('#commitMessage').value.trim() || 'Atualização via Arena Maker', replace: $('#replaceRepo').checked })
    });
    progress.style.width = '75%';
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Falha ao publicar no GitHub.');
    progress.style.width = '100%';
    result.innerHTML = `<div class="notice success"><strong>Commit concluído.</strong><br>${escapeHtml(data.commitSha.slice(0, 7))} · ${escapeHtml(data.branch)}<br><a href="${escapeHtml(data.commitUrl)}" target="_blank" rel="noopener" style="color:inherit;">Abrir commit no GitHub</a></div>`;
    toast('Projeto publicado no GitHub.');
  } catch (error) { progress.style.width = '0'; result.innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`; toast(error.message, 'error'); }
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) { const random = Math.floor(Math.random() * (index + 1)); [copy[index], copy[random]] = [copy[random], copy[index]]; }
  return copy;
}

init();
