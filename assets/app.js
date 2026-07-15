const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));
const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');


const GAME_PROFILES = {
  fifa: {
    id: 'fifa',
    label: 'FIFA',
    short: 'FIFA',
    icon: '⚽',
    description: 'Gols, times utilizados, goleadas e desempenho por clube.',
    scoreLabel: 'Gols',
    scoreShort: 'G',
    choiceLabel: 'Time utilizado',
    choicePlural: 'Times',
    drawAllowed: true
  },
  lol: {
    id: 'lol',
    label: 'League of Legends',
    short: 'LOL',
    icon: '◈',
    description: 'Campeões, kills, mortes, assistências, KDA e win rate.',
    scoreLabel: 'Kills',
    scoreShort: 'K',
    choiceLabel: 'Campeão utilizado',
    choicePlural: 'Campeões',
    drawAllowed: false
  },
  beyblade: {
    id: 'beyblade',
    label: 'Beyblade',
    short: 'BEY',
    icon: '◎',
    description: 'Pontos, beyblades usados, aproveitamento e tipo de finalização.',
    scoreLabel: 'Pontos',
    scoreShort: 'PTS',
    choiceLabel: 'Beyblade utilizado',
    choicePlural: 'Beyblades',
    drawAllowed: false,
    finishTypes: ['Spin Finish', 'Burst Finish', 'Over Finish', 'Extreme Finish', 'Outro']
  }
};

function detectGameProfile(value = '') {
  const text = String(value).toLowerCase();
  if (text.includes('league') || text === 'lol' || text.includes('legends')) return 'lol';
  if (text.includes('bey')) return 'beyblade';
  return 'fifa';
}

function getGameProfile(tournamentOrId) {
  const id = typeof tournamentOrId === 'string'
    ? tournamentOrId
    : tournamentOrId?.gameProfile || detectGameProfile(tournamentOrId?.game);
  return GAME_PROFILES[id] || GAME_PROFILES.fifa;
}

function gameProfileClass(tournament) {
  return `game-${getGameProfile(tournament).id}`;
}

const LOCAL_KEY = 'arena_maker_v4_tournaments';

const state = {
  config: null,
  supabase: null,
  localMode: true,
  tournaments: [],
  view: 'tournaments',
  filter: 'all',
  activeTournamentId: null,
  detailTab: 'matches',
  wizard: null,
  zipPayload: null
};

const formatLabel = (format) => ({ league: 'Liga', knockout: 'Mata-mata', mixed: 'Liga + mata-mata' }[format] || format);
const modeLabel = (mode) => mode === 'teams' ? 'Equipes' : 'Individual';
const tournamentById = (id) => state.tournaments.find((item) => item.id === id);
const participantById = (tournament, id) => tournament.participants.find((item) => item.id === id);
const participantName = (tournament, id) => participantById(tournament, id)?.name || 'A definir';

function toast(message, type = '') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  $('#toastRoot').append(element);
  setTimeout(() => element.remove(), 3600);
}

function openModal(html, size = '') {
  $('#modalRoot').innerHTML = `<div class="modal-backdrop" data-backdrop><div class="modal ${size}">${html}</div></div>`;
  $('[data-backdrop]').addEventListener('click', (event) => {
    if (event.target.matches('[data-backdrop]')) closeModal();
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
    state.supabase = window.supabase.createClient(
      state.config.supabaseUrl,
      state.config.supabaseAnonKey,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );
    state.localMode = false;
    setSyncStatus(true);
    await loadCloudData();
  } else {
    state.localMode = true;
    setSyncStatus(false);
    loadLocalData();
  }
  renderCurrentView();
}

function bindStaticEvents() {
  $('#newTournamentBtn').addEventListener('click', openTournamentWizard);
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
}

function setSyncStatus(online) {
  $('#syncStatus').innerHTML = `
    <span class="sync-dot ${online ? 'online' : ''}"></span>
    <div><strong>${online ? 'Supabase conectado' : 'Modo local'}</strong><span>${online ? 'Dados sincronizados' : 'Somente neste navegador'}</span></div>`;
}

function loadLocalData() {
  try { state.tournaments = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]').map(normalizeTournament); }
  catch { state.tournaments = []; }
}

function normalizeTournament(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const tournament = clone(raw);
  tournament.version = tournament.version || 6;
  tournament.gameProfile = tournament.gameProfile || detectGameProfile(tournament.game);
  const profile = getGameProfile(tournament.gameProfile);
  tournament.game = profile.label;
  tournament.participants = (tournament.participants || []).map((participant) => ({
    id: participant.id || uid(),
    name: participant.name || 'Participante',
    players: participant.players || participant.members || [{ id: participant.linkedPlayerId || uid(), name: participant.name || 'Jogador' }]
  }));
  tournament.settings = {
    leagueLegs: tournament.settings?.leagueLegs || tournament.settings?.groupLegs || 1,
    pointsWin: tournament.settings?.pointsWin ?? 3,
    pointsDraw: tournament.settings?.pointsDraw ?? 1,
    qualifiers: tournament.settings?.qualifiers || 8,
    thirdPlace: tournament.settings?.thirdPlace ?? true,
    knockoutPairing: tournament.settings?.knockoutPairing || tournament.knockoutState?.pairing || (tournament.knockoutState?.seeded ? 'seeded' : 'draw'),
    bracketMode: tournament.settings?.bracketMode || 'flexible'
  };
  tournament.matches = (tournament.matches || []).map((match) => {
    const oldStage = String(match.stage || '').toLowerCase();
    const stage = oldStage.includes('mata') ? 'knockout' : oldStage.includes('3') ? 'third' : oldStage.includes('group') || oldStage.includes('grupo') || oldStage.includes('liga') ? 'league' : (match.bracketRound ? 'knockout' : match.stage || 'league');
    return {
      ...match,
      stage,
      roundName: match.roundName || match.label || (stage === 'league' ? `Rodada ${match.round || 1}` : stage === 'third' ? 'Disputa de 3º lugar' : knockoutRoundName(2 ** Math.max(1, (match.bracketRound || 1)))),
      homeLineup: match.homeLineup || participantById({ participants: tournament.participants }, match.homeId)?.players.map((player) => player.id) || [],
      awayLineup: match.awayLineup || participantById({ participants: tournament.participants }, match.awayId)?.players.map((player) => player.id) || [],
      homeChoice: match.homeChoice || '',
      awayChoice: match.awayChoice || '',
      homeDeaths: Number(match.homeDeaths ?? match.gameData?.homeDeaths ?? 0),
      awayDeaths: Number(match.awayDeaths ?? match.gameData?.awayDeaths ?? 0),
      homeAssists: Number(match.homeAssists ?? match.gameData?.homeAssists ?? 0),
      awayAssists: Number(match.awayAssists ?? match.gameData?.awayAssists ?? 0),
      finishType: match.finishType || match.gameData?.finishType || ''
    };
  });
  tournament.knockoutState = tournament.knockoutState || {
    started: tournament.format === 'knockout' || tournament.matches.some((match) => match.stage === 'knockout'),
    currentRound: Math.max(0, ...tournament.matches.filter((match) => match.stage === 'knockout').map((match) => match.bracketRound || 0)),
    pendingByes: [],
    initialByes: [],
    pairing: tournament.settings.knockoutPairing,
    seeded: tournament.settings.knockoutPairing === 'seeded'
  };
  tournament.knockoutState.initialByes = tournament.knockoutState.initialByes || [...(tournament.knockoutState.pendingByes || [])];
  tournament.knockoutState.pairing = tournament.knockoutState.pairing || (tournament.knockoutState.seeded ? 'seeded' : tournament.settings.knockoutPairing || 'draw');
  tournament.knockoutState.seeded = tournament.knockoutState.pairing === 'seeded';
  tournament.extraLabel = profile.choiceLabel;
  tournament.createdAt = tournament.createdAt || tournament.created_at || now();
  tournament.updatedAt = tournament.updatedAt || tournament.updated_at || tournament.createdAt;
  tournament.status = tournament.championId ? 'finished' : 'active';
  return tournament;
}

function saveLocalData() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state.tournaments));
}

async function loadCloudData() {
  const { data, error } = await state.supabase.from('tournaments').select('*').order('updated_at', { ascending: false });
  if (error) {
    toast(`Falha ao carregar: ${error.message}`, 'error');
    state.tournaments = [];
    return;
  }
  state.tournaments = (data || []).map((row) => normalizeTournament({ ...row.state, id: row.id }));
}

async function persistTournament(tournament) {
  tournament.updatedAt = now();
  updateTournamentStatus(tournament);
  const index = state.tournaments.findIndex((item) => item.id === tournament.id);
  if (index >= 0) state.tournaments[index] = tournament;
  else state.tournaments.unshift(tournament);

  if (state.localMode) {
    saveLocalData();
  } else {
    const payload = {
      id: tournament.id,
      name: tournament.name,
      game: tournament.game,
      mode: tournament.mode,
      format: tournament.format,
      status: tournament.status,
      state: tournament,
      updated_at: now()
    };
    const { error } = await state.supabase.from('tournaments').upsert(payload);
    if (error) throw error;
  }
  renderCurrentView();
}

async function removeTournament(id) {
  state.tournaments = state.tournaments.filter((item) => item.id !== id);
  if (state.localMode) saveLocalData();
  else {
    const { error } = await state.supabase.from('tournaments').delete().eq('id', id);
    if (error) throw error;
  }
  state.activeTournamentId = null;
  closeModal();
  renderCurrentView();
}

function navigate(view) {
  state.view = view;
  state.activeTournamentId = null;
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  const isTournament = view === 'tournaments';
  $('#viewEyebrow').textContent = isTournament ? 'COMPETIÇÕES' : 'MANUTENÇÃO';
  $('#viewTitle').textContent = isTournament ? 'Campeonatos' : 'Publicar atualização';
  $('#viewSubtitle').textContent = isTournament
    ? 'Crie formatos livres, sorteie confrontos e registre os resultados.'
    : 'Envie uma nova versão do sistema para o GitHub.';
  $('#newTournamentBtn').classList.toggle('hidden', !isTournament);
  renderCurrentView();
}

function renderCurrentView() {
  if (state.view === 'tournaments') renderTournamentsView();
  if (state.view === 'importer') renderImporter();
}

function playedMatches(tournament) {
  return tournament.matches.filter((match) => match.played && !match.isBye).length;
}

function playableMatches(tournament) {
  return tournament.matches.filter((match) => !match.isBye).length;
}

function updateTournamentStatus(tournament) {
  tournament.status = tournament.championId ? 'finished' : 'active';
}

function currentStageLabel(tournament) {
  if (tournament.championId) return 'Finalizado';
  if (tournament.format === 'mixed') return tournament.knockoutState?.started ? 'Mata-mata' : 'Liga classificatória';
  return tournament.format === 'league' ? 'Liga' : 'Mata-mata';
}

