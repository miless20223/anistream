// Локальные данные зрителя: история, прогресс серий, избранное, настройки плеера.
// Всё в localStorage — при переходе на сервер с аккаунтами заменяется на API.

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* хранилище недоступно */ }
}

// --- История и прогресс ---

export function getHistory() {
  return Object.values(read('as:history', {})).sort((a, b) => b.updated - a.updated);
}

export function getHistoryEntry(animeId) {
  return read('as:history', {})[animeId] || null;
}

export function saveProgress(anime, episode, time, duration) {
  const history = read('as:history', {});
  history[anime.id] = {
    id: anime.id,
    title: anime.russian || anime.name,
    image: anime.image?.preview,
    episodes: anime.episodes || anime.episodes_aired,
    episode,
    time,
    duration,
    updated: Date.now(),
  };
  write('as:history', history);

  const key = `as:eps:${anime.id}`;
  const eps = read(key, {});
  eps[episode] = duration ? Math.min(1, time / duration) : 0;
  write(key, eps);
}

export function getEpisodeProgress(animeId) {
  return read(`as:eps:${animeId}`, {});
}

export function removeHistory(animeId) {
  const history = read('as:history', {});
  delete history[animeId];
  write('as:history', history);
}

// --- Избранное ---

export function getFavorites() {
  return Object.values(read('as:fav', {})).sort((a, b) => b.added - a.added);
}

export function isFavorite(id) {
  return Boolean(read('as:fav', {})[id]);
}

export function toggleFavorite(anime) {
  const fav = read('as:fav', {});
  if (fav[anime.id]) delete fav[anime.id];
  else fav[anime.id] = {
    id: anime.id,
    russian: anime.russian,
    name: anime.name,
    image: anime.image,
    kind: anime.kind,
    score: anime.score,
    aired_on: anime.aired_on,
    added: Date.now(),
  };
  write('as:fav', fav);
  return Boolean(fav[anime.id]);
}

// --- Настройки плеера ---

const DEFAULT_PREFS = { volume: 1, muted: false, speed: 1, autoNext: true, source: {} };

export function getPrefs() {
  return { ...DEFAULT_PREFS, ...read('as:prefs', {}) };
}

export function setPrefs(patch) {
  write('as:prefs', { ...getPrefs(), ...patch });
}

// Последняя выбранная озвучка для конкретного тайтла.
export function getSourcePref(animeId) {
  return getPrefs().source[animeId];
}

export function setSourcePref(animeId, sourceId) {
  const prefs = getPrefs();
  setPrefs({ source: { ...prefs.source, [animeId]: sourceId } });
}
