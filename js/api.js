// Клиент Shikimori API: кэш в памяти + sessionStorage, ограничение ~4 запроса/с (лимит API — 5/с).
const BASE = 'https://shikimori.io';
const MIN_GAP_MS = 250;

export const imageUrl = (path) => {
  if (!path || path.includes('missing_')) return '';
  return path.startsWith('http') ? path : BASE + path;
};

const memo = new Map();
let queue = Promise.resolve();
let lastAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function throttle() {
  const slot = queue.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
  });
  queue = slot.catch(() => {});
  return slot;
}

function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { t, d } = JSON.parse(raw);
    return Date.now() - t < 30 * 60 * 1000 ? d : null;
  } catch { return null; }
}

function cacheSet(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data })); }
  catch { /* переполнение или приватный режим — работаем без кэша */ }
}

async function get(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v != null)
  ).toString();
  const url = `${BASE}/api/${path}${qs ? '?' + qs : ''}`;
  if (memo.has(url)) return memo.get(url);

  const cached = cacheGet(url);
  if (cached) return cached;

  const request = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await throttle();
      const res = await fetch(url);
      if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`Shikimori ${res.status}`);
      const data = await res.json();
      cacheSet(url, data);
      return data;
    }
    throw new Error('Shikimori: слишком много запросов, попробуйте позже');
  })();

  memo.set(url, request);
  request.catch(() => memo.delete(url));
  return request;
}

export const PAGE_SIZE = 30;

export const listAnimes = (filters = {}, page = 1) => get('animes', {
  page,
  limit: PAGE_SIZE,
  order: filters.order || 'popularity',
  kind: filters.kind,
  status: filters.status,
  genre: filters.genre,
  season: filters.season,
  search: filters.search,
  censored: true,
});

export const getAnime = (id) => get(`animes/${id}`);
export const getSimilar = (id) => get(`animes/${id}/similar`);
export const getScreenshots = (id) => get(`animes/${id}/screenshots`);

export const getGenres = () => get('genres').then((all) =>
  all.filter((g) => g.entry_type === 'Anime' && g.kind === 'genre')
     .sort((a, b) => a.russian.localeCompare(b.russian, 'ru'))
);

// Описание Shikimori содержит разметку вида [character=1]Имя[/character] и [エレン] — убираем её.
export const cleanDescription = (text) =>
  (text || '').replace(/\[[^\]]*\]/g, '').replace(/[ \t]{2,}/g, ' ').trim();

export const KIND = {
  tv: 'TV сериал', movie: 'Фильм', ova: 'OVA', ona: 'ONA', special: 'Спешл',
  tv_special: 'TV спешл', music: 'Клип', pv: 'Проморолик', cm: 'Реклама',
};

export const STATUS = { anons: 'Анонс', ongoing: 'Онгоинг', released: 'Вышел' };

export const RATING = {
  g: '0+', pg: '6+', pg_13: '13+', r: '17+', r_plus: '18+', rx: '18+',
};