function renderTournamentsView() {
  if (state.activeTournamentId) {
    renderTournamentDetail();
    return;
  }

  const all = [...state.tournaments].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const tournaments = all.filter((item) => state.filter === 'all' || (state.filter === 'active' ? !item.championId : Boolean(item.championId)));

  $('#view-tournaments').innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="segmented">
          <button class="${state.filter === 'all' ? 'active' : ''}" data-filter="all">Todos <span>(${all.length})</span></button>
          <button class="${state.filter === 'active' ? 'active' : ''}" data-filter="active">Em andamento</button>
          <button class="${state.filter === 'finished' ? 'active' : ''}" data-filter="finished">Finalizados</button>
        </div>
      </div>
      <div class="toolbar-right"><span class="format-badge">${state.localMode ? 'Modo local' : 'Supabase'}</span></div>
    </div>

    ${tournaments.length ? tournamentTableHtml(tournaments) : `<div class="panel">${emptyTournamentsHtml(all.length > 0)}</div>`}`;

  $$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    renderTournamentsView();
  }));
  $$('[data-open-tournament]').forEach((button) => button.addEventListener('click', () => {
    state.activeTournamentId = button.dataset.openTournament;
    const opened = tournamentById(state.activeTournamentId);
    state.detailTab = opened?.format === 'knockout' ? 'bracket' : 'standings';
    renderTournamentsView();
  }));
  $$('[data-create-tournament]').forEach((button) => button.addEventListener('click', openTournamentWizard));
}

function tournamentTableHtml(tournaments) {
  return `<div class="tournament-grid">${tournaments.map((tournament) => {
    const played = playedMatches(tournament);
    const total = playableMatches(tournament);
    const percent = total ? Math.round((played / total) * 100) : 0;
    const champion = tournament.championId ? participantName(tournament, tournament.championId) : '';
    const profile = getGameProfile(tournament);
    return `<article class="tournament-card ${gameProfileClass(tournament)}" data-open-tournament="${tournament.id}" tabindex="0">
      <div class="tournament-card-accent"></div>
      <div class="tournament-card-top">
        <div>
          <span class="game-kicker"><b>${profile.icon}</b> ${escapeHtml(profile.label)}</span>
          <h3>${escapeHtml(tournament.name)}</h3>
        </div>
        <span class="status-pill ${tournament.championId ? 'finished' : ''}">${tournament.championId ? 'Finalizado' : 'Em andamento'}</span>
      </div>
      <div class="tournament-card-meta">
        <span>${formatLabel(tournament.format)}</span>
        <span>${tournament.participants.length} ${tournament.mode === 'teams' ? 'equipes' : 'jogadores'}</span>
        <span>${escapeHtml(currentStageLabel(tournament))}</span>
      </div>
      ${champion ? `<div class="tournament-champion"><span>CAMPEÃO</span><strong>${escapeHtml(champion)}</strong></div>` : `
      <div class="tournament-progress">
        <div class="progress-copy"><span>${played} de ${total} jogos</span><strong>${percent}%</strong></div>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
      </div>`}
      <div class="tournament-card-foot">
        <span>Atualizado em ${new Date(tournament.updatedAt || tournament.createdAt).toLocaleDateString('pt-BR')}</span>
        <button class="button small primary" data-open-tournament="${tournament.id}">Abrir campeonato</button>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function emptyTournamentsHtml(filtered) {
  return `<div class="empty-state"><div class="empty-state-inner">
    <div class="empty-symbol">▦</div>
    <h2>${filtered ? 'Nenhum campeonato neste filtro' : 'Crie seu primeiro campeonato'}</h2>
    <p>${filtered ? 'Altere o filtro acima para visualizar os demais campeonatos.' : 'Escolha o jogo, informe os participantes e defina livremente se será liga, mata-mata ou liga com classificação para o mata-mata.'}</p>
    ${filtered ? '' : '<button class="button primary" data-create-tournament>+ Novo campeonato</button>'}
  </div></div>`;
}

function newWizardState() {
  return {
    step: 1,
    name: '',
    gameProfile: 'fifa',
    format: 'mixed',
    mode: 'individual',
    entrants: [],
    teams: [newWizardTeam('Equipe 1'), newWizardTeam('Equipe 2')],
    leagueLegs: 1,
    pointsWin: 3,
    pointsDraw: 1,
    qualifiers: 8,
    knockoutPairing: 'seeded',
    bracketMode: 'complete',
    thirdPlace: true
  };
}

function newWizardTeam(name = '') {
  return { id: uid(), name, members: [] };
}

function openTournamentWizard() {
  state.wizard = newWizardState();
  renderWizard();
}

function renderWizard() {
  const wizard = state.wizard;
  const profile = getGameProfile(wizard.gameProfile);
  openModal(`
    <div class="modal-head ${`game-${profile.id}`}">
      <div><div class="eyebrow">NOVO CAMPEONATO · ${profile.short}</div><h2>Montar competição</h2></div>
      <button class="icon-button" data-close>×</button>
    </div>
    <div class="modal-body">
      <div class="wizard-layout">
        <aside class="wizard-steps">
          ${['Jogo e formato','Participantes','Regras','Revisão'].map((label, index) => `<div class="wizard-step ${wizard.step === index + 1 ? 'active' : ''}"><span class="step-number">${index + 1}</span><span>${label}</span></div>`).join('')}
        </aside>
        <div class="wizard-content">${wizardStepHtml(wizard)}</div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="button ghost" data-wizard-back>${wizard.step === 1 ? 'Cancelar' : 'Voltar'}</button>
      <button class="button primary" data-wizard-next>${wizard.step === 4 ? 'Criar e sortear campeonato' : 'Continuar'}</button>
    </div>`, 'wide');

  $('[data-close]').addEventListener('click', closeModal);
  $('[data-wizard-back]').addEventListener('click', () => {
    if (wizard.step === 1) closeModal();
    else { captureWizardFields(); wizard.step -= 1; renderWizard(); }
  });
  $('[data-wizard-next]').addEventListener('click', async () => {
    captureWizardFields();
    const error = validateWizardStep(wizard.step);
    if (error) return toast(error, 'error');
    if (wizard.step < 4) { wizard.step += 1; renderWizard(); return; }
    try {
      const tournament = buildTournamentFromWizard();
      await persistTournament(tournament);
      closeModal();
      state.activeTournamentId = tournament.id;
      state.detailTab = tournament.format === 'knockout' ? 'bracket' : 'standings';
      renderTournamentsView();
      toast('Campeonato criado e confrontos sorteados.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  bindWizardStepEvents();
}

function wizardStepHtml(wizard) {
  if (wizard.step === 1) return wizardFormatHtml(wizard);
  if (wizard.step === 2) return wizardParticipantsHtml(wizard);
  if (wizard.step === 3) return wizardRulesHtml(wizard);
  return wizardReviewHtml(wizard);
}

function wizardFormatHtml(wizard) {
  const selectedProfile = getGameProfile(wizard.gameProfile);
  return `<h3>Escolha o jogo e o formato</h3><p>O jogo define os campos de cada partida e todas as estatísticas. O formato define apenas a estrutura da competição.</p>
    <div class="stack">
      <label class="field"><span>Nome do campeonato</span><input id="wizardName" value="${escapeHtml(wizard.name)}" placeholder="Ex.: Copa de sábado — Julho" autofocus></label>
      <section class="game-profile-section">
        <div class="section-title-line"><div><span>01</span><div><strong>Jogo do campeonato</strong><small>Os painéis e formulários mudam automaticamente.</small></div></div></div>
        <div class="game-choice-grid">
          ${Object.values(GAME_PROFILES).map((profile) => gameChoice(profile, wizard.gameProfile)).join('')}
        </div>
        <div class="profile-preview game-${selectedProfile.id}">
          <span class="profile-preview-icon">${selectedProfile.icon}</span>
          <div><strong>${selectedProfile.label}</strong><span>${selectedProfile.description}</span></div>
          <div class="profile-tags"><b>${selectedProfile.scoreLabel}</b><b>${selectedProfile.choicePlural}</b><b>MVP</b></div>
        </div>
      </section>
      <section class="game-profile-section">
        <div class="section-title-line"><div><span>02</span><div><strong>Formato da competição</strong><small>Você poderá combinar liga e mata-mata.</small></div></div></div>
        <div class="choice-grid">
          ${formatChoice('league','Liga','Todos enfrentam todos. A classificação final define o campeão.',wizard.format)}
          ${formatChoice('knockout','Mata-mata','Confrontos eliminatórios com folgas corretas quando necessário.',wizard.format)}
          ${formatChoice('mixed','Liga + mata-mata','A liga classifica e depois gera uma chave eliminatória.',wizard.format)}
        </div>
      </section>
      <label class="field"><span>Disputa</span><select id="wizardMode"><option value="individual" ${wizard.mode === 'individual' ? 'selected' : ''}>Individual</option><option value="teams" ${wizard.mode === 'teams' ? 'selected' : ''}>Por equipes</option></select></label>
    </div>`;
}

function formatChoice(value, title, description, selected) {
  return `<label class="choice-card ${selected === value ? 'selected' : ''}" data-format-choice="${value}"><input type="radio" name="format" value="${value}" ${selected === value ? 'checked' : ''}><strong>${title}</strong><span>${description}</span></label>`;
}

function gameChoice(profile, selected) {
  return `<button type="button" class="game-choice game-${profile.id} ${selected === profile.id ? 'selected' : ''}" data-game-choice="${profile.id}">
    <span class="game-choice-icon">${profile.icon}</span>
    <span class="game-choice-copy"><strong>${profile.label}</strong><small>${profile.description}</small></span>
    <span class="game-choice-check">✓</span>
  </button>`;
}

function wizardParticipantsHtml(wizard) {
  if (wizard.mode === 'teams') return wizardTeamsHtml(wizard);
  return `<h3>Jogadores deste campeonato</h3><p>Adicione os nomes diretamente aqui. Não existe cadastro separado nem ranking geral fora do campeonato.</p>
    <div class="stack">
      <div class="entry-add"><input id="entrantInput" placeholder="Digite o nome e pressione Enter"><button class="button primary" type="button" data-add-entrant>Adicionar</button></div>
      <div class="entry-summary"><span>${wizard.entrants.length} jogador(es) incluído(s)</span><span>Mínimo: 2</span></div>
      ${wizard.entrants.length ? `<div class="entry-list">${wizard.entrants.map((entrant,index) => `<div class="entry-row"><div class="entry-index">${String(index + 1).padStart(2,'0')}</div><input value="${escapeHtml(entrant.name)}" data-entrant-name="${entrant.id}"><div class="entry-actions"><button class="button small ghost" type="button" data-remove-entrant="${entrant.id}">Remover</button></div></div>`).join('')}</div>` : '<div class="notice info">Comece digitando o primeiro jogador acima.</div>'}
    </div>`;
}

function wizardTeamsHtml(wizard) {
  return `<h3>Equipes e jogadores</h3><p>Cadastre as equipes e os integrantes dentro delas. Os jogos serão entre equipes, mas as estatísticas serão calculadas por jogador conforme a escalação.</p>
    <div class="stack">
      <div class="toolbar"><span class="format-badge">${wizard.teams.length} equipes</span><button class="button secondary" type="button" data-add-team>+ Adicionar equipe</button></div>
      <div class="team-list">${wizard.teams.map((team,index) => teamWizardHtml(team,index)).join('')}</div>
    </div>`;
}

function teamWizardHtml(team, index) {
  return `<section class="team-block">
    <div class="team-block-head"><input value="${escapeHtml(team.name)}" data-team-name="${team.id}" placeholder="Nome da equipe"><button class="button small danger" type="button" data-remove-team="${team.id}">Remover equipe</button></div>
    <div class="team-block-body">
      <div class="entry-add"><input data-member-input="${team.id}" placeholder="Adicionar jogador à equipe ${index + 1}"><button class="button small secondary" type="button" data-add-member="${team.id}">Adicionar jogador</button></div>
      <div class="member-chips">${team.members.length ? team.members.map((member) => `<span class="member-chip">${escapeHtml(member.name)}<button type="button" data-remove-member="${team.id}:${member.id}">×</button></span>`).join('') : '<span class="format-badge">Nenhum jogador</span>'}</div>
    </div>
  </section>`;
}

function wizardRulesHtml(wizard) {
  const participantCount = wizard.mode === 'individual' ? wizard.entrants.length : wizard.teams.length;
  const fullCounts = fullBracketCounts(participantCount);
  if (wizard.format === 'mixed') {
    wizard.qualifiers = Math.min(Math.max(2, Number(wizard.qualifiers) || 2), participantCount);
    if (wizard.bracketMode === 'complete' && !fullCounts.includes(wizard.qualifiers)) {
      wizard.qualifiers = fullCounts[fullCounts.length - 1] || 2;
    }
  }
  const plan = getBracketPlan(wizard.format === 'mixed' ? wizard.qualifiers : participantCount);
  return `<h3>Regras e montagem da chave</h3><p>Defina a liga e, no formato misto, como os classificados serão colocados no mata-mata.</p>
    <div class="stack">
      ${wizard.format !== 'knockout' ? `<div class="grid cols-3">
        <label class="field"><span>Turnos da liga</span><select id="wizardLeagueLegs"><option value="1" ${wizard.leagueLegs === 1 ? 'selected' : ''}>Turno único</option><option value="2" ${wizard.leagueLegs === 2 ? 'selected' : ''}>Ida e volta</option></select></label>
        <label class="field"><span>Pontos por vitória</span><input id="wizardPointsWin" type="number" min="1" value="${wizard.pointsWin}"></label>
        <label class="field"><span>Pontos por empate</span><input id="wizardPointsDraw" type="number" min="0" value="${wizard.pointsDraw}"></label>
      </div>` : ''}
      ${wizard.format === 'mixed' ? `<section class="rule-section">
        <div class="rule-section-head"><div><span class="section-number">01</span><div><h3>Como montar os confrontos</h3><p>Escolha se a liga define apenas os classificados ou também define a posição deles na chave.</p></div></div></div>
        <div class="choice-grid pairing-grid">
          ${ruleChoice('knockout-pairing','draw','Sorteio livre','Os classificados são embaralhados novamente. Qualquer jogador pode enfrentar qualquer outro.',wizard.knockoutPairing,'⇄')}
          ${ruleChoice('knockout-pairing','seeded','Melhor contra pior','1º enfrenta o último classificado, 2º enfrenta o penúltimo e assim por diante.',wizard.knockoutPairing,'1×N')}
        </div>
      </section>
      <section class="rule-section">
        <div class="rule-section-head"><div><span class="section-number">02</span><div><h3>Tamanho da chave</h3><p>Escolha uma chave fechada ou permita quantidades adaptadas com folgas explícitas.</p></div></div></div>
        <div class="choice-grid pairing-grid">
          ${ruleChoice('bracket-mode','complete','Chave completa','Aceita somente 2, 4, 8, 16... classificados. Ninguém recebe folga.',wizard.bracketMode,'◆')}
          ${ruleChoice('bracket-mode','flexible','Chave adaptada','Aceita 3, 5, 6, 7... O sistema mostra quem recebe folga e quem joga a preliminar.',wizard.bracketMode,'◇')}
        </div>
        <div class="qualifier-config">
          <div class="quick-counts">${(wizard.bracketMode === 'complete' ? fullCounts : [2,4,6,8,16].filter((value) => value <= participantCount)).map((value) => `<button type="button" class="${wizard.qualifiers === value ? 'active' : ''}" data-qualifier-quick="${value}">${value}</button>`).join('')}</div>
          <label class="field"><span>Quantidade de classificados</span>${wizard.bracketMode === 'complete'
            ? `<select id="wizardQualifiers">${fullCounts.map((value) => `<option value="${value}" ${wizard.qualifiers === value ? 'selected' : ''}>${value} classificados</option>`).join('')}</select>`
            : `<input id="wizardQualifiers" type="number" min="2" max="${participantCount}" value="${wizard.qualifiers}">`}<small>${wizard.bracketMode === 'complete' ? 'Com 7 participantes, por exemplo, a maior chave completa possível é de 4 classificados.' : 'Uma quantidade ímpar é possível, mas alguém recebe folga. Isso ficará visível na chave.'}</small></label>
        </div>
        ${bracketPlanHtml(plan, wizard.knockoutPairing)}
      </section>` : `${wizard.format === 'knockout' ? bracketPlanHtml(plan, 'draw') : ''}`}
      ${wizard.format !== 'league' ? `<label class="check-row"><input id="wizardThirdPlace" type="checkbox" ${wizard.thirdPlace ? 'checked' : ''}> Criar disputa de terceiro lugar</label>` : ''}
      <div class="notice info">Desempates da liga: pontos, vitórias, saldo, pontos/gols marcados e ordem alfabética.</div>
    </div>`;
}

function ruleChoice(group, value, title, description, selected, symbol) {
  return `<label class="choice-card rule-choice ${selected === value ? 'selected' : ''}" data-rule-choice="${group}:${value}"><input type="radio" name="${group}" value="${value}" ${selected === value ? 'checked' : ''}><span class="choice-symbol">${symbol}</span><strong>${title}</strong><span>${description}</span></label>`;
}

function bracketPlanHtml(plan, pairing) {
  if (!plan || plan.total < 2) return '';
  const pairingCopy = pairing === 'seeded'
    ? 'As folgas ficam com os melhores colocados; os demais cruzam melhor contra pior.'
    : 'As folgas e os confrontos são definidos pelo sorteio.';
  if (!plan.preliminaryMatches) {
    return `<div class="bracket-plan clean"><div class="plan-icon">✓</div><div><strong>Chave completa de ${plan.total}</strong><span>${knockoutRoundName(plan.total)} sem rodada preliminar e sem folgas.</span></div></div>`;
  }
  return `<div class="bracket-plan"><div class="plan-icon">${plan.total}</div><div><strong>Como ${plan.total} classificados serão organizados</strong><span>${plan.preliminaryMatches} confronto(s) preliminar(es), ${plan.byes} folga(s) e ${plan.nextRoundSize} participantes na fase seguinte. ${pairingCopy}</span></div></div>`;
}
function wizardReviewHtml(wizard) {
  const participants = wizard.mode === 'individual' ? wizard.entrants : wizard.teams;
  const estimatedLeague = wizard.format === 'knockout' ? 0 : (participants.length * (participants.length - 1) / 2) * wizard.leagueLegs;
  const knockoutTotal = wizard.format === 'mixed' ? wizard.qualifiers : participants.length;
  const plan = wizard.format === 'league' ? null : getBracketPlan(knockoutTotal);
  const profile = getGameProfile(wizard.gameProfile);
  return `<h3>Revisar estrutura</h3><p>Confira o formato antes de criar. O sistema usará o perfil ${profile.label} em todos os jogos e estatísticas.</p>
    <div class="stack">
      <div class="review-hero game-${profile.id}">
        <div><span>${profile.icon} ${escapeHtml(profile.label)}</span><h3>${escapeHtml(wizard.name)}</h3></div>
        <strong>${formatLabel(wizard.format)}</strong>
      </div>
      <div class="review-grid">
        <div class="review-stat"><span>Participantes</span><strong>${participants.length}</strong></div>
        ${wizard.format !== 'knockout' ? `<div class="review-stat"><span>Jogos da liga</span><strong>${estimatedLeague}</strong></div>` : ''}
        ${wizard.format === 'mixed' ? `<div class="review-stat"><span>Classificados</span><strong>${wizard.qualifiers}</strong></div>` : ''}
        ${plan ? `<div class="review-stat"><span>Folgas iniciais</span><strong>${plan.byes}</strong></div>` : ''}
      </div>
      <div class="profile-review-strip game-${profile.id}"><div><span>PLACAR</span><strong>${profile.scoreLabel}</strong></div><div><span>ESCOLHA</span><strong>${profile.choiceLabel}</strong></div><div><span>ESTATÍSTICAS</span><strong>${profile.id === 'lol' ? 'K/D/A e KDA' : profile.id === 'fifa' ? 'Gols e times' : 'Pontos e finalizações'}</strong></div></div>
      ${wizard.format === 'mixed' ? `<div class="panel"><div class="panel-body"><table class="stats-table"><tbody>
        <tr><td>Cruzamento do mata-mata</td><td class="num"><strong>${wizard.knockoutPairing === 'seeded' ? 'Melhor contra pior' : 'Sorteio livre'}</strong></td></tr>
        <tr><td>Estrutura da chave</td><td class="num">${wizard.bracketMode === 'complete' ? 'Completa, sem folgas' : 'Adaptada, com folgas quando necessário'}</td></tr>
        <tr><td>Primeira fase eliminatória</td><td class="num">${plan.preliminaryMatches ? `${plan.preliminaryMatches} jogo(s) preliminar(es) + ${plan.byes} folga(s)` : knockoutRoundName(plan.total)}</td></tr>
      </tbody></table></div></div>` : ''}
      <div class="notice warning">O sorteio da fase inicial poderá ser refeito enquanto nenhum resultado tiver sido registrado.</div>
    </div>`;
}

function bindWizardStepEvents() {
  const wizard = state.wizard;
  $$('[data-game-choice]').forEach((choice) => choice.addEventListener('click', () => {
    wizard.gameProfile = choice.dataset.gameChoice;
    renderWizard();
  }));
  $$('[data-format-choice]').forEach((choice) => choice.addEventListener('click', () => {
    wizard.format = choice.dataset.formatChoice;
    renderWizard();
  }));
  $$('[data-rule-choice]').forEach((choice) => choice.addEventListener('click', () => {
    const [group, value] = choice.dataset.ruleChoice.split(':');
    if (group === 'knockout-pairing') wizard.knockoutPairing = value;
    if (group === 'bracket-mode') {
      wizard.bracketMode = value;
      const total = wizard.mode === 'individual' ? wizard.entrants.length : wizard.teams.length;
      if (value === 'complete' && !isPowerOfTwo(wizard.qualifiers)) {
        const options = fullBracketCounts(total);
        wizard.qualifiers = options[options.length - 1] || 2;
      }
    }
    renderWizard();
  }));

  $('[data-add-entrant]')?.addEventListener('click', addEntrantFromInput);
  $('#entrantInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addEntrantFromInput(); }
  });
  $$('[data-entrant-name]').forEach((input) => input.addEventListener('input', () => {
    const entrant = wizard.entrants.find((item) => item.id === input.dataset.entrantName);
    if (entrant) entrant.name = input.value;
  }));
  $$('[data-remove-entrant]').forEach((button) => button.addEventListener('click', () => {
    wizard.entrants = wizard.entrants.filter((item) => item.id !== button.dataset.removeEntrant);
    renderWizard();
  }));

  $('[data-add-team]')?.addEventListener('click', () => {
    wizard.teams.push(newWizardTeam(`Equipe ${wizard.teams.length + 1}`));
    renderWizard();
  });
  $$('[data-team-name]').forEach((input) => input.addEventListener('input', () => {
    const team = wizard.teams.find((item) => item.id === input.dataset.teamName);
    if (team) team.name = input.value;
  }));
  $$('[data-remove-team]').forEach((button) => button.addEventListener('click', () => {
    wizard.teams = wizard.teams.filter((item) => item.id !== button.dataset.removeTeam);
    renderWizard();
  }));
  $$('[data-add-member]').forEach((button) => button.addEventListener('click', () => addMemberFromInput(button.dataset.addMember)));
  $$('[data-member-input]').forEach((input) => input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addMemberFromInput(input.dataset.memberInput); }
  }));
  $$('[data-remove-member]').forEach((button) => button.addEventListener('click', () => {
    const [teamId, memberId] = button.dataset.removeMember.split(':');
    const team = wizard.teams.find((item) => item.id === teamId);
    if (team) team.members = team.members.filter((member) => member.id !== memberId);
    renderWizard();
  }));
  $$('[data-qualifier-quick]').forEach((button) => button.addEventListener('click', () => {
    wizard.qualifiers = Number(button.dataset.qualifierQuick);
    renderWizard();
  }));
  $('#wizardQualifiers')?.addEventListener('change', () => {
    wizard.qualifiers = Number($('#wizardQualifiers').value);
    renderWizard();
  });
}

function addEntrantFromInput() {
  const input = $('#entrantInput');
  const name = input?.value.trim();
  if (!name) return;
  state.wizard.entrants.push({ id: uid(), name });
  renderWizard();
  setTimeout(() => $('#entrantInput')?.focus(), 0);
}

function addMemberFromInput(teamId) {
  const input = $(`[data-member-input="${CSS.escape(teamId)}"]`);
  const name = input?.value.trim();
  if (!name) return;
  const team = state.wizard.teams.find((item) => item.id === teamId);
  if (!team) return;
  team.members.push({ id: uid(), name });
  renderWizard();
  setTimeout(() => $(`[data-member-input="${CSS.escape(teamId)}"]`)?.focus(), 0);
}

function captureWizardFields() {
  const wizard = state.wizard;
  if ($('#wizardName')) wizard.name = $('#wizardName').value.trim();
  if ($('#wizardMode')) wizard.mode = $('#wizardMode').value;
  if ($('#wizardLeagueLegs')) wizard.leagueLegs = Number($('#wizardLeagueLegs').value);
  if ($('#wizardPointsWin')) wizard.pointsWin = Math.max(1, Number($('#wizardPointsWin').value) || 3);
  if ($('#wizardPointsDraw')) wizard.pointsDraw = Math.max(0, Number($('#wizardPointsDraw').value) || 0);
  if ($('#wizardQualifiers')) wizard.qualifiers = Number($('#wizardQualifiers').value);
  if ($('#wizardThirdPlace')) wizard.thirdPlace = $('#wizardThirdPlace').checked;
}

function validateWizardStep(step) {
  const wizard = state.wizard;
  if (step === 1) {
    if (!wizard.name) return 'Informe o nome do campeonato.';
    if (!GAME_PROFILES[wizard.gameProfile]) return 'Escolha FIFA, League of Legends ou Beyblade.';
    if (!['league','knockout','mixed'].includes(wizard.format)) return 'Escolha um formato válido.';
  }
  if (step === 2) {
    if (wizard.mode === 'individual') {
      wizard.entrants = wizard.entrants.map((item) => ({ ...item, name: item.name.trim() })).filter((item) => item.name);
      if (wizard.entrants.length < 2) return 'Adicione pelo menos dois jogadores.';
      if (wizard.entrants.length > 30) return 'Esta versão aceita até 30 jogadores por campeonato.';
    } else {
      wizard.teams = wizard.teams.map((team) => ({ ...team, name: team.name.trim(), members: team.members.filter((member) => member.name.trim()) })).filter((team) => team.name);
      if (wizard.teams.length < 2) return 'Adicione pelo menos duas equipes.';
      if (wizard.teams.length > 30) return 'Esta versão aceita até 30 equipes por campeonato.';
      if (wizard.teams.some((team) => !team.members.length)) return 'Cada equipe precisa ter pelo menos um jogador.';
    }
  }
  if (step === 3 && wizard.format === 'mixed') {
    const total = wizard.mode === 'individual' ? wizard.entrants.length : wizard.teams.length;
    if (!Number.isInteger(wizard.qualifiers) || wizard.qualifiers < 2 || wizard.qualifiers > total) return `A quantidade de classificados deve ficar entre 2 e ${total}.`;
    if (wizard.bracketMode === 'complete' && !isPowerOfTwo(wizard.qualifiers)) return 'Na chave completa, escolha 2, 4, 8, 16... classificados. Para outra quantidade, use Chave adaptada.';
    if (!['draw','seeded'].includes(wizard.knockoutPairing)) return 'Escolha como os confrontos do mata-mata serão montados.';
  }
  return '';
}

function buildTournamentFromWizard() {
  const wizard = state.wizard;
  const profile = getGameProfile(wizard.gameProfile);
  const participants = wizard.mode === 'individual'
    ? wizard.entrants.map((entrant) => ({ id: uid(), name: entrant.name, players: [{ id: uid(), name: entrant.name }] }))
    : wizard.teams.map((team) => ({ id: uid(), name: team.name, players: team.members.map((member) => ({ id: uid(), name: member.name })) }));

  const tournament = {
    id: uid(),
    version: 6,
    name: wizard.name,
    gameProfile: profile.id,
    game: profile.label,
    format: wizard.format,
    mode: wizard.mode,
    extraLabel: profile.choiceLabel,
    participants,
    settings: {
      leagueLegs: wizard.leagueLegs,
      pointsWin: wizard.pointsWin,
      pointsDraw: profile.drawAllowed ? wizard.pointsDraw : 0,
      qualifiers: wizard.format === 'mixed' ? wizard.qualifiers : null,
      knockoutPairing: wizard.format === 'mixed' ? wizard.knockoutPairing : 'draw',
      bracketMode: wizard.format === 'mixed' ? wizard.bracketMode : 'flexible',
      thirdPlace: wizard.thirdPlace
    },
    matches: [],
    knockoutState: { started: wizard.format === 'knockout', currentRound: 0, pendingByes: [], initialByes: [], pairing: wizard.format === 'mixed' ? wizard.knockoutPairing : 'draw', seeded: wizard.format === 'mixed' && wizard.knockoutPairing === 'seeded' },
    championId: null,
    status: 'active',
    createdAt: now(),
    updatedAt: now()
  };

  const ids = participants.map((item) => item.id);
  if (wizard.format === 'league' || wizard.format === 'mixed') {
    tournament.matches = createRoundRobin(shuffle(ids), wizard.leagueLegs, tournament);
  } else {
    beginKnockout(tournament, shuffle(ids), 'draw');
  }
  return tournament;
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function createMatch(tournament, data) {
  const home = participantById(tournament, data.homeId);
  const away = participantById(tournament, data.awayId);
  return {
    id: uid(),
    stage: data.stage,
    round: data.round,
    roundName: data.roundName,
    bracketRound: data.bracketRound || null,
    homeId: data.homeId || null,
    awayId: data.awayId || null,
    homeScore: null,
    awayScore: null,
    winnerId: null,
    played: false,
    isBye: false,
    homeChoice: '',
    awayChoice: '',
    homeDeaths: 0,
    awayDeaths: 0,
    homeAssists: 0,
    awayAssists: 0,
    finishType: '',
    mvpPlayerId: '',
    notes: '',
    homeLineup: home?.players.map((player) => player.id) || [],
    awayLineup: away?.players.map((player) => player.id) || []
  };
}

function createRoundRobin(ids, legs, tournament) {
  const rotation = [...ids];
  if (rotation.length % 2 === 1) rotation.push(null);
  const total = rotation.length;
  const rounds = total - 1;
  const half = total / 2;
  const matches = [];

  for (let round = 0; round < rounds; round += 1) {
    for (let index = 0; index < half; index += 1) {
      let homeId = rotation[index];
      let awayId = rotation[total - 1 - index];
      if (!homeId || !awayId) continue;
      if ((round + index) % 2) [homeId, awayId] = [awayId, homeId];
      matches.push(createMatch(tournament, { stage: 'league', round: round + 1, roundName: `Rodada ${round + 1}`, homeId, awayId }));
    }
    rotation.splice(1, 0, rotation.pop());
  }

  if (legs === 2) {
    const returnMatches = matches.map((match) => createMatch(tournament, {
      stage: 'league',
      round: match.round + rounds,
      roundName: `Rodada ${match.round + rounds}`,
      homeId: match.awayId,
      awayId: match.homeId
    }));
    matches.push(...returnMatches);
  }
  return matches;
}

function highestPowerOfTwoAtMost(value) {
  return 2 ** Math.floor(Math.log2(value));
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value >= 2 && (value & (value - 1)) === 0;
}

function fullBracketCounts(maximum) {
  const result = [];
  for (let value = 2; value <= maximum; value *= 2) result.push(value);
  return result;
}

function getBracketPlan(total) {
  const n = Number(total) || 0;
  if (n < 2) return { total: n, preliminaryMatches: 0, byes: 0, nextRoundSize: 0 };
  const base = highestPowerOfTwoAtMost(n);
  const preliminaryMatches = n - base;
  const byes = preliminaryMatches ? n - (preliminaryMatches * 2) : 0;
  return { total: n, preliminaryMatches, byes, nextRoundSize: base };
}

function knockoutRoundName(size) {
  if (size === 2) return 'Final';
  if (size === 4) return 'Semifinais';
  if (size === 8) return 'Quartas de final';
  if (size === 16) return 'Oitavas de final';
  if (size === 32) return '16 avos de final';
  return `Mata-mata — ${size} participantes`;
}

function pairOuter(ids) {
  const pairs = [];
  for (let left = 0, right = ids.length - 1; left < right; left += 1, right -= 1) pairs.push([ids[left], ids[right]]);
  return pairs;
}

function pairSequential(ids) {
  const pairs = [];
  for (let index = 0; index < ids.length; index += 2) pairs.push([ids[index], ids[index + 1]]);
  return pairs;
}

function interleaveByesAndWinners(byes, roundWinners) {
  const result = [];
  const winners = [...roundWinners];
  for (const bye of byes) {
    result.push(bye);
    if (winners.length) result.push(winners.shift());
  }
  result.push(...winners);
  return result;
}

function beginKnockout(tournament, orderedIds, pairingMode = 'draw') {
  const pairing = pairingMode === true ? 'seeded' : pairingMode === false ? 'draw' : pairingMode;
  const seeded = pairing === 'seeded';
  const ids = [...orderedIds];
  const n = ids.length;
  if (n < 2) throw new Error('O mata-mata precisa de pelo menos dois participantes.');
  const plan = getBracketPlan(n);
  tournament.knockoutState = { started: true, currentRound: 1, pendingByes: [], initialByes: [], pairing, seeded };

  let playIds = ids;
  let roundName = knockoutRoundName(n);
  if (plan.preliminaryMatches > 0) {
    const playCount = plan.preliminaryMatches * 2;
    if (seeded) {
      tournament.knockoutState.pendingByes = ids.slice(0, plan.byes);
      playIds = ids.slice(plan.byes);
    } else {
      playIds = ids.slice(0, playCount);
      tournament.knockoutState.pendingByes = ids.slice(playCount);
    }
    roundName = 'Rodada preliminar';
  }
  tournament.knockoutState.initialByes = [...tournament.knockoutState.pendingByes];

  const pairs = seeded ? pairOuter(playIds) : pairSequential(playIds);
  tournament.matches.push(...pairs.map(([homeId, awayId]) => createMatch(tournament, {
    stage: 'knockout', round: 1, bracketRound: 1, roundName, homeId, awayId
  })));
}
function leagueMatches(tournament) {
  return tournament.matches.filter((match) => match.stage === 'league');
}

function knockoutMatches(tournament) {
  return tournament.matches.filter((match) => match.stage === 'knockout');
}

function standings(tournament) {
  const rows = Object.fromEntries(tournament.participants.map((participant) => [participant.id, {
    id: participant.id, pj: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0
  }]));
  for (const match of leagueMatches(tournament)) {
    if (!match.played || !match.homeId || !match.awayId) continue;
    const home = rows[match.homeId];
    const away = rows[match.awayId];
    if (!home || !away) continue;
    const homeScore = Number(match.homeScore || 0);
    const awayScore = Number(match.awayScore || 0);
    const winner = matchWinner(match);
    home.pj += 1; away.pj += 1;
    home.gp += homeScore; home.gc += awayScore;
    away.gp += awayScore; away.gc += homeScore;
    if (winner === home.id) {
      home.v += 1; away.d += 1; home.pts += tournament.settings.pointsWin;
    } else if (winner === away.id) {
      away.v += 1; home.d += 1; away.pts += tournament.settings.pointsWin;
    } else {
      home.e += 1; away.e += 1;
      home.pts += tournament.settings.pointsDraw;
      away.pts += tournament.settings.pointsDraw;
    }
  }
  Object.values(rows).forEach((row) => { row.sg = row.gp - row.gc; });
  return Object.values(rows).sort((a, b) =>
    b.pts - a.pts || b.v - a.v || b.sg - a.sg || b.gp - a.gp || participantName(tournament, a.id).localeCompare(participantName(tournament, b.id))
  );
}

function allLeagueMatchesPlayed(tournament) {
  const matches = leagueMatches(tournament);
  return matches.length > 0 && matches.every((match) => match.played);
}

function currentKnockoutRound(tournament) {
  return Math.max(0, ...knockoutMatches(tournament).map((match) => match.bracketRound || 0));
}

function matchWinner(match) {
  if (!match.played) return null;
  if (match.winnerId) return match.winnerId;
  if (Number(match.homeScore) > Number(match.awayScore)) return match.homeId;
  if (Number(match.awayScore) > Number(match.homeScore)) return match.awayId;
  return null;
}

function advanceKnockout(tournament) {
  const round = currentKnockoutRound(tournament);
  if (!round) return;
  const current = knockoutMatches(tournament).filter((match) => match.bracketRound === round);
  if (!current.length || current.some((match) => !match.played)) return;
  if (knockoutMatches(tournament).some((match) => match.bracketRound === round + 1)) return;

  let winners = current.map(matchWinner).filter(Boolean);
  if (tournament.knockoutState.pendingByes?.length) {
    const byes = [...tournament.knockoutState.pendingByes];
    winners = tournament.knockoutState.pairing === 'seeded'
      ? [...byes, ...winners]
      : interleaveByesAndWinners(byes, winners);
    tournament.knockoutState.pendingByes = [];
  }

  if (winners.length === 1) {
    tournament.championId = winners[0];
    return;
  }

  const nextRound = round + 1;
  const pairs = tournament.knockoutState.pairing === 'seeded' ? pairOuter(winners) : pairSequential(winners);
  const nextName = knockoutRoundName(winners.length);
  tournament.matches.push(...pairs.map(([homeId, awayId]) => createMatch(tournament, {
    stage: 'knockout', round: nextRound, bracketRound: nextRound, roundName: nextName, homeId, awayId
  })));
  tournament.knockoutState.currentRound = nextRound;

  if (winners.length === 2 && tournament.settings.thirdPlace && current.length === 2) {
    const losers = current.map((match) => matchWinner(match) === match.homeId ? match.awayId : match.homeId).filter(Boolean);
    if (losers.length === 2 && !tournament.matches.some((match) => match.stage === 'third')) {
      tournament.matches.push(createMatch(tournament, { stage: 'third', round: nextRound, roundName: 'Disputa de 3º lugar', homeId: losers[0], awayId: losers[1] }));
    }
  }
}

function updateLeagueChampion(tournament) {
  if (tournament.format === 'league' && allLeagueMatchesPlayed(tournament)) tournament.championId = standings(tournament)[0]?.id || null;
}

function generateMixedKnockout(tournament) {
  if (tournament.format !== 'mixed') throw new Error('Este campeonato não possui fase mista.');
  if (tournament.knockoutState.started) throw new Error('O mata-mata já foi gerado.');
  if (!allLeagueMatchesPlayed(tournament)) throw new Error('Registre todos os jogos da liga antes de gerar o mata-mata.');
  const qualified = standings(tournament).slice(0, tournament.settings.qualifiers).map((row) => row.id);
  const pairing = tournament.settings.knockoutPairing || 'draw';
  beginKnockout(tournament, pairing === 'draw' ? shuffle(qualified) : qualified, pairing);
}

function rerollMixedKnockout(tournament) {
  if (tournament.format !== 'mixed' || !tournament.knockoutState.started) throw new Error('O mata-mata ainda não foi gerado.');
  if (knockoutMatches(tournament).some((match) => match.played)) throw new Error('Não é possível refazer a chave depois de registrar um resultado do mata-mata.');
  tournament.matches = tournament.matches.filter((match) => match.stage === 'league');
  tournament.knockoutState = { started: false, currentRound: 0, pendingByes: [], initialByes: [], pairing: tournament.settings.knockoutPairing || 'draw', seeded: tournament.settings.knockoutPairing === 'seeded' };
  tournament.championId = null;
  generateMixedKnockout(tournament);
}

function rerollTournament(tournament) {
  if (playedMatches(tournament) > 0) throw new Error('Não é possível sortear novamente depois de registrar resultados.');
  tournament.championId = null;
  if (tournament.format === 'league' || tournament.format === 'mixed') {
    tournament.matches = createRoundRobin(shuffle(tournament.participants.map((item) => item.id)), tournament.settings.leagueLegs, tournament);
    tournament.knockoutState = { started: false, currentRound: 0, pendingByes: [], initialByes: [], pairing: tournament.settings.knockoutPairing || 'draw', seeded: tournament.settings.knockoutPairing === 'seeded' };
  } else {
    tournament.matches = [];
    beginKnockout(tournament, shuffle(tournament.participants.map((item) => item.id)), 'draw');
  }
}

function renderTournamentDetail() {
  const tournament = tournamentById(state.activeTournamentId);
  if (!tournament) { state.activeTournamentId = null; renderTournamentsView(); return; }
  updateLeagueChampion(tournament);
  updateTournamentStatus(tournament);
  const profile = getGameProfile(tournament);

  $('#view-tournaments').innerHTML = `
    <div class="tournament-detail-shell ${gameProfileClass(tournament)}">
    <div class="detail-head">
      <div class="detail-game-mark"><span>${profile.icon}</span><b>${profile.short}</b></div>
      <div class="detail-title-copy">
        <button class="button small ghost" data-back-list>← Voltar aos campeonatos</button>
        <div class="game-kicker">${escapeHtml(profile.label)} · ${formatLabel(tournament.format)}</div>
        <h2>${escapeHtml(tournament.name)}</h2>
        <div class="detail-meta"><span class="format-badge">${modeLabel(tournament.mode)}</span><span class="format-badge">${tournament.participants.length} participantes</span><span class="format-badge">${playedMatches(tournament)}/${playableMatches(tournament)} jogos</span></div>
      </div>
      <div class="detail-actions">
        ${playedMatches(tournament) === 0 ? '<button class="button secondary" data-reroll>Sortear novamente</button>' : ''}
        ${tournament.format === 'mixed' && tournament.knockoutState.started && !knockoutMatches(tournament).some((match) => match.played) && tournament.settings.knockoutPairing === 'draw' ? '<button class="button secondary" data-reroll-knockout>Refazer sorteio do mata-mata</button>' : ''}
        <button class="button danger" data-delete-tournament>Excluir</button>
      </div>
    </div>
    ${tournament.championId ? `<div class="champion-banner"><div><span>CAMPEÃO DO CAMPEONATO</span><strong>${escapeHtml(participantName(tournament,tournament.championId))}</strong></div><span>${profile.icon} ${profile.label}</span></div>` : ''}
    <div class="detail-grid">
      <aside class="panel detail-menu">
        ${tournament.format !== 'knockout' ? detailTabButton('standings','Classificação') : ''}
        ${tournament.format !== 'league' ? detailTabButton('bracket','Mata-mata') : ''}
        ${detailTabButton('matches','Partidas')}
        ${detailTabButton('statistics','Estatísticas')}
        ${detailTabButton('settings','Configuração')}
      </aside>
      <div class="detail-content">${detailTabHtml(tournament)}</div>
    </div>
    </div>`;

  $('[data-back-list]').addEventListener('click', () => { state.activeTournamentId = null; renderTournamentsView(); });
  $$('[data-detail-tab]').forEach((button) => button.addEventListener('click', () => { state.detailTab = button.dataset.detailTab; renderTournamentDetail(); }));
  $$('[data-edit-match]').forEach((button) => button.addEventListener('click', () => openMatchModal(tournament.id, button.dataset.editMatch)));
  $('[data-generate-knockout]')?.addEventListener('click', async () => {
    try { generateMixedKnockout(tournament); await persistTournament(tournament); state.detailTab = 'bracket'; renderTournamentDetail(); toast('Mata-mata gerado com os classificados.', 'success'); }
    catch (error) { toast(error.message, 'error'); }
  });
  $('[data-reroll]')?.addEventListener('click', async () => {
    if (!confirm('Sortear novamente todos os confrontos?')) return;
    try { rerollTournament(tournament); await persistTournament(tournament); renderTournamentDetail(); toast('Novo sorteio realizado.', 'success'); }
    catch (error) { toast(error.message, 'error'); }
  });
  $('[data-reroll-knockout]')?.addEventListener('click', async () => {
    if (!confirm('Refazer somente o sorteio do mata-mata? Os resultados da liga serão mantidos.')) return;
    try { rerollMixedKnockout(tournament); await persistTournament(tournament); renderTournamentDetail(); toast('Mata-mata sorteado novamente.', 'success'); }
    catch (error) { toast(error.message, 'error'); }
  });
  $('[data-delete-tournament]').addEventListener('click', async () => {
    if (!confirm(`Excluir definitivamente o campeonato “${tournament.name}”?`)) return;
    try { await removeTournament(tournament.id); toast('Campeonato excluído.', 'success'); }
    catch (error) { toast(error.message, 'error'); }
  });
}

function detailTabButton(tab, label) {
  return `<button class="${state.detailTab === tab ? 'active' : ''}" data-detail-tab="${tab}">${label}</button>`;
}

function detailTabHtml(tournament) {
  if (state.detailTab === 'standings') return standingsTabHtml(tournament);
  if (state.detailTab === 'bracket') return bracketTabHtml(tournament);
  if (state.detailTab === 'statistics' || state.detailTab === 'participants') return statisticsTabHtml(tournament);
  if (state.detailTab === 'settings') return settingsTabHtml(tournament);
  return matchesTabHtml(tournament);
}

function matchesTabHtml(tournament) {
  const groups = groupMatchesForDisplay(tournament.matches);
  const leagueDone = tournament.format === 'mixed' && allLeagueMatchesPlayed(tournament) && !tournament.knockoutState.started;
  return `<div class="stack">
    ${tournament.format === 'mixed' && !tournament.knockoutState.started ? `<div class="notice ${leagueDone ? 'success' : 'info'}">${leagueDone ? `Liga concluída. Os ${tournament.settings.qualifiers} primeiros estão prontos para o mata-mata por ${tournament.settings.knockoutPairing === 'seeded' ? 'melhor contra pior' : 'sorteio livre'}.` : `Fase classificatória em andamento. Os ${tournament.settings.qualifiers} primeiros avançam.`}${leagueDone ? ' <button class="button small primary" data-generate-knockout style="margin-left:10px">Gerar mata-mata</button>' : ''}</div>` : ''}
    ${groups.map(({ key, label, matches }) => `<section class="round-section"><div class="round-head"><strong>${escapeHtml(label)}</strong><span>${matches.filter((match) => match.played).length}/${matches.length} registrados</span></div>${matches.map((match,index) => matchRowHtml(tournament,match,index)).join('')}</section>`).join('') || '<div class="notice">Nenhum jogo criado.</div>'}
  </div>`;
}

function groupMatchesForDisplay(matches) {
  const map = new Map();
  for (const match of matches) {
    const stageOrder = match.stage === 'league' ? 1 : match.stage === 'knockout' ? 2 : 3;
    const key = `${stageOrder}:${match.stage}:${match.round}:${match.roundName}`;
    if (!map.has(key)) map.set(key, { key, label: match.roundName, matches: [] });
    map.get(key).matches.push(match);
  }
  return [...map.values()].sort((a,b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

function matchRowHtml(tournament, match, index) {
  const home = participantName(tournament, match.homeId);
  const away = participantName(tournament, match.awayId);
  const profile = getGameProfile(tournament);
  return `<div class="match-row ${match.played ? 'played' : ''} ${match.isBye ? 'bye' : ''}">
    <div class="match-code">J${String(index + 1).padStart(2,'0')}</div>
    <div class="match-side"><strong>${escapeHtml(home)}</strong>${match.homeChoice ? `<small>${escapeHtml(match.homeChoice)}</small>` : ''}</div>
    <div class="match-score"><span>${match.played ? match.homeScore : '—'}</span><small>${profile.scoreShort}</small></div>
    <div class="match-vs">×</div>
    <div class="match-score"><span>${match.played ? match.awayScore : '—'}</span><small>${profile.scoreShort}</small></div>
    <div class="match-side away"><strong>${escapeHtml(away)}</strong>${match.awayChoice ? `<small>${escapeHtml(match.awayChoice)}</small>` : ''}</div>
    <div class="match-status"><button class="button small ${match.played ? 'secondary' : 'primary'}" data-edit-match="${match.id}">${match.played ? 'Editar' : 'Registrar'}</button></div>
  </div>`;
}

function standingsTabHtml(tournament) {
  const rows = standings(tournament);
  const qualifiers = tournament.format === 'mixed' ? tournament.settings.qualifiers : 0;
  const profile = getGameProfile(tournament);
  return `<div class="panel standings-panel ${gameProfileClass(tournament)}"><div class="panel-head standings-title"><div><span class="panel-kicker">TABELA DA COMPETIÇÃO</span><h3>Classificação</h3><p>${tournament.format === 'mixed' ? `Os ${qualifiers} primeiros avançam ao mata-mata.` : 'Tabela completa da liga.'}</p></div><div class="legend"><span class="legend-qualified"></span> Zona de classificação</div></div><div class="table-wrap"><table class="stats-table standings-table"><thead><tr><th>#</th><th>Participante</th><th class="num">J</th><th class="num">V</th><th class="num">E</th><th class="num">D</th><th class="num">${profile.scoreShort}+</th><th class="num">${profile.scoreShort}-</th><th class="num">SALDO</th><th class="num">PTS</th></tr></thead><tbody>${rows.map((row,index) => `<tr class="${qualifiers && index < qualifiers ? 'qualified' : ''} ${qualifiers && index === qualifiers - 1 ? 'cut-line' : ''}"><td class="rank"><span>${index + 1}</span></td><td><strong>${escapeHtml(participantName(tournament,row.id))}</strong></td><td class="num">${row.pj}</td><td class="num win-cell">${row.v}</td><td class="num">${row.e}</td><td class="num loss-cell">${row.d}</td><td class="num">${row.gp}</td><td class="num">${row.gc}</td><td class="num">${row.sg}</td><td class="num points-cell"><strong>${row.pts}</strong></td></tr>`).join('')}</tbody></table></div></div>`;
}

function bracketTabHtml(tournament) {
  if (!tournament.knockoutState.started) {
    const pairingLabel = tournament.settings.knockoutPairing === 'seeded' ? 'melhor contra pior' : 'sorteio livre';
    return `<div class="panel empty-state"><div class="empty-state-inner"><div class="empty-symbol">◇</div><h2>Mata-mata ainda não gerado</h2><p>Finalize a liga. Depois, os ${tournament.settings.qualifiers} primeiros entrarão na chave por ${pairingLabel}.</p>${allLeagueMatchesPlayed(tournament) ? '<button class="button primary" data-generate-knockout>Gerar mata-mata</button>' : ''}</div></div>`;
  }
  const rounds = [...new Set(knockoutMatches(tournament).map((match) => match.bracketRound))].sort((a,b) => a-b);
  const initialByes = tournament.knockoutState.initialByes || [];
  const pairingLabel = tournament.knockoutState.pairing === 'seeded' ? 'Melhor contra pior' : 'Sorteio livre';
  return `<div class="stack">
    <div class="bracket-summary">
      <div><span>MÉTODO DA CHAVE</span><strong>${pairingLabel}</strong></div>
      <div><span>CLASSIFICADOS</span><strong>${tournament.format === 'mixed' ? tournament.settings.qualifiers : tournament.participants.length}</strong></div>
      <div><span>FOLGAS INICIAIS</span><strong>${initialByes.length}</strong></div>
    </div>
    ${initialByes.length ? `<div class="bye-strip"><div><strong>Folgas da rodada preliminar</strong><span>Estes participantes já estão garantidos na fase seguinte.</span></div><div class="bye-list">${initialByes.map((id) => `<span class="bye-chip">${escapeHtml(participantName(tournament,id))}<b>FOLGA</b></span>`).join('')}</div></div>` : ''}
    <div class="bracket">${rounds.map((round) => {
      const matches = knockoutMatches(tournament).filter((match) => match.bracketRound === round);
      return `<div class="bracket-column"><div class="bracket-round-title"><span>FASE ${String(round).padStart(2,'0')}</span><h4>${escapeHtml(matches[0]?.roundName || `Rodada ${round}`)}</h4></div>${matches.map((match) => bracketMatchHtml(tournament,match)).join('')}</div>`;
    }).join('')}${tournament.matches.some((match) => match.stage === 'third') ? `<div class="bracket-column"><div class="bracket-round-title"><span>EXTRA</span><h4>3º lugar</h4></div>${tournament.matches.filter((match) => match.stage === 'third').map((match) => bracketMatchHtml(tournament,match)).join('')}</div>` : ''}</div>
  </div>`;
}
function bracketMatchHtml(tournament, match) {
  const winner = matchWinner(match);
  const profile = getGameProfile(tournament);
  return `<button class="bracket-match" data-edit-match="${match.id}">
    <div class="bracket-side ${winner === match.homeId ? 'winner' : ''}"><span><b>${escapeHtml(participantName(tournament,match.homeId))}</b>${match.homeChoice ? `<small>${escapeHtml(match.homeChoice)}</small>` : ''}</span><span>${match.played ? match.homeScore : '—'}<small>${profile.scoreShort}</small></span></div>
    <div class="bracket-side ${winner === match.awayId ? 'winner' : ''}"><span><b>${escapeHtml(participantName(tournament,match.awayId))}</b>${match.awayChoice ? `<small>${escapeHtml(match.awayChoice)}</small>` : ''}</span><span>${match.played ? match.awayScore : '—'}<small>${profile.scoreShort}</small></span></div>
  </button>`;
}

function playerStats(tournament) {
  const profile = getGameProfile(tournament);
  const rows = new Map();
  for (const participant of tournament.participants) {
    for (const player of participant.players) rows.set(player.id, { id: player.id, name: player.name, team: participant.name, pj:0,v:0,e:0,d:0,gp:0,gc:0,sg:0,mvp:0,kills:0,deaths:0,assists:0 });
  }
  for (const match of tournament.matches) {
    if (!match.played) continue;
    const homeScore = Number(match.homeScore || 0);
    const awayScore = Number(match.awayScore || 0);
    const winner = matchWinner(match);
    const homeResult = winner === match.homeId ? 'v' : winner === match.awayId ? 'd' : 'e';
    const awayResult = winner === match.awayId ? 'v' : winner === match.homeId ? 'd' : 'e';
    for (const id of match.homeLineup || []) {
      const row = rows.get(id); if (!row) continue;
      row.pj += 1; row[homeResult] += 1; row.gp += homeScore; row.gc += awayScore;
      if (profile.id === 'lol') { row.kills += homeScore; row.deaths += Number(match.homeDeaths || 0); row.assists += Number(match.homeAssists || 0); }
    }
    for (const id of match.awayLineup || []) {
      const row = rows.get(id); if (!row) continue;
      row.pj += 1; row[awayResult] += 1; row.gp += awayScore; row.gc += homeScore;
      if (profile.id === 'lol') { row.kills += awayScore; row.deaths += Number(match.awayDeaths || 0); row.assists += Number(match.awayAssists || 0); }
    }
    if (match.mvpPlayerId && rows.has(match.mvpPlayerId)) rows.get(match.mvpPlayerId).mvp += 1;
  }
  for (const row of rows.values()) {
    row.sg = row.gp - row.gc;
    row.winRate = row.pj ? (row.v / row.pj) * 100 : 0;
    row.kda = profile.id === 'lol' ? (row.kills + row.assists) / Math.max(1, row.deaths) : 0;
  }
  return [...rows.values()].sort((a,b) => b.v-a.v || b.winRate-a.winRate || b.gp-a.gp || b.mvp-a.mvp || a.name.localeCompare(b.name));
}

function choiceStatistics(tournament) {
  const profile = getGameProfile(tournament);
  const map = new Map();
  const add = (name, side, match) => {
    const key = String(name || '').trim();
    if (!key) return;
    if (!map.has(key)) map.set(key, { name:key, picks:0,wins:0,losses:0,draws:0,scoreFor:0,scoreAgainst:0,kills:0,deaths:0,assists:0 });
    const row = map.get(key);
    const ownId = side === 'home' ? match.homeId : match.awayId;
    const ownScore = Number(side === 'home' ? match.homeScore : match.awayScore) || 0;
    const oppScore = Number(side === 'home' ? match.awayScore : match.homeScore) || 0;
    const winner = matchWinner(match);
    row.picks += 1;
    row.scoreFor += ownScore;
    row.scoreAgainst += oppScore;
    if (winner === ownId) row.wins += 1;
    else if (winner) row.losses += 1;
    else row.draws += 1;
    if (profile.id === 'lol') {
      row.kills += ownScore;
      row.deaths += Number(side === 'home' ? match.homeDeaths : match.awayDeaths) || 0;
      row.assists += Number(side === 'home' ? match.homeAssists : match.awayAssists) || 0;
    }
  };
  for (const match of tournament.matches.filter((item) => item.played)) {
    add(match.homeChoice, 'home', match);
    add(match.awayChoice, 'away', match);
  }
  return [...map.values()].map((row) => ({
    ...row,
    winRate: row.picks ? (row.wins / row.picks) * 100 : 0,
    kda: profile.id === 'lol' ? (row.kills + row.assists) / Math.max(1,row.deaths) : 0
  })).sort((a,b) => b.picks-a.picks || b.wins-a.wins || a.name.localeCompare(b.name));
}

function tournamentRecords(tournament) {
  const played = tournament.matches.filter((match) => match.played && !match.isBye);
  const profile = getGameProfile(tournament);
  const totalScore = played.reduce((sum,match) => sum + Number(match.homeScore || 0) + Number(match.awayScore || 0),0);
  const biggest = [...played].sort((a,b) => Math.abs(Number(b.homeScore)-Number(b.awayScore)) - Math.abs(Number(a.homeScore)-Number(a.awayScore)))[0] || null;
  const highest = [...played].sort((a,b) => (Number(b.homeScore)+Number(b.awayScore)) - (Number(a.homeScore)+Number(a.awayScore)))[0] || null;
  const mvpCounts = new Map();
  for (const match of played) if (match.mvpPlayerId) mvpCounts.set(match.mvpPlayerId,(mvpCounts.get(match.mvpPlayerId)||0)+1);
  const topMvp = [...mvpCounts.entries()].sort((a,b)=>b[1]-a[1])[0];
  let topMvpName = '—';
  if (topMvp) {
    for (const participant of tournament.participants) {
      const player = participant.players.find((item) => item.id === topMvp[0]);
      if (player) topMvpName = `${player.name} (${topMvp[1]})`;
    }
  }
  const finishCounts = new Map();
  for (const match of played) if (match.finishType) finishCounts.set(match.finishType,(finishCounts.get(match.finishType)||0)+1);
  const topFinish = [...finishCounts.entries()].sort((a,b)=>b[1]-a[1])[0];
  return {
    played,
    totalScore,
    average: played.length ? totalScore / played.length : 0,
    biggest,
    highest,
    topMvpName,
    topFinish: topFinish ? `${topFinish[0]} (${topFinish[1]})` : '—',
    profile
  };
}

function matchRecordName(tournament, match) {
  if (!match) return '—';
  return `${participantName(tournament,match.homeId)} ${match.homeScore} × ${match.awayScore} ${participantName(tournament,match.awayId)}`;
}

function statisticsTabHtml(tournament) {
  const profile = getGameProfile(tournament);
  const records = tournamentRecords(tournament);
  const choices = choiceStatistics(tournament);
  const players = playerStats(tournament);
  const mostChosen = choices[0];
  const leastChosen = choices.length ? [...choices].sort((a,b)=>a.picks-b.picks || a.name.localeCompare(b.name))[0] : null;
  const bestChoice = choices.length ? [...choices].sort((a,b)=>b.winRate-a.winRate || b.wins-a.wins || b.picks-a.picks)[0] : null;
  return `<div class="stats-dashboard ${gameProfileClass(tournament)}">
    <div class="stats-hero">
      <div><span class="panel-kicker">CENTRAL DE DADOS · ${profile.short}</span><h3>Estatísticas do campeonato</h3><p>Todos os números abaixo são calculados somente com as partidas desta competição.</p></div>
      <div class="stats-hero-icon">${profile.icon}</div>
    </div>
    <div class="record-grid">
      ${recordCard('Partidas realizadas',records.played.length,`${playableMatches(tournament)-records.played.length} restantes`,'▦')}
      ${recordCard(`${profile.scoreLabel} totais`,records.totalScore,`Média ${records.average.toFixed(1)} por jogo`,'Σ')}
      ${recordCard('Maior diferença',records.biggest ? Math.abs(Number(records.biggest.homeScore)-Number(records.biggest.awayScore)) : '—',matchRecordName(tournament,records.biggest),'↗')}
      ${recordCard('Jogo com maior total',records.highest ? Number(records.highest.homeScore)+Number(records.highest.awayScore) : '—',matchRecordName(tournament,records.highest),'★')}
      ${recordCard('Mais MVPs',records.topMvpName,'Destaque individual','M')}
      ${profile.id === 'beyblade' ? recordCard('Finalização mais comum',records.topFinish,'Batalhas registradas','◎') : recordCard(`${profile.choiceLabel} mais frequente`,mostChosen?.name || '—',mostChosen ? `${mostChosen.picks} escolha(s)` : 'Sem dados',profile.id === 'fifa' ? '⚽' : '◈')}
    </div>
    <div class="stats-columns">
      <section class="panel analytics-panel">
        <div class="panel-head"><div><span class="panel-kicker">META DO JOGO</span><h3>${profile.choicePlural} utilizados</h3><p>Escolhas, resultados e rendimento dentro deste campeonato.</p></div></div>
        <div class="analytics-summary">
          <div><span>Mais escolhido</span><strong>${escapeHtml(mostChosen?.name || '—')}</strong></div>
          <div><span>Menos escolhido</span><strong>${escapeHtml(leastChosen?.name || '—')}</strong></div>
          <div><span>Melhor aproveitamento</span><strong>${escapeHtml(bestChoice?.name || '—')}</strong><small>${bestChoice ? `${bestChoice.winRate.toFixed(1)}%` : ''}</small></div>
        </div>
        <div class="table-wrap"><table class="stats-table"><thead><tr><th>${profile.id === 'fifa' ? 'Time' : profile.id === 'lol' ? 'Campeão' : 'Beyblade'}</th><th class="num">ESC</th><th class="num">V</th><th class="num">D</th><th class="num">WR</th>${profile.id === 'lol' ? '<th class="num">K</th><th class="num">D</th><th class="num">A</th><th class="num">KDA</th>' : `<th class="num">${profile.scoreShort}+</th><th class="num">${profile.scoreShort}-</th>`}</tr></thead><tbody>${choices.length ? choices.map((row)=>`<tr><td><strong>${escapeHtml(row.name)}</strong></td><td class="num">${row.picks}</td><td class="num win-cell">${row.wins}</td><td class="num loss-cell">${row.losses}</td><td class="num"><strong>${row.winRate.toFixed(1)}%</strong></td>${profile.id === 'lol' ? `<td class="num">${row.kills}</td><td class="num">${row.deaths}</td><td class="num">${row.assists}</td><td class="num">${row.kda.toFixed(2)}</td>` : `<td class="num">${row.scoreFor}</td><td class="num">${row.scoreAgainst}</td>`}</tr>`).join('') : `<tr><td colspan="9" class="empty-cell">Registre partidas e informe ${profile.choiceLabel.toLowerCase()} para gerar este ranking.</td></tr>`}</tbody></table></div>
      </section>
      <section class="panel analytics-panel">
        <div class="panel-head"><div><span class="panel-kicker">DESEMPENHO</span><h3>Jogadores</h3><p>Campanha individual somente neste campeonato.</p></div></div>
        <div class="table-wrap"><table class="stats-table"><thead><tr><th>Jogador</th>${tournament.mode === 'teams' ? '<th>Equipe</th>' : ''}<th class="num">J</th><th class="num">V</th><th class="num">D</th><th class="num">WR</th>${profile.id === 'lol' ? '<th class="num">K</th><th class="num">D</th><th class="num">A</th><th class="num">KDA</th>' : `<th class="num">${profile.scoreShort}+</th><th class="num">${profile.scoreShort}-</th>`}<th class="num">MVP</th></tr></thead><tbody>${players.map((row)=>`<tr><td><strong>${escapeHtml(row.name)}</strong></td>${tournament.mode === 'teams' ? `<td>${escapeHtml(row.team)}</td>` : ''}<td class="num">${row.pj}</td><td class="num win-cell">${row.v}</td><td class="num loss-cell">${row.d}</td><td class="num">${row.winRate.toFixed(1)}%</td>${profile.id === 'lol' ? `<td class="num">${row.kills}</td><td class="num">${row.deaths}</td><td class="num">${row.assists}</td><td class="num">${row.kda.toFixed(2)}</td>` : `<td class="num">${row.gp}</td><td class="num">${row.gc}</td>`}<td class="num">${row.mvp}</td></tr>`).join('')}</tbody></table></div>
      </section>
    </div>
    <section class="panel"><div class="panel-head"><div><span class="panel-kicker">ELENCO</span><h3>Participantes do campeonato</h3></div></div><div class="panel-body"><div class="participant-roster">${tournament.participants.map((participant,index)=>`<div class="roster-card"><span>${String(index+1).padStart(2,'0')}</span><div><strong>${escapeHtml(participant.name)}</strong>${tournament.mode === 'teams' ? `<small>${participant.players.map((p)=>escapeHtml(p.name)).join(' · ')}</small>` : ''}</div></div>`).join('')}</div></div></section>
  </div>`;
}

function recordCard(label,value,sub,icon) {
  return `<article class="record-card"><span class="record-icon">${icon}</span><div><span>${label}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(sub)}</small></div></article>`;
}

function settingsTabHtml(tournament) {
  const profile = getGameProfile(tournament);
  return `<div class="panel"><div class="panel-head"><div><h3>Configuração do campeonato</h3><p>Resumo das regras usadas na geração.</p></div></div><div class="panel-body"><table class="stats-table"><tbody>
    <tr><td>Jogo</td><td class="num"><strong>${profile.icon} ${escapeHtml(profile.label)}</strong></td></tr>
    <tr><td>Placar registrado</td><td class="num">${profile.scoreLabel}</td></tr>
    <tr><td>Informação por lado</td><td class="num">${profile.choiceLabel}</td></tr>
    <tr><td>Formato</td><td class="num"><strong>${formatLabel(tournament.format)}</strong></td></tr>
    <tr><td>Modo</td><td class="num">${modeLabel(tournament.mode)}</td></tr>
    <tr><td>Participantes</td><td class="num">${tournament.participants.length}</td></tr>
    ${tournament.format !== 'knockout' ? `<tr><td>Turnos da liga</td><td class="num">${tournament.settings.leagueLegs}</td></tr><tr><td>Pontos por vitória</td><td class="num">${tournament.settings.pointsWin}</td></tr><tr><td>Pontos por empate</td><td class="num">${tournament.settings.pointsDraw}</td></tr>` : ''}
    ${tournament.format === 'mixed' ? `<tr><td>Classificados</td><td class="num">${tournament.settings.qualifiers}</td></tr><tr><td>Cruzamento do mata-mata</td><td class="num">${tournament.settings.knockoutPairing === 'seeded' ? 'Melhor contra pior' : 'Sorteio livre'}</td></tr><tr><td>Estrutura da chave</td><td class="num">${tournament.settings.bracketMode === 'complete' ? 'Completa, sem folgas' : 'Adaptada'}</td></tr>` : ''}
  </tbody></table></div></div>`;
}

function matchGameFieldsHtml(tournament, match, home, away, knockout) {
  const profile = getGameProfile(tournament);
  if (profile.id === 'lol') {
    return `<div class="versus-form game-lol">
      ${lolSideForm('home',home,match.homeChoice,match.homeScore,match.homeDeaths,match.homeAssists)}
      <div class="versus-divider"><span>VS</span></div>
      ${lolSideForm('away',away,match.awayChoice,match.awayScore,match.awayDeaths,match.awayAssists)}
    </div>
    <label class="field winner-field"><span>Vencedor da partida</span><select id="manualWinner" required><option value="">Selecione o vencedor</option><option value="${home.id}" ${match.winnerId === home.id ? 'selected' : ''}>${escapeHtml(home.name)}</option><option value="${away.id}" ${match.winnerId === away.id ? 'selected' : ''}>${escapeHtml(away.name)}</option></select><small>Kills não definem obrigatoriamente o vencedor; por isso ele é informado separadamente.</small></label>`;
  }
  if (profile.id === 'beyblade') {
    return `<div class="versus-form game-beyblade">
      ${basicSideForm('home',home,profile,match.homeChoice,match.homeScore)}
      <div class="versus-divider"><span>VS</span></div>
      ${basicSideForm('away',away,profile,match.awayChoice,match.awayScore)}
    </div>
    <div class="grid cols-2"><label class="field"><span>Vencedor da batalha</span><select id="manualWinner" required><option value="">Selecione o vencedor</option><option value="${home.id}" ${match.winnerId === home.id ? 'selected' : ''}>${escapeHtml(home.name)}</option><option value="${away.id}" ${match.winnerId === away.id ? 'selected' : ''}>${escapeHtml(away.name)}</option></select></label><label class="field"><span>Tipo de finalização</span><select id="finishType"><option value="">Não informado</option>${profile.finishTypes.map((type)=>`<option value="${type}" ${match.finishType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label></div>`;
  }
  return `<div class="versus-form game-fifa">
    ${basicSideForm('home',home,profile,match.homeChoice,match.homeScore)}
    <div class="versus-divider"><span>VS</span></div>
    ${basicSideForm('away',away,profile,match.awayChoice,match.awayScore)}
  </div>
  ${knockout ? `<label class="field winner-field"><span>Vencedor em caso de empate</span><select id="manualWinner"><option value="">Definir pelo placar</option><option value="${home.id}" ${match.winnerId === home.id ? 'selected' : ''}>${escapeHtml(home.name)}</option><option value="${away.id}" ${match.winnerId === away.id ? 'selected' : ''}>${escapeHtml(away.name)}</option></select></label>` : ''}`;
}

function basicSideForm(side, participant, profile, choice, score) {
  return `<section class="side-form"><div class="side-form-head"><span>${side === 'home' ? 'LADO A' : 'LADO B'}</span><strong>${escapeHtml(participant.name)}</strong></div><label class="field"><span>${profile.choiceLabel}</span><input id="${side}Choice" value="${escapeHtml(choice || '')}" placeholder="Digite ${profile.choiceLabel.toLowerCase()}"></label><label class="field score-input"><span>${profile.scoreLabel}</span><input id="${side}Score" type="number" min="0" value="${score ?? ''}" required></label></section>`;
}

function lolSideForm(side, participant, champion, kills, deaths, assists) {
  return `<section class="side-form"><div class="side-form-head"><span>${side === 'home' ? 'LADO AZUL' : 'LADO VERMELHO'}</span><strong>${escapeHtml(participant.name)}</strong></div><label class="field"><span>Campeão utilizado</span><input id="${side}Choice" value="${escapeHtml(champion || '')}" placeholder="Ex.: Akali"></label><div class="kda-inputs"><label class="field"><span>Kills</span><input id="${side}Score" type="number" min="0" value="${kills ?? ''}" required></label><label class="field"><span>Mortes</span><input id="${side}Deaths" type="number" min="0" value="${deaths ?? 0}" required></label><label class="field"><span>Assistências</span><input id="${side}Assists" type="number" min="0" value="${assists ?? 0}" required></label></div></section>`;
}

function openMatchModal(tournamentId, matchId) {
  const tournament = tournamentById(tournamentId);
  const match = tournament?.matches.find((item) => item.id === matchId);
  if (!tournament || !match) return;
  const home = participantById(tournament, match.homeId);
  const away = participantById(tournament, match.awayId);
  const knockout = match.stage === 'knockout' || match.stage === 'third';
  const possibleMvp = [...(home?.players || []), ...(away?.players || [])];
  const profile = getGameProfile(tournament);

  openModal(`
    <div class="modal-head game-${profile.id}"><div><div class="eyebrow">${profile.icon} ${escapeHtml(match.roundName)}</div><h2>Registrar partida de ${profile.label}</h2></div><button class="icon-button" data-close>×</button></div>
    <form id="matchForm">
      <div class="modal-body stack game-match-form ${gameProfileClass(tournament)}">
        ${matchGameFieldsHtml(tournament,match,home,away,knockout)}
        ${tournament.mode === 'teams' ? `<div class="grid cols-2">${lineupHtml(home,match.homeLineup,'home')}${lineupHtml(away,match.awayLineup,'away')}</div>` : ''}
        <div class="grid cols-2"><label class="field"><span>MVP da partida</span><select id="matchMvp"><option value="">Nenhum</option>${possibleMvp.map((player) => `<option value="${player.id}" ${match.mvpPlayerId === player.id ? 'selected' : ''}>${escapeHtml(player.name)}</option>`).join('')}</select></label><label class="field"><span>Observações</span><textarea id="matchNotes" placeholder="Anotações opcionais sobre a partida">${escapeHtml(match.notes || '')}</textarea></label></div>
      </div>
      <div class="modal-foot"><div>${match.played ? '<button class="button danger" type="button" data-clear-result>Limpar resultado</button>' : ''}</div><div style="display:flex;gap:8px"><button class="button ghost" type="button" data-close>Cancelar</button><button class="button primary" type="submit">Salvar resultado</button></div></div>
    </form>`,'wide');

  $$('[data-close]').forEach((button) => button.addEventListener('click', closeModal));
  $('[data-clear-result]')?.addEventListener('click', async () => {
    if (!confirm('Limpar este resultado? Fases posteriores do mata-mata também poderão ser removidas.')) return;
    if (match.stage === 'league' && tournament.format === 'mixed' && tournament.knockoutState.started) resetMixedKnockout(tournament);
    clearMatchResult(tournament, match);
    try { await persistTournament(tournament); closeModal(); renderTournamentDetail(); toast('Resultado removido.', 'success'); }
    catch (error) { toast(error.message, 'error'); }
  });
  $('#matchForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const homeScore = Number($('#homeScore').value);
    const awayScore = Number($('#awayScore').value);
    let winnerId = null;
    if (profile.id === 'fifa') {
      winnerId = homeScore > awayScore ? home.id : awayScore > homeScore ? away.id : null;
      if (knockout && homeScore === awayScore) winnerId = $('#manualWinner')?.value || null;
      if (knockout && !winnerId) return toast('Em mata-mata, selecione o vencedor quando houver empate.', 'error');
    } else {
      winnerId = $('#manualWinner')?.value || null;
      if (!winnerId) return toast('Selecione o vencedor da partida.', 'error');
    }

    if (match.stage === 'league' && tournament.format === 'mixed' && tournament.knockoutState.started) {
      if (!confirm('Alterar a fase de liga removerá o mata-mata já gerado. Continuar?')) return;
      resetMixedKnockout(tournament);
    }
    if (match.stage === 'knockout') truncateKnockoutAfter(tournament, match.bracketRound);
    match.homeScore = homeScore;
    match.awayScore = awayScore;
    match.winnerId = winnerId;
    match.played = true;
    match.homeChoice = $('#homeChoice').value.trim();
    match.awayChoice = $('#awayChoice').value.trim();
    match.homeDeaths = Number($('#homeDeaths')?.value || 0);
    match.awayDeaths = Number($('#awayDeaths')?.value || 0);
    match.homeAssists = Number($('#homeAssists')?.value || 0);
    match.awayAssists = Number($('#awayAssists')?.value || 0);
    match.finishType = $('#finishType')?.value || '';
    match.mvpPlayerId = $('#matchMvp').value;
    match.notes = $('#matchNotes').value.trim();
    if (tournament.mode === 'teams') {
      match.homeLineup = $$('[name="homeLineup"]:checked').map((input) => input.value);
      match.awayLineup = $$('[name="awayLineup"]:checked').map((input) => input.value);
      if (!match.homeLineup.length || !match.awayLineup.length) return toast('Selecione pelo menos um jogador em cada escalação.', 'error');
    }
    updateLeagueChampion(tournament);
    if (match.stage === 'knockout') advanceKnockout(tournament);
    try {
      await persistTournament(tournament);
      closeModal();
      renderTournamentDetail();
      toast('Resultado salvo.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
}

function lineupHtml(participant, selected, side) {
  return `<div class="lineup-box"><h4>Escalação — ${escapeHtml(participant.name)}</h4><div class="check-list">${participant.players.map((player) => `<label class="check-row"><input type="checkbox" name="${side}Lineup" value="${player.id}" ${(selected || []).includes(player.id) ? 'checked' : ''}> ${escapeHtml(player.name)}</label>`).join('')}</div></div>`;
}

function truncateKnockoutAfter(tournament, round) {
  tournament.matches = tournament.matches.filter((match) => match.stage !== 'knockout' || (match.bracketRound || 0) <= round);
  tournament.matches = tournament.matches.filter((match) => match.stage !== 'third');
  tournament.championId = null;
}

function resetMixedKnockout(tournament) {
  tournament.matches = tournament.matches.filter((match) => match.stage === 'league');
  tournament.knockoutState = { started: false, currentRound: 0, pendingByes: [], initialByes: [], pairing: tournament.settings.knockoutPairing || 'draw', seeded: tournament.settings.knockoutPairing === 'seeded' };
  tournament.championId = null;
}

function clearMatchResult(tournament, match) {
  if (match.stage === 'knockout') truncateKnockoutAfter(tournament, match.bracketRound);
  Object.assign(match, { homeScore:null, awayScore:null, winnerId:null, played:false, homeChoice:'', awayChoice:'', homeDeaths:0, awayDeaths:0, homeAssists:0, awayAssists:0, finishType:'', mvpPlayerId:'', notes:'' });
  tournament.championId = null;
  updateLeagueChampion(tournament);
}

function renderImporter() {
  const configured = Boolean(state.config?.githubImporterConfigured);
  $('#view-importer').innerHTML = `<div class="panel"><div class="panel-head"><div><h2>Publicar ZIP no GitHub</h2><p>Atualiza o repositório e inicia automaticamente um novo deploy da Vercel.</p></div><span class="status ${configured ? 'finished' : ''}">${configured ? 'Configurado' : 'Não configurado'}</span></div><div class="panel-body stack">
    <label class="dropzone" id="dropzone"><input id="zipInput" type="file" accept=".zip,application/zip"><div class="empty-symbol">⇧</div><h3>Arraste o ZIP aqui</h3><p>Ou selecione o arquivo manualmente.</p><button class="button secondary" type="button" data-choose-zip>Selecionar ZIP</button></label>
    <div class="file-summary" id="fileSummary"></div>
    <div class="grid cols-2"><label class="field"><span>Mensagem do commit</span><input id="commitMessage" value="Atualização do Arena Maker"></label><label class="field"><span>Código de publicação</span><input id="publishCode" type="password" placeholder="PUBLISH_SECRET"></label></div>
    <label class="check-row"><input id="replaceRepo" type="checkbox"> Espelhar o repositório e apagar arquivos ausentes no ZIP</label>
    <div class="notice warning">Para atualizações normais, mantenha a opção de espelhamento desmarcada.</div>
    <div><button class="button primary" id="publishZip" ${configured ? '' : 'disabled'}>Fazer commit no GitHub</button></div>
  </div></div>`;

  const input = $('#zipInput');
  $('[data-choose-zip]').addEventListener('click', (event) => { event.preventDefault(); input.click(); });
  input.addEventListener('change', () => processZip(input.files[0]));
  const dropzone = $('#dropzone');
  ['dragenter','dragover'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (event) => processZip(event.dataTransfer.files[0]));
  $('#publishZip').addEventListener('click', publishZip);
}

async function processZip(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.zip')) return toast('Selecione um arquivo ZIP.', 'error');
  try {
    const zip = await JSZip.loadAsync(file);
    const files = [];
    let bytes = 0;
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || path.includes('__MACOSX/') || path.endsWith('.DS_Store')) continue;
      if (path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new Error(`Caminho inválido: ${path}`);
      const base64 = await entry.async('base64');
      const decoded = Math.floor(base64.length * 0.75);
      bytes += decoded;
      files.push({ path, content: base64 });
    }
    if (!files.length) throw new Error('O ZIP não contém arquivos válidos.');
    if (files.length > 400) throw new Error('O ZIP excede 400 arquivos.');
    if (bytes > 3_000_000) throw new Error('O ZIP extraído excede 3 MB.');
    state.zipPayload = { files, fileName: file.name, bytes };
    $('#fileSummary').classList.add('show');
    $('#fileSummary').innerHTML = `<strong>${escapeHtml(file.name)}</strong><p style="margin:6px 0 10px;color:var(--muted);font-size:.72rem">${files.length} arquivos · ${(bytes / 1024).toFixed(1)} KB extraídos</p><div class="progress"><span style="width:100%"></span></div>`;
    toast('ZIP pronto para publicação.', 'success');
  } catch (error) {
    state.zipPayload = null;
    toast(error.message, 'error');
  }
}

async function publishZip() {
  if (!state.zipPayload) return toast('Selecione um ZIP primeiro.', 'error');
  const code = $('#publishCode').value;
  if (!code) return toast('Informe o código de publicação.', 'error');
  const button = $('#publishZip');
  button.disabled = true;
  button.textContent = 'Publicando...';
  try {
    const response = await fetch('/api/github-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-publish-code': code },
      body: JSON.stringify({ files: state.zipPayload.files, replace: $('#replaceRepo').checked, message: $('#commitMessage').value.trim() || 'Atualização do Arena Maker' })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Falha ao publicar.');
    $('#fileSummary').innerHTML += `<div class="notice success" style="margin-top:12px">Commit criado com sucesso: <a href="${escapeHtml(result.commitUrl)}" target="_blank" rel="noopener" style="color:inherit">abrir no GitHub</a>.</div>`;
    toast('Commit criado. A Vercel iniciará o deploy.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Fazer commit no GitHub';
  }
}

init();
