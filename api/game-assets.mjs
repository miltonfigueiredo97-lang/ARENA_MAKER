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

// Elencos principais das franquias de luta. Sem imagem: o app mostra o ícone do perfil.
const FIGHTING_ROSTERS = {
  mk: ['Scorpion', 'Sub-Zero', 'Liu Kang', 'Kung Lao', 'Raiden', 'Johnny Cage', 'Sonya Blade', 'Jax', 'Kano', 'Kitana', 'Mileena', 'Jade', 'Shang Tsung', 'Shao Kahn', 'Goro', 'Baraka', 'Reptile', 'Smoke', 'Noob Saibot', 'Ermac', 'Kenshi', 'Kabal', 'Nightwolf', 'Sindel', 'Cassie Cage', 'Jacqui Briggs', 'Kotal Kahn', "D'Vorah", 'Erron Black', 'Geras', 'Cetrion', 'Kollector', 'Shujinko', 'Havik', 'Reiko', 'Tanya', 'Li Mei', 'Ashrah', 'Quan Chi', 'Frost', 'Cyrax', 'Sektor', 'Nitara', 'Rain', 'Stryker', 'Fujin'],
  kof: ['Kyo Kusanagi', 'Iori Yagami', 'Terry Bogard', 'Andy Bogard', 'Joe Higashi', 'Mai Shiranui', 'Ryo Sakazaki', 'Robert Garcia', 'Yuri Sakazaki', 'Takuma Sakazaki', 'King', 'Athena Asamiya', 'Sie Kensou', 'Chin Gentsai', 'Kim Kaphwan', 'Chang Koehan', 'Choi Bounge', 'Ralf Jones', 'Clark Still', 'Leona Heidern', 'Heidern', 'Goro Daimon', 'Benimaru Nikaido', 'Chizuru Kagura', 'Yashiro Nanakase', 'Shermie', 'Chris', 'Orochi', 'Rugal Bernstein', 'Geese Howard', 'Billy Kane', "K'", 'Maxima', 'Kula Diamond', 'Ash Crimson', 'Shingo Yabuki', 'Rock Howard', 'Blue Mary', 'Vanessa', 'Ramon', "Shun'ei", 'Isla', 'Krohnen', 'Dolores', 'Meitenkun'],
  tekken: ['Jin Kazama', 'Kazuya Mishima', 'Heihachi Mishima', 'Paul Phoenix', 'Marshall Law', 'King', 'Armor King', 'Nina Williams', 'Anna Williams', 'Yoshimitsu', 'Hwoarang', 'Xiaoyu', 'Lars Alexandersson', 'Lee Chaolan', 'Bryan Fury', 'Jack-8', 'Kuma', 'Panda', 'Lili', 'Asuka Kazama', 'Leroy Smith', 'Feng Wei', 'Steve Fox', 'Eddy Gordo', 'Christie Monteiro', 'Bob', 'Dragunov', 'Claudio Serafino', 'Shaheen', 'Leo', 'Raven', 'Devil Jin', 'Jun Kazama', 'Reina', 'Azucena', 'Victor Chevalier', 'Alisa Bosconovitch', 'Zafina', 'Lei Wulong', 'Ganryu', 'Julia Chang', 'Akuma', 'Geese Howard', 'Noctis', 'Negan', 'Kunimitsu', 'Lidia Sobieska'],
  sf: ['Ryu', 'Ken', 'Chun-Li', 'Guile', 'Cammy', 'Zangief', 'Dhalsim', 'E. Honda', 'Blanka', 'M. Bison', 'Vega', 'Balrog', 'Sagat', 'Akuma', 'Dee Jay', 'T. Hawk', 'Fei Long', 'Juri', 'Luke', 'Jamie', 'Kimberly', 'Manon', 'Marisa', 'Lily', 'JP', 'A.K.I.', 'Rashid', 'Ed', 'Terry Bogard', 'Mai Shiranui', 'Elena', 'Sakura', 'Karin', 'Dan', 'Rose', 'Gen', 'Ibuki', 'Makoto', 'Dudley', 'Alex', 'Yun', 'Yang', 'Abigail', 'Laura', 'Necalli', 'Urien', 'Gouken', 'Gill', 'Seth', 'C. Viper']
};

const FIGHTING_SERIES_LABELS = { mk: 'Mortal Kombat', kof: 'The King of Fighters', tekken: 'Tekken', sf: 'Street Fighter' };

function searchFighting(query, series = '') {
  const term = normalize(query);
  const keys = FIGHTING_ROSTERS[series] ? [series] : Object.keys(FIGHTING_ROSTERS);
  const seen = new Set();
  return keys
    .flatMap((key) => FIGHTING_ROSTERS[key].map((name) => ({ id: `${key}:${name}`, name, subtitle: FIGHTING_SERIES_LABELS[key], image: '' })))
    .filter((item) => {
      const unique = `${item.subtitle}:${item.name}`;
      if (seen.has(unique)) return false;
      seen.add(unique);
      return !term || normalize(item.name).includes(term);
    })
    .sort((a, b) => {
      const aStarts = normalize(a.name).startsWith(term) ? 0 : 1;
      const bStarts = normalize(b.name).startsWith(term) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name, 'pt-BR');
    })
    .slice(0, 20);
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  if (request.method !== 'GET') return response.status(405).json({ error: 'Método não permitido.' });
  const game = String(request.query?.game || '').toLowerCase();
  const query = String(request.query?.q || '').slice(0, 80);
  try {
    const series = String(request.query?.series || '').toLowerCase();
    const items = game === 'lol' ? await searchLol(query) : game === 'fifa' ? await searchFifa(query) : game === 'luta' ? searchFighting(query, series) : [];
    return response.status(200).json({ items });
  } catch (error) {
    return response.status(200).json({ items: [], warning: error.message });
  }
}
