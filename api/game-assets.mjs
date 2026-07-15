const RIOT_VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const SPORTS_DB_SEARCH = 'https://www.thesportsdb.com/api/v1/json/123/searchteams.php';

let riotCache = { version: '', champions: [], loadedAt: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000;

function normalize(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function loadRiotChampions() {
  if (riotCache.champions.length && Date.now() - riotCache.loadedAt < CACHE_TTL) return riotCache;
  const versionsResponse = await fetch(RIOT_VERSIONS_URL);
  if (!versionsResponse.ok) throw new Error('Não foi possível consultar a versão do Data Dragon.');
  const versions = await versionsResponse.json();
  const version = versions[0];
  const dataResponse = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/pt_BR/champion.json`);
  if (!dataResponse.ok) throw new Error('Não foi possível carregar os campeões do Data Dragon.');
  const payload = await dataResponse.json();
  const champions = Object.values(payload.data || {}).map((champion) => ({
    id: champion.id,
    name: champion.name,
    image: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champion.image.full}`
  }));
  riotCache = { version, champions, loadedAt: Date.now() };
  return riotCache;
}

async function searchLol(query) {
  const { champions } = await loadRiotChampions();
  const term = normalize(query);
  return champions
    .filter((champion) => !term || normalize(champion.name).includes(term) || normalize(champion.id).includes(term))
    .sort((a, b) => {
      const aStarts = normalize(a.name).startsWith(term) ? 0 : 1;
      const bStarts = normalize(b.name).startsWith(term) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name, 'pt-BR');
    })
    .slice(0, 20);
}

async function searchFifa(query) {
  if (String(query || '').trim().length < 2) return [];
  const response = await fetch(`${SPORTS_DB_SEARCH}?t=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error('Não foi possível consultar os clubes.');
  const payload = await response.json();
  return (payload.teams || [])
    .filter((team) => String(team.strSport || '').toLowerCase() === 'soccer')
    .map((team) => ({
      id: team.idTeam,
      name: team.strTeam,
      subtitle: [team.strLeague, team.strCountry].filter(Boolean).join(' · '),
      image: team.strBadge || team.strTeamBadge || team.strLogo || ''
    }))
    .filter((team, index, list) => team.name && list.findIndex((item) => item.name === team.name) === index)
    .slice(0, 12);
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  if (request.method !== 'GET') return response.status(405).json({ error: 'Método não permitido.' });
  const game = String(request.query?.game || '').toLowerCase();
  const query = String(request.query?.q || '').slice(0, 80);
  try {
    const items = game === 'lol' ? await searchLol(query) : game === 'fifa' ? await searchFifa(query) : [];
    return response.status(200).json({ items });
  } catch (error) {
    return response.status(200).json({ items: [], warning: error.message });
  }
}
