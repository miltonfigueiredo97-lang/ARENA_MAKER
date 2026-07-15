const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));
const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

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
  tournament.version = tournament.version || 3;
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
    thirdPlace: tournament.settings?.thirdPlace ?? true
  };
  tournament.matches = (tournament.matches || []).map((match) => {
    const oldStage = String(match.stage || '').toLowerCase();
    const stage = oldStage.includes('mata') ? 'knockout' : oldStage.includes('3') ? 'third' : oldStage.includes('group') || oldStage.includes('grupo') || oldStage.includes('liga') ? 'league' : (match.bracketRound ? 'knockout' : match.stage || 'league');
    return {
      ...match,
      stage,
      roundName: match.roundName || match.label || (stage === 'league' ? `Rodada ${match.round || 1}` : stage === 'third' ? 'Disputa de 3º lugar' : knockoutRoundName(2 ** Math.max(1, (match.bracketRound || 1)))),
      homeLineup: match.homeLineup || participantById({ participants: tournament.participants }, match.homeId)?.players.map((player) => player.id) || [],
      awayLineup: match.awayLineup || participantById({ participants: tournament.participants }, match.awayId)?.players.map((player) => player.id) || []
    };
  });
  tournament.knockoutState = tournament.knockoutState || {
    started: tournament.format === 'knockout' || tournament.matches.some((match) => match.stage === 'knockout'),
    currentRound: Math.max(0, ...tournament.matches.filter((match) => match.stage === 'knockout').map((match) => match.bracketRound || 0)),
    pendingByes: [],
    seeded: tournament.format === 'mixed'
  };
  tournament.extraLabel = tournament.extraLabel || tournament.usageLabel || 'Escolha usada';
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

    <div class="panel">
      ${tournaments.length ? tournamentTableHtml(tournaments) : emptyTournamentsHtml(all.length > 0)}
    </div>`;

  $$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    renderTournamentsView();
  }));
  $$('[data-open-tournament]').forEach((button) => button.addEventListener('click', () => {
    state.activeTournamentId = button.dataset.openTournament;
    state.detailTab = 'matches';
    renderTournamentsView();
  }));
  $$('[data-create-tournament]').forEach((button) => button.addEventListener('click', openTournamentWizard));
}

function tournamentTableHtml(tournaments) {
  return `<div class="table-wrap"><table class="tournament-table">
    <thead><tr><th>Campeonato</th><th>Formato</th><th>Participantes</th><th>Fase atual</th><th>Progresso</th><th>Status</th><th></th></tr></thead>
    <tbody>${tournaments.map((tournament) => {
      const played = playedMatches(tournament);
      const total = playableMatches(tournament);
      const percent = total ? Math.round((played / total) * 100) : 0;
      return `<tr>
        <td class="tournament-name"><strong>${escapeHtml(tournament.name)}</strong><span>${escapeHtml(tournament.game || 'Jogo não informado')} · ${new Date(tournament.updatedAt || tournament.createdAt).toLocaleDateString('pt-BR')}</span></td>
        <td><span class="format-badge">${formatLabel(tournament.format)}</span></td>
        <td>${tournament.participants.length} ${tournament.mode === 'teams' ? 'equipes' : 'jogadores'}</td>
        <td>${escapeHtml(currentStageLabel(tournament))}</td>
        <td><div class="progress-line"><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div><div class="progress-copy">${played} de ${total} jogos registrados</div></div></td>
        <td><span class="status ${tournament.championId ? 'finished' : ''}">${tournament.championId ? 'Finalizado' : 'Em andamento'}</span></td>
        <td><div class="row-actions"><button class="button small secondary" data-open-tournament="${tournament.id}">Abrir</button></div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
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
    game: '',
    format: 'mixed',
    mode: 'individual',
    extraLabel: 'Escolha usada',
    entrants: [],
    teams: [newWizardTeam('Equipe 1'), newWizardTeam('Equipe 2')],
    leagueLegs: 1,
    pointsWin: 3,
    pointsDraw: 1,
    qualifiers: 8,
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
  openModal(`
    <div class="modal-head">
      <div><div class="eyebrow">NOVO CAMPEONATO</div><h2>Montar competição</h2></div>
      <button class="icon-button" data-close>×</button>
    </div>
    <div class="modal-body">
      <div class="wizard-layout">
        <aside class="wizard-steps">
          ${['Formato','Participantes','Regras','Revisão'].map((label, index) => `<div class="wizard-step ${wizard.step === index + 1 ? 'active' : ''}"><span class="step-number">${index + 1}</span><span>${label}</span></div>`).join('')}
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
      state.detailTab = 'matches';
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
  return `<h3>Formato principal</h3><p>Defina o tipo de competição. Os participantes serão adicionados somente no próximo passo e ficarão dentro deste campeonato.</p>
    <div class="stack">
      <div class="grid cols-2">
        <label class="field"><span>Nome do campeonato</span><input id="wizardName" value="${escapeHtml(wizard.name)}" placeholder="Ex.: Arena de sábado" autofocus></label>
        <label class="field"><span>Jogo</span><input id="wizardGame" value="${escapeHtml(wizard.game)}" placeholder="Ex.: League of Legends, FIFA, Tekken"></label>
      </div>
      <div class="choice-grid">
        ${formatChoice('league','Liga','Todos enfrentam todos. A classificação final define o campeão.',wizard.format)}
        ${formatChoice('knockout','Mata-mata','Confrontos eliminatórios. Quantidades irregulares recebem folgas automáticas.',wizard.format)}
        ${formatChoice('mixed','Liga + mata-mata','Todos jogam a liga e a quantidade escolhida de classificados avança.',wizard.format)}
      </div>
      <div class="grid cols-2">
        <label class="field"><span>Disputa</span><select id="wizardMode"><option value="individual" ${wizard.mode === 'individual' ? 'selected' : ''}>Individual</option><option value="teams" ${wizard.mode === 'teams' ? 'selected' : ''}>Por equipes</option></select></label>
        <label class="field"><span>Nome da informação extra por partida</span><input id="wizardExtraLabel" value="${escapeHtml(wizard.extraLabel)}" placeholder="Ex.: Campeão usado, time escolhido"></label>
      </div>
    </div>`;
}

function formatChoice(value, title, description, selected) {
  return `<label class="choice-card ${selected === value ? 'selected' : ''}" data-format-choice="${value}"><input type="radio" name="format" value="${value}" ${selected === value ? 'checked' : ''}><strong>${title}</strong><span>${description}</span></label>`;
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
  return `<h3>Regras e classificação</h3><p>Configure quantas partidas serão disputadas e, no formato misto, quantos participantes avançam ao mata-mata.</p>
    <div class="stack">
      ${wizard.format !== 'knockout' ? `<div class="grid cols-3">
        <label class="field"><span>Turnos da liga</span><select id="wizardLeagueLegs"><option value="1" ${wizard.leagueLegs === 1 ? 'selected' : ''}>Turno único</option><option value="2" ${wizard.leagueLegs === 2 ? 'selected' : ''}>Ida e volta</option></select></label>
        <label class="field"><span>Pontos por vitória</span><input id="wizardPointsWin" type="number" min="1" value="${wizard.pointsWin}"></label>
        <label class="field"><span>Pontos por empate</span><input id="wizardPointsDraw" type="number" min="0" value="${wizard.pointsDraw}"></label>
      </div>` : ''}
      ${wizard.format === 'mixed' ? `<div class="panel"><div class="panel-head"><div><h3>Classificados para o mata-mata</h3><p>Você pode usar 8, 16 ou qualquer outra quantidade entre 2 e ${participantCount}.</p></div></div><div class="panel-body stack">
        <div class="quick-counts">${[2,4,8,16].filter((value) => value <= participantCount).map((value) => `<button type="button" class="${wizard.qualifiers === value ? 'active' : ''}" data-qualifier-quick="${value}">${value}</button>`).join('')}</div>
        <label class="field"><span>Quantidade exata de classificados</span><input id="wizardQualifiers" type="number" min="2" max="${participantCount}" value="${Math.min(wizard.qualifiers, participantCount)}"><small>Se a quantidade não fechar uma chave exata, o sistema cria rodada preliminar e folgas automaticamente.</small></label>
      </div></div>` : ''}
      ${wizard.format !== 'league' ? `<label class="check-row"><input id="wizardThirdPlace" type="checkbox" ${wizard.thirdPlace ? 'checked' : ''}> Criar disputa de terceiro lugar</label>` : ''}
      <div class="notice info">Desempates da liga: pontos, vitórias, saldo de pontos/gols, pontos/gols marcados e ordem alfabética.</div>
    </div>`;
}

function wizardReviewHtml(wizard) {
  const participants = wizard.mode === 'individual' ? wizard.entrants : wizard.teams;
  const estimatedLeague = wizard.format === 'knockout' ? 0 : (participants.length * (participants.length - 1) / 2) * wizard.leagueLegs;
  return `<h3>Revisar e sortear</h3><p>Ao confirmar, o sistema criará a tabela da liga ou a primeira fase do mata-mata com confrontos sorteados.</p>
    <div class="stack">
      <div class="panel"><div class="panel-body"><table class="stats-table"><tbody>
        <tr><td>Campeonato</td><td class="num"><strong>${escapeHtml(wizard.name)}</strong></td></tr>
        <tr><td>Jogo</td><td class="num">${escapeHtml(wizard.game || 'Não informado')}</td></tr>
        <tr><td>Formato</td><td class="num">${formatLabel(wizard.format)}</td></tr>
        <tr><td>Modo</td><td class="num">${modeLabel(wizard.mode)}</td></tr>
        <tr><td>Participantes</td><td class="num">${participants.length}</td></tr>
        ${wizard.format !== 'knockout' ? `<tr><td>Jogos previstos na liga</td><td class="num">${estimatedLeague}</td></tr>` : ''}
        ${wizard.format === 'mixed' ? `<tr><td>Classificados</td><td class="num">${wizard.qualifiers}</td></tr>` : ''}
      </tbody></table></div></div>
      <div class="notice warning">O sorteio poderá ser refeito enquanto nenhum resultado tiver sido registrado.</div>
    </div>`;
}

function bindWizardStepEvents() {
  const wizard = state.wizard;
  $$('[data-format-choice]').forEach((choice) => choice.addEventListener('click', () => {
    wizard.format = choice.dataset.formatChoice;
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
  if ($('#wizardGame')) wizard.game = $('#wizardGame').value.trim();
  if ($('#wizardMode')) wizard.mode = $('#wizardMode').value;
  if ($('#wizardExtraLabel')) wizard.extraLabel = $('#wizardExtraLabel').value.trim() || 'Escolha usada';
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
    if (!['league','knockout','mixed'].includes(wizard.format)) return 'Escolha um formato válido.';
  }
  if (step === 2) {
    if (wizard.mode === 'individual') {
      wizard.entrants = wizard.entrants.map((item) => ({ ...item, name: item.name.trim() })).filter((item) => item.name);
      if (wizard.entrants.length < 2) return 'Adicione pelo menos dois jogadores.';
    } else {
      wizard.teams = wizard.teams.map((team) => ({ ...team, name: team.name.trim(), members: team.members.filter((member) => member.name.trim()) })).filter((team) => team.name);
      if (wizard.teams.length < 2) return 'Adicione pelo menos duas equipes.';
      if (wizard.teams.some((team) => !team.members.length)) return 'Cada equipe precisa ter pelo menos um jogador.';
    }
  }
  if (step === 3 && wizard.format === 'mixed') {
    const total = wizard.mode === 'individual' ? wizard.entrants.length : wizard.teams.length;
    if (!Number.isInteger(wizard.qualifiers) || wizard.qualifiers < 2 || wizard.qualifiers > total) return `A quantidade de classificados deve ficar entre 2 e ${total}.`;
  }
  return '';
}

function buildTournamentFromWizard() {
  const wizard = state.wizard;
  const participants = wizard.mode === 'individual'
    ? wizard.entrants.map((entrant) => ({ id: uid(), name: entrant.name, players: [{ id: uid(), name: entrant.name }] }))
    : wizard.teams.map((team) => ({ id: uid(), name: team.name, players: team.members.map((member) => ({ id: uid(), name: member.name })) }));

  const tournament = {
    id: uid(),
    version: 4,
    name: wizard.name,
    game: wizard.game,
    format: wizard.format,
    mode: wizard.mode,
    extraLabel: wizard.extraLabel,
    participants,
    settings: {
      leagueLegs: wizard.leagueLegs,
      pointsWin: wizard.pointsWin,
      pointsDraw: wizard.pointsDraw,
      qualifiers: wizard.format === 'mixed' ? wizard.qualifiers : null,
      thirdPlace: wizard.thirdPlace
    },
    matches: [],
    knockoutState: { started: wizard.format === 'knockout', currentRound: 0, pendingByes: [], seeded: false },
    championId: null,
    status: 'active',
    createdAt: now(),
    updatedAt: now()
  };

  const ids = participants.map((item) => item.id);
  if (wizard.format === 'league' || wizard.format === 'mixed') {
    tournament.matches = createRoundRobin(shuffle(ids), wizard.leagueLegs, tournament);
  } else {
    beginKnockout(tournament, shuffle(ids), false);
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

function beginKnockout(tournament, orderedIds, seeded) {
  const ids = [...orderedIds];
  const n = ids.length;
  if (n < 2) throw new Error('O mata-mata precisa de pelo menos dois participantes.');
  const base = highestPowerOfTwoAtMost(n);
  const preliminaryMatches = n - base;
  tournament.knockoutState = { started: true, currentRound: 1, pendingByes: [], seeded };

  let playIds = ids;
  let roundName = knockoutRoundName(n);
  if (preliminaryMatches > 0) {
    const playCount = preliminaryMatches * 2;
    if (seeded) {
      tournament.knockoutState.pendingByes = ids.slice(0, n - playCount);
      playIds = ids.slice(n - playCount);
    } else {
      playIds = ids.slice(0, playCount);
      tournament.knockoutState.pendingByes = ids.slice(playCount);
    }
    roundName = 'Rodada preliminar';
  }

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
    const homeScore = Number(match.homeScore);
    const awayScore = Number(match.awayScore);
    home.pj += 1; away.pj += 1;
    home.gp += homeScore; home.gc += awayScore;
    away.gp += awayScore; away.gc += homeScore;
    if (homeScore > awayScore) {
      home.v += 1; away.d += 1; home.pts += tournament.settings.pointsWin;
    } else if (awayScore > homeScore) {
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
    winners = [...tournament.knockoutState.pendingByes, ...winners];
    tournament.knockoutState.pendingByes = [];
  }

  if (winners.length === 1) {
    tournament.championId = winners[0];
    return;
  }

  const nextRound = round + 1;
  const pairs = tournament.knockoutState.seeded ? pairOuter(winners) : pairSequential(winners);
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
  beginKnockout(tournament, qualified, true);
}

function rerollTournament(tournament) {
  if (playedMatches(tournament) > 0) throw new Error('Não é possível sortear novamente depois de registrar resultados.');
  tournament.championId = null;
  if (tournament.format === 'league' || tournament.format === 'mixed') {
    tournament.matches = createRoundRobin(shuffle(tournament.participants.map((item) => item.id)), tournament.settings.leagueLegs, tournament);
    tournament.knockoutState = { started: false, currentRound: 0, pendingByes: [], seeded: false };
  } else {
    tournament.matches = [];
    beginKnockout(tournament, shuffle(tournament.participants.map((item) => item.id)), false);
  }
}

function renderTournamentDetail() {
  const tournament = tournamentById(state.activeTournamentId);
  if (!tournament) { state.activeTournamentId = null; renderTournamentsView(); return; }
  updateLeagueChampion(tournament);
  updateTournamentStatus(tournament);

  $('#view-tournaments').innerHTML = `
    <div class="detail-head">
      <div>
        <button class="button small ghost" data-back-list>← Voltar aos campeonatos</button>
        <h2>${escapeHtml(tournament.name)}</h2>
        <div class="detail-meta"><span class="format-badge">${escapeHtml(tournament.game || 'Jogo não informado')}</span><span class="format-badge">${formatLabel(tournament.format)}</span><span class="format-badge">${modeLabel(tournament.mode)}</span><span class="format-badge">${tournament.participants.length} participantes</span></div>
      </div>
      <div class="detail-actions">
        ${playedMatches(tournament) === 0 ? '<button class="button secondary" data-reroll>Sortear novamente</button>' : ''}
        <button class="button danger" data-delete-tournament>Excluir</button>
      </div>
    </div>
    ${tournament.championId ? `<div class="champion-banner"><div><span>CAMPEÃO DO CAMPEONATO</span><strong>${escapeHtml(participantName(tournament,tournament.championId))}</strong></div><span>${formatLabel(tournament.format)}</span></div>` : ''}
    <div class="detail-grid">
      <aside class="panel detail-menu">
        ${detailTabButton('matches','Jogos')}
        ${tournament.format !== 'knockout' ? detailTabButton('standings','Classificação') : ''}
        ${tournament.format !== 'league' ? detailTabButton('bracket','Mata-mata') : ''}
        ${detailTabButton('participants','Participantes e estatísticas')}
        ${detailTabButton('settings','Configuração')}
      </aside>
      <div class="detail-content">${detailTabHtml(tournament)}</div>
    </div>`;

  $('[data-back-list]').addEventListener('click', () => { state.activeTournamentId = null; renderTournamentsView(); });
  $$('[data-detail-tab]').forEach((button) => button.addEventListener('click', () => { state.detailTab = button.dataset.detailTab; renderTournamentDetail(); }));
  $$('[data-edit-match]').forEach((button) => button.addEventListener('click', () => openMatchModal(tournament.id, button.dataset.editMatch)));
  $('[data-generate-knockout]')?.addEventListener('click', async () => {
    try { generateMixedKnockout(tournament); await persistTournament(tournament); renderTournamentDetail(); toast('Mata-mata gerado com os classificados.', 'success'); }
    catch (error) { toast(error.message, 'error'); }
  });
  $('[data-reroll]')?.addEventListener('click', async () => {
    if (!confirm('Sortear novamente todos os confrontos?')) return;
    try { rerollTournament(tournament); await persistTournament(tournament); renderTournamentDetail(); toast('Novo sorteio realizado.', 'success'); }
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
  if (state.detailTab === 'participants') return participantsTabHtml(tournament);
  if (state.detailTab === 'settings') return settingsTabHtml(tournament);
  return matchesTabHtml(tournament);
}

function matchesTabHtml(tournament) {
  const groups = groupMatchesForDisplay(tournament.matches);
  const leagueDone = tournament.format === 'mixed' && allLeagueMatchesPlayed(tournament) && !tournament.knockoutState.started;
  return `<div class="stack">
    ${tournament.format === 'mixed' && !tournament.knockoutState.started ? `<div class="notice ${leagueDone ? 'success' : 'info'}">${leagueDone ? `Liga concluída. Os ${tournament.settings.qualifiers} primeiros estão prontos para o mata-mata.` : `Fase classificatória em andamento. Os ${tournament.settings.qualifiers} primeiros avançam.`}${leagueDone ? ' <button class="button small primary" data-generate-knockout style="margin-left:10px">Gerar mata-mata</button>' : ''}</div>` : ''}
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
  return `<div class="match-row ${match.played ? 'played' : ''} ${match.isBye ? 'bye' : ''}">
    <div class="match-code">J${String(index + 1).padStart(2,'0')}</div>
    <div class="match-side">${escapeHtml(home)}</div>
    <div class="match-score">${match.played ? match.homeScore : '—'}</div>
    <div class="match-vs">×</div>
    <div class="match-score">${match.played ? match.awayScore : '—'}</div>
    <div class="match-side away">${escapeHtml(away)}</div>
    <div class="match-status"><button class="button small ${match.played ? 'secondary' : 'primary'}" data-edit-match="${match.id}">${match.played ? 'Editar' : 'Registrar'}</button></div>
  </div>`;
}

function standingsTabHtml(tournament) {
  const rows = standings(tournament);
  const qualifiers = tournament.format === 'mixed' ? tournament.settings.qualifiers : 0;
  return `<div class="panel"><div class="panel-head"><div><h3>Classificação</h3><p>${tournament.format === 'mixed' ? `Os ${qualifiers} primeiros avançam ao mata-mata.` : 'Tabela completa da liga.'}</p></div></div><div class="table-wrap"><table class="stats-table"><thead><tr><th>#</th><th>Participante</th><th class="num">J</th><th class="num">V</th><th class="num">E</th><th class="num">D</th><th class="num">GP</th><th class="num">GC</th><th class="num">SG</th><th class="num">PTS</th></tr></thead><tbody>${rows.map((row,index) => `<tr class="${qualifiers && index < qualifiers ? 'qualified' : ''}"><td class="rank">${index + 1}</td><td><strong>${escapeHtml(participantName(tournament,row.id))}</strong></td><td class="num">${row.pj}</td><td class="num">${row.v}</td><td class="num">${row.e}</td><td class="num">${row.d}</td><td class="num">${row.gp}</td><td class="num">${row.gc}</td><td class="num">${row.sg}</td><td class="num"><strong>${row.pts}</strong></td></tr>`).join('')}</tbody></table></div></div>`;
}

function bracketTabHtml(tournament) {
  if (!tournament.knockoutState.started) {
    return `<div class="panel empty-state"><div class="empty-state-inner"><div class="empty-symbol">◇</div><h2>Mata-mata ainda não gerado</h2><p>Finalize os jogos da liga. Depois, os ${tournament.settings.qualifiers} primeiros serão colocados na chave.</p>${allLeagueMatchesPlayed(tournament) ? '<button class="button primary" data-generate-knockout>Gerar mata-mata</button>' : ''}</div></div>`;
  }
  const rounds = [...new Set(knockoutMatches(tournament).map((match) => match.bracketRound))].sort((a,b) => a-b);
  return `<div class="stack">
    ${tournament.knockoutState.pendingByes?.length ? `<div class="notice info">${tournament.knockoutState.pendingByes.length} participante(s) avançam com folga após a rodada preliminar.</div>` : ''}
    <div class="bracket">${rounds.map((round) => {
      const matches = knockoutMatches(tournament).filter((match) => match.bracketRound === round);
      return `<div class="bracket-column"><h4>${escapeHtml(matches[0]?.roundName || `Rodada ${round}`)}</h4>${matches.map((match) => bracketMatchHtml(tournament,match)).join('')}</div>`;
    }).join('')}${tournament.matches.some((match) => match.stage === 'third') ? `<div class="bracket-column"><h4>3º lugar</h4>${tournament.matches.filter((match) => match.stage === 'third').map((match) => bracketMatchHtml(tournament,match)).join('')}</div>` : ''}</div>
  </div>`;
}

function bracketMatchHtml(tournament, match) {
  const winner = matchWinner(match);
  return `<button class="bracket-match" data-edit-match="${match.id}">
    <div class="bracket-side ${winner === match.homeId ? 'winner' : ''}"><span>${escapeHtml(participantName(tournament,match.homeId))}</span><span>${match.played ? match.homeScore : '—'}</span></div>
    <div class="bracket-side ${winner === match.awayId ? 'winner' : ''}"><span>${escapeHtml(participantName(tournament,match.awayId))}</span><span>${match.played ? match.awayScore : '—'}</span></div>
  </button>`;
}

function playerStats(tournament) {
  const rows = new Map();
  for (const participant of tournament.participants) {
    for (const player of participant.players) rows.set(player.id, { id: player.id, name: player.name, team: participant.name, pj:0,v:0,e:0,d:0,gp:0,gc:0,sg:0,mvp:0 });
  }
  for (const match of tournament.matches) {
    if (!match.played) continue;
    const homeScore = Number(match.homeScore);
    const awayScore = Number(match.awayScore);
    const homeResult = homeScore > awayScore ? 'v' : homeScore < awayScore ? 'd' : 'e';
    const awayResult = homeScore < awayScore ? 'v' : homeScore > awayScore ? 'd' : 'e';
    for (const id of match.homeLineup || []) {
      const row = rows.get(id); if (!row) continue;
      row.pj += 1; row[homeResult] += 1; row.gp += homeScore; row.gc += awayScore;
    }
    for (const id of match.awayLineup || []) {
      const row = rows.get(id); if (!row) continue;
      row.pj += 1; row[awayResult] += 1; row.gp += awayScore; row.gc += homeScore;
    }
    if (match.mvpPlayerId && rows.has(match.mvpPlayerId)) rows.get(match.mvpPlayerId).mvp += 1;
  }
  for (const row of rows.values()) row.sg = row.gp - row.gc;
  return [...rows.values()].sort((a,b) => b.v-a.v || b.sg-a.sg || b.mvp-a.mvp || a.name.localeCompare(b.name));
}

function participantsTabHtml(tournament) {
  const stats = playerStats(tournament);
  return `<div class="stack">
    <div class="panel"><div class="panel-head"><div><h3>Participantes do campeonato</h3><p>Estes nomes pertencem somente a esta competição.</p></div></div><div class="panel-body"><div class="entry-list">${tournament.participants.map((participant,index) => `<div class="entry-row"><div class="entry-index">${String(index+1).padStart(2,'0')}</div><div><strong>${escapeHtml(participant.name)}</strong>${tournament.mode === 'teams' ? `<div class="member-chips">${participant.players.map((player) => `<span class="member-chip">${escapeHtml(player.name)}</span>`).join('')}</div>` : ''}</div><span class="format-badge">${participant.players.length} jogador(es)</span></div>`).join('')}</div></div></div>
    <div class="panel"><div class="panel-head"><div><h3>Estatísticas individuais</h3><p>Em equipes, somente jogadores escalados recebem a partida.</p></div></div><div class="table-wrap"><table class="stats-table"><thead><tr><th>Jogador</th>${tournament.mode === 'teams' ? '<th>Equipe</th>' : ''}<th class="num">J</th><th class="num">V</th><th class="num">E</th><th class="num">D</th><th class="num">GP</th><th class="num">GC</th><th class="num">SG</th><th class="num">MVP</th></tr></thead><tbody>${stats.map((row) => `<tr><td><strong>${escapeHtml(row.name)}</strong></td>${tournament.mode === 'teams' ? `<td>${escapeHtml(row.team)}</td>` : ''}<td class="num">${row.pj}</td><td class="num">${row.v}</td><td class="num">${row.e}</td><td class="num">${row.d}</td><td class="num">${row.gp}</td><td class="num">${row.gc}</td><td class="num">${row.sg}</td><td class="num">${row.mvp}</td></tr>`).join('')}</tbody></table></div></div>
  </div>`;
}

function settingsTabHtml(tournament) {
  return `<div class="panel"><div class="panel-head"><div><h3>Configuração do campeonato</h3><p>Resumo das regras usadas na geração.</p></div></div><div class="panel-body"><table class="stats-table"><tbody>
    <tr><td>Formato</td><td class="num"><strong>${formatLabel(tournament.format)}</strong></td></tr>
    <tr><td>Modo</td><td class="num">${modeLabel(tournament.mode)}</td></tr>
    <tr><td>Participantes</td><td class="num">${tournament.participants.length}</td></tr>
    ${tournament.format !== 'knockout' ? `<tr><td>Turnos da liga</td><td class="num">${tournament.settings.leagueLegs}</td></tr><tr><td>Pontos por vitória</td><td class="num">${tournament.settings.pointsWin}</td></tr><tr><td>Pontos por empate</td><td class="num">${tournament.settings.pointsDraw}</td></tr>` : ''}
    ${tournament.format === 'mixed' ? `<tr><td>Classificados</td><td class="num">${tournament.settings.qualifiers}</td></tr>` : ''}
    <tr><td>Informação extra</td><td class="num">${escapeHtml(tournament.extraLabel)}</td></tr>
  </tbody></table></div></div>`;
}

function openMatchModal(tournamentId, matchId) {
  const tournament = tournamentById(tournamentId);
  const match = tournament?.matches.find((item) => item.id === matchId);
  if (!tournament || !match) return;
  const home = participantById(tournament, match.homeId);
  const away = participantById(tournament, match.awayId);
  const knockout = match.stage === 'knockout' || match.stage === 'third';
  const possibleMvp = [...(home?.players || []), ...(away?.players || [])];

  openModal(`
    <div class="modal-head"><div><div class="eyebrow">${escapeHtml(match.roundName)}</div><h2>Registrar partida</h2></div><button class="icon-button" data-close>×</button></div>
    <form id="matchForm">
      <div class="modal-body stack">
        <div class="match-form-score">
          <div class="match-form-team">${escapeHtml(home?.name || 'A definir')}</div>
          <label class="field"><span>Placar</span><input id="homeScore" type="number" min="0" value="${match.homeScore ?? ''}" required></label>
          <div class="match-vs" style="padding-bottom:13px">×</div>
          <label class="field"><span>Placar</span><input id="awayScore" type="number" min="0" value="${match.awayScore ?? ''}" required></label>
          <div class="match-form-team away">${escapeHtml(away?.name || 'A definir')}</div>
        </div>
        ${knockout ? `<label class="field"><span>Vencedor em caso de empate</span><select id="manualWinner"><option value="">Definir pelo placar</option><option value="${home.id}" ${match.winnerId === home.id ? 'selected' : ''}>${escapeHtml(home.name)}</option><option value="${away.id}" ${match.winnerId === away.id ? 'selected' : ''}>${escapeHtml(away.name)}</option></select></label>` : ''}
        <div class="grid cols-2">
          <label class="field"><span>${escapeHtml(tournament.extraLabel)} — ${escapeHtml(home.name)}</span><input id="homeChoice" value="${escapeHtml(match.homeChoice || '')}"></label>
          <label class="field"><span>${escapeHtml(tournament.extraLabel)} — ${escapeHtml(away.name)}</span><input id="awayChoice" value="${escapeHtml(match.awayChoice || '')}"></label>
        </div>
        ${tournament.mode === 'teams' ? `<div class="grid cols-2">${lineupHtml(home,match.homeLineup,'home')}${lineupHtml(away,match.awayLineup,'away')}</div>` : ''}
        <label class="field"><span>MVP da partida</span><select id="matchMvp"><option value="">Nenhum</option>${possibleMvp.map((player) => `<option value="${player.id}" ${match.mvpPlayerId === player.id ? 'selected' : ''}>${escapeHtml(player.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Observações</span><textarea id="matchNotes" placeholder="Anotações opcionais sobre a partida">${escapeHtml(match.notes || '')}</textarea></label>
      </div>
      <div class="modal-foot"><div>${match.played ? '<button class="button danger" type="button" data-clear-result>Limpar resultado</button>' : ''}</div><div style="display:flex;gap:8px"><button class="button ghost" type="button" data-close>Cancelar</button><button class="button primary" type="submit">Salvar resultado</button></div></div>
    </form>`);

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
    let winnerId = homeScore > awayScore ? home.id : awayScore > homeScore ? away.id : null;
    if (knockout && homeScore === awayScore) winnerId = $('#manualWinner').value || null;
    if (knockout && !winnerId) return toast('Em mata-mata, selecione o vencedor quando houver empate.', 'error');

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
  tournament.knockoutState = { started: false, currentRound: 0, pendingByes: [], seeded: false };
  tournament.championId = null;
}

function clearMatchResult(tournament, match) {
  if (match.stage === 'knockout') truncateKnockoutAfter(tournament, match.bracketRound);
  Object.assign(match, { homeScore:null, awayScore:null, winnerId:null, played:false, homeChoice:'', awayChoice:'', mvpPlayerId:'', notes:'' });
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
