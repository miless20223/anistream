// Каталог из локальных файлов catalog/ (выгружаются tools/export-catalog.ps1).
// Список, поиск, фильтры, страница тайтла и похожие работают без Shikimori.
// С Shikimori берутся только описание (если сайт доступен) и постеры (их CDN).
const SHIKI = 'https://shikimori.io';
const POSTER_BASE = `${SHIKI}/uploads/poster/animes`;

export const PAGE_SIZE = 30;

export const imageUrl = (path) => {
  if (!path || path.includes('missing_')) return '';
  return path.startsWith('http') ? path : SHIKI + path;
};

const posterUrl = (id, file) => (!file ? '' : file.startsWith('http') ? file : `${POSTER_BASE}/${id}/${file}`);

const normalize = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// --- Индекс каталога ---

let indexPromise;

function loadIndex() {
  indexPromise ||= fetch('catalog/index.json')
    .then((r) => {
      if (!r.ok) throw new Error(`Каталог не найден (${r.status})`);
      return r.json();
    })
    .then((raw) => {
      const col = Object.fromEntries(raw.fields.map((f, i) => [f, i]));
      const genres = raw.genres.map(([id, russian, kind]) => ({ id, russian, kind }));
      const genreById = new Map(genres.map((g) => [g.id, g]));
      const items = raw.items.map((row, rank) => {
        const id = row[col.id];
        const year = row[col.year];
        return {
          id,
          rank,
          russian: row[col.russian],
          name: row[col.name],
          english: row[col.english],
          kind: row[col.kind],
          score: row[col.score] ? row[col.score].toFixed(2) : '0',
          status: row[col.status],
          episodes: row[col.episodes],
          episodes_aired: row[col.episodesAired],
          year,
          aired_on: year ? String(year) : '',
          image: { preview: posterUrl(id, row[col.poster]) },
          genreIds: row[col.genres],
          search: normalize(`${row[col.russian]} ${row[col.name]} ${row[col.english]}`),
        };
      });
      return { ...raw, items, genres, genreById, byId: new Map(items.map((a) => [a.id, a])) };
    });
  indexPromise.catch(() => { indexPromise = null; });
  return indexPromise;
}

// --- Список с фильтрами ---

let lastQuery = { key: '', list: [] };

const SORTS = {
  popularity: (a, b) => a.rank - b.rank,
  ranked: (a, b) => b.score - a.score || a.rank - b.rank,
  aired_on: (a, b) => (b.year || 0) - (a.year || 0) || a.rank - b.rank,
  name: (a, b) => (a.russian || a.name).localeCompare(b.russian || b.name, 'ru'),
};

export async function listAnimes(filters = {}, page = 1) {
  const { items } = await loadIndex();
  const key = JSON.stringify(filters);
  if (lastQuery.key !== key) {
    const words = normalize(filters.search).split(' ').filter(Boolean);
    const genre = Number(filters.genre) || 0;
    const year = Number(filters.season) || 0;
    const list = items.filter((a) =>
      (!filters.kind || a.kind === filters.kind) &&
      (!filters.status || a.status === filters.status) &&
      (!genre || a.genreIds.includes(genre)) &&
      (!year || a.year === year) &&
      words.every((w) => a.search.includes(w))
    );
    list.sort(SORTS[filters.order] || SORTS.popularity);
    lastQuery = { key, list };
  }
  return lastQuery.list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

export async function getGenres() {
  const { genres } = await loadIndex();
  return genres.filter((g) => g.kind === 'g');
}

// --- Тайтл ---

const detailsCache = new Map();

function loadDetails(bucket) {
  if (!detailsCache.has(bucket)) {
    const p = fetch(`catalog/details/${bucket}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    detailsCache.set(bucket, p);
  }
  return detailsCache.get(bucket);
}

export async function getAnime(id) {
  const index = await loadIndex();
  const base = index.byId.get(id);
  if (!base) return getAnimeFromShikimori(id); // тайтл новее выгрузки
  const extra = (await loadDetails(id % index.buckets))[id] || {};
  return {
    ...base,
    english: base.english ? [base.english] : [],
    japanese: extra.jp ? [extra.jp] : [],
    synonyms: extra.syn || [],
    duration: extra.dur,
    rating: extra.rating,
    aired_on: extra.date || base.aired_on,
    released_on: extra.rel,
    image: { preview: base.image.preview, original: posterUrl(id, extra.main) || base.image.preview },
    genres: base.genreIds.map((g) => index.genreById.get(g)).filter((g) => g && g.kind !== 'd'),
    studios: (extra.studios || []).map((name) => ({ name })),
  };
}

export async function getSimilar(id) {
  const index = await loadIndex();
  const base = index.byId.get(id);
  if (!base?.genreIds.length) return [];
  const genres = new Set(base.genreIds);
  return index.items
    .filter((a) => a.id !== id)
    .map((a) => ({ a, common: a.genreIds.reduce((n, g) => n + genres.has(g), 0) }))
    .filter((x) => x.common >= Math.min(3, genres.size))
    .sort((x, y) => y.common - x.common || y.a.score - x.a.score)
    .slice(0, 20)
    .map((x) => x.a);
}

// --- Shikimori: только описание и запасной вариант для новых тайтлов ---

async function shikiFetch(path, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SHIKI}/api/${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Shikimori ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getAnimeFromShikimori(id) {
  const a = await shikiFetch(`animes/${id}`, 8000).catch(() => {
    throw new Error('Тайтл не найден в каталоге');
  });
  return { ...a, image: { preview: imageUrl(a.image?.preview), original: imageUrl(a.image?.original) } };
}

// Описание не хранится в каталоге — подгружаем, если Shikimori доступен, иначе пустая строка.
export async function getDescription(id) {
  try {
    return cleanDescription((await shikiFetch(`animes/${id}`)).description);
  } catch {
    return '';
  }
}

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
