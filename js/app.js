import {
  listAnimes, getAnime, getSimilar, getGenres, getDescription, imageUrl, cleanDescription,
  KIND, STATUS, RATING, PAGE_SIZE,
} from './api.js';
import { getEpisodeSources, prefetchEpisode } from './sources.js';
import {
  getHistory, getHistoryEntry, saveProgress, getEpisodeProgress, removeHistory,
  getFavorites, isFavorite, toggleFavorite, getSourcePref, setSourcePref,
} from './store.js';
import { Player } from './player.js';

const app = document.getElementById('app');
let player = null;
let cleanupView = null;

// --- Утилиты ---

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const year = (a) => (a.aired_on ? a.aired_on.slice(0, 4) : '');
const title = (a) => a.russian || a.name;
const episodeCount = (a) => {
  if (a.kind === 'movie') return 1;
  return a.status === 'ongoing' ? a.episodes_aired || 0 : a.episodes || a.episodes_aired || 0;
};

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

function poster(a, size = 'original') {
  const url = imageUrl(a.image?.[size] || a.image?.preview || a.image);
  return url
    ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async">`
    : `<div class="poster-empty">${esc(title(a)).slice(0, 1)}</div>`;
}

function card(a, extra = '') {
  return `
    <a class="card" href="#/anime/${a.id}">
      <div class="card-poster">
        ${poster(a)}
        ${Number(a.score) > 0 ? `<span class="card-score">★ ${esc(a.score)}</span>` : ''}
        ${a.kind ? `<span class="card-kind">${esc(KIND[a.kind] || a.kind)}</span>` : ''}
        ${extra}
      </div>
      <div class="card-title">${esc(title(a))}</div>
      <div class="card-meta">${[year(a), STATUS[a.status]].filter(Boolean).map(esc).join(' · ')}</div>
    </a>`;
}

const skeletonCards = (n) => Array.from({ length: n }, () => '<div class="card skeleton"><div class="card-poster"></div><div class="card-title"></div></div>').join('');

function setActiveNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

// --- Роутер ---

async function route() {
  cleanupView?.();
  cleanupView = null;
  if (player) { player.destroy(); player = null; }

  const { parts, params } = parseHash();
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'anime' && parts[1]) {
      setActiveNav('');
      await renderAnime(Number(parts[1]), Number(params.get('ep')) || null);
    } else if (parts[0] === 'history') {
      setActiveNav('history');
      renderHistory();
    } else if (parts[0] === 'favorites') {
      setActiveNav('favorites');
      renderFavorites();
    } else {
      setActiveNav('catalog');
      await renderCatalog(params);
    }
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="empty"><h2>Не удалось загрузить</h2><p>${esc(err.message)}</p><button class="btn" onclick="location.reload()">Обновить</button></div>`;
  }
}

window.addEventListener('hashchange', route);

// --- Каталог ---

const ORDERS = { popularity: 'По популярности', ranked: 'По рейтингу', aired_on: 'По дате выхода', name: 'По названию' };

async function renderCatalog(params) {
  const filters = {
    search: params.get('q') || '',
    kind: params.get('kind') || '',
    status: params.get('status') || '',
    genre: params.get('genre') || '',
    season: params.get('season') || '',
    order: params.get('order') || 'popularity',
  };
  const hasFilters = Object.entries(filters).some(([k, v]) => v && !(k === 'order' && v === 'popularity'));
  const history = getHistory().slice(0, 12);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 1979 }, (_, i) => thisYear + 1 - i);

  app.innerHTML = `
    ${!hasFilters && history.length ? `
      <section class="row">
        <div class="row-head"><h2>Продолжить просмотр</h2><a href="#/history">Вся история ›</a></div>
        <div class="scroller">${history.map(continueCard).join('')}</div>
      </section>` : ''}
    ${!hasFilters ? `
      <section class="row">
        <div class="row-head"><h2>Сейчас выходят</h2><a href="#/?status=ongoing">Все онгоинги ›</a></div>
        <div class="scroller" id="ongoing">${skeletonCards(8)}</div>
      </section>` : ''}
    <section>
      <div class="row-head"><h2>${filters.search ? `Поиск: «${esc(filters.search)}»` : 'Каталог аниме'}</h2></div>
      <form class="filters" id="filters">
        <input type="search" name="q" placeholder="Название…" value="${esc(filters.search)}">
        <select name="kind"><option value="">Любой тип</option>${Object.entries(KIND).slice(0, 6).map(([k, v]) => `<option value="${k}" ${filters.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select name="status"><option value="">Любой статус</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${filters.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select name="genre" id="genreSelect"><option value="">Все жанры</option></select>
        <select name="season"><option value="">Любой год</option>${years.map((y) => `<option value="${y}" ${filters.season === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <select name="order">${Object.entries(ORDERS).map(([k, v]) => `<option value="${k}" ${filters.order === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        ${hasFilters ? '<a class="btn ghost" href="#/">Сбросить</a>' : ''}
      </form>
      <div class="grid" id="grid">${skeletonCards(18)}</div>
      <div class="load-more" id="loadMore"></div>
    </section>`;

  const form = document.getElementById('filters');
  form.addEventListener('change', () => applyFilters(form));
  form.addEventListener('submit', (e) => { e.preventDefault(); applyFilters(form); });

  getGenres().then((genres) => {
    const sel = document.getElementById('genreSelect');
    if (!sel) return;
    sel.insertAdjacentHTML('beforeend', genres.map((g) => `<option value="${g.id}" ${filters.genre === String(g.id) ? 'selected' : ''}>${esc(g.russian)}</option>`).join(''));
  }).catch(() => {});

  if (!hasFilters) {
    listAnimes({ status: 'ongoing', order: 'popularity' }, 1).then((list) => {
      const el = document.getElementById('ongoing');
      if (el) el.innerHTML = list.slice(0, 20).map((a) => card(a)).join('');
    }).catch(() => document.getElementById('ongoing')?.closest('.row')?.remove());
  }

  // Бесконечная прокрутка
  const grid = document.getElementById('grid');
  const more = document.getElementById('loadMore');
  let page = 1, loading = false, done = false;

  const loadPage = async () => {
    if (loading || done) return;
    loading = true;
    more.innerHTML = page > 1 ? '<div class="spinner"></div>' : '';
    try {
      const list = await listAnimes(filters, page);
      if (page === 1) grid.innerHTML = '';
      grid.insertAdjacentHTML('beforeend', list.map((a) => card(a)).join(''));
      if (page === 1 && !list.length) grid.innerHTML = '<div class="empty">Ничего не найдено. Попробуйте изменить фильтры.</div>';
      done = list.length < PAGE_SIZE;
      page += 1;
      more.innerHTML = done ? '' : '<button class="btn ghost">Показать ещё</button>';
    } catch (err) {
      more.innerHTML = `<p class="muted">${esc(err.message)}</p><button class="btn ghost">Повторить</button>`;
    }
    loading = false;
  };
  more.addEventListener('click', (e) => { if (e.target.closest('button')) loadPage(); });
  const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) loadPage(); }, { rootMargin: '800px' });
  await loadPage();
  io.observe(more);
  cleanupView = () => io.disconnect();
}

function applyFilters(form) {
  const data = new FormData(form);
  const qs = new URLSearchParams();
  for (const [k, v] of data) if (v && !(k === 'order' && v === 'popularity')) qs.set(k, v);
  location.hash = `#/${qs.toString() ? '?' + qs : ''}`;
}

function continueCard(h) {
  const pct = h.duration ? Math.round((h.time / h.duration) * 100) : 0;
  return card(
    { id: h.id, russian: h.title, image: { preview: h.image } },
    `<span class="card-progress"><i style="width:${pct}%"></i></span><span class="card-ep">${h.episode} серия</span>`
  ).replace(`href="#/anime/${h.id}"`, `href="#/anime/${h.id}?ep=${h.episode}"`);
}

// --- Страница тайтла и просмотр ---

async function renderAnime(id, requestedEp) {
  app.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
  const anime = await getAnime(id);
  const total = episodeCount(anime);
  const history = getHistoryEntry(id);
  let episode = Math.min(Math.max(1, requestedEp || history?.episode || 1), Math.max(1, total));
  const altTitles = [anime.name, ...(anime.english || []), ...(anime.japanese || [])].filter((t) => t && t !== anime.russian);
  const bg = imageUrl(anime.image?.original);

  document.title = `${title(anime)} — AniStream`;

  app.innerHTML = `
    <div class="hero" ${bg ? `style="--hero-bg:url('${esc(bg)}')"` : ''}>
      <div class="hero-inner">
        <div class="hero-poster">${poster(anime)}</div>
        <div class="hero-info">
          <h1>${esc(title(anime))}</h1>
          ${altTitles.length ? `<div class="alt-titles">${altTitles.slice(0, 3).map(esc).join(' / ')}</div>` : ''}
          <div class="chips">
            ${Number(anime.score) > 0 ? `<span class="chip score">★ ${esc(anime.score)}</span>` : ''}
            <span class="chip">${esc(KIND[anime.kind] || anime.kind || '')}</span>
            ${year(anime) ? `<span class="chip">${esc(year(anime))}</span>` : ''}
            <span class="chip">${esc(STATUS[anime.status] || '')}</span>
            ${anime.episodes || anime.episodes_aired ? `<span class="chip">${anime.status === 'ongoing' ? `${anime.episodes_aired} из ${anime.episodes || '?'}` : anime.episodes} эп.</span>` : ''}
            ${anime.duration ? `<span class="chip">${anime.duration} мин.</span>` : ''}
            ${RATING[anime.rating] ? `<span class="chip">${RATING[anime.rating]}</span>` : ''}
          </div>
          <div class="genres">${(anime.genres || []).map((g) => `<a href="#/?genre=${g.id}">${esc(g.russian)}</a>`).join('')}</div>
          ${anime.studios?.length ? `<div class="muted small">Студия: ${anime.studios.map((s) => esc(s.name)).join(', ')}</div>` : ''}
          <div class="hero-actions">
            ${total ? `<a class="btn" href="#watch" id="watchBtn">▶ ${history ? `Продолжить · ${history.episode} серия` : 'Смотреть'}</a>` : ''}
            <button class="btn ghost" id="favBtn">${isFavorite(id) ? '♥ В избранном' : '♡ В избранное'}</button>
          </div>
        </div>
      </div>
    </div>

    <section class="desc" id="desc" hidden></section>

    ${total ? `
    <section class="watch" id="watch">
      <div class="watch-main">
        <div class="watch-head">
          <h2 id="epTitle"></h2>
          ${total > 1 ? `<select id="epSelect" class="ep-select" aria-label="Выбор серии">${
            Array.from({ length: total }, (_, i) => `<option value="${i + 1}">${i + 1} серия</option>`).join('')
          }</select>` : ''}
          <div class="ep-nav">
            <button class="btn ghost sm" id="prevEp">‹ Пред.</button>
            <button class="btn ghost sm" id="nextEp">След. ›</button>
          </div>
        </div>
        <div id="player"></div>
        <div class="demo-note" id="demoNote" hidden>
          Для этого тайтла пока нет загруженных серий — играет демо-ролик. Свои файлы подключаются через <code>media/library.json</code>.
        </div>
      </div>
      <aside class="watch-side">
        <div class="side-block">
          <div class="side-head"><h3>Серии · ${total}</h3>${total > 24 ? '<input type="number" min="1" id="epJump" placeholder="№">' : ''}</div>
          <div class="episodes" id="episodes"></div>
        </div>
        <div class="side-block">
          <h3>Озвучка</h3>
          <div class="dubs" id="dubs"></div>
        </div>
      </aside>
    </section>` : '<div class="empty">Серии ещё не вышли.</div>'}

    <section class="row" id="similarRow" hidden>
      <div class="row-head"><h2>Похожее</h2></div>
      <div class="scroller" id="similar"></div>
    </section>`;

  document.getElementById('favBtn').addEventListener('click', (e) => {
    e.currentTarget.textContent = toggleFavorite(anime) ? '♥ В избранном' : '♡ В избранное';
  });

  // Описание не входит в локальный каталог — подтягиваем с Shikimori, если он доступен
  (anime.description ? Promise.resolve(cleanDescription(anime.description)) : getDescription(id)).then((desc) => {
    const el = document.getElementById('desc');
    if (!desc || !el) return;
    el.innerHTML = `<p>${esc(desc).replace(/\n+/g, '</p><p>')}</p>`;
    el.hidden = false;
  });

  getSimilar(id).then((list) => {
    if (!list.length) return;
    document.getElementById('similar').innerHTML = list.slice(0, 20).map((a) => card(a)).join('');
    document.getElementById('similarRow').hidden = false;
  }).catch(() => {});

  if (!total) return;

  document.getElementById('watchBtn').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('watch').scrollIntoView({ behavior: 'smooth' });
  });

  const epList = document.getElementById('episodes');
  const dubList = document.getElementById('dubs');
  let currentSources = [];

  const renderEpisodes = () => {
    const progress = getEpisodeProgress(id);
    epList.innerHTML = Array.from({ length: total }, (_, i) => {
      const n = i + 1, p = progress[n] || 0;
      return `<button data-ep="${n}" class="${n === episode ? 'active' : ''} ${p > 0.9 ? 'watched' : ''}" title="${n} серия">${n}${p > 0.02 && p <= 0.9 ? `<i style="width:${p * 100}%"></i>` : ''}</button>`;
    }).join('');
    epList.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  const renderDubs = (activeId) => {
    dubList.innerHTML = currentSources.map((s) => `
      <button data-src="${esc(s.id)}" class="${s.id === activeId ? 'active' : ''}">
        <b>${esc(s.name)}</b>${s.team ? `<span>${esc(s.team)}</span>` : ''}
      </button>`).join('');
  };

  const openEpisode = async (n, { autoplay = false, sourceId = null } = {}) => {
    episode = n;
    // replaceState не вызывает hashchange — страница не перерисовывается
    window.history.replaceState(null, '', `#/anime/${id}?ep=${n}`);
    document.getElementById('epTitle').textContent = total > 1 ? '' : 'Фильм';
    const epSelect = document.getElementById('epSelect');
    if (epSelect) epSelect.value = String(n);
    document.getElementById('prevEp').disabled = n <= 1;
    document.getElementById('nextEp').disabled = n >= total;
    renderEpisodes();

    const { demo, sources } = await getEpisodeSources(id, n);
    currentSources = sources;
    document.getElementById('demoNote').hidden = !demo;
    const preferred = sourceId || getSourcePref(id);
    const active = sources.find((s) => s.id === preferred)?.id || sources[0].id;
    renderDubs(active);

    const saved = getHistoryEntry(id);
    const resume = saved && saved.episode === n && saved.time < saved.duration - 30 ? saved.time : 0;
    player.load({ sources, sourceId: active, startTime: resume, autoplay });
  };

  player = new Player(document.getElementById('player'), {
    hasNext: () => episode < total,
    onNext: (sourceId) => { if (episode < total) openEpisode(episode + 1, { autoplay: true, sourceId }); },
    onNearEnd: (sourceId) => { if (episode < total) prefetchEpisode(id, episode + 1, sourceId); },
    onProgress: (time, duration) => {
      saveProgress(anime, episode, time, duration);
      const btn = epList.querySelector(`[data-ep="${episode}"]`);
      if (btn && time / duration > 0.9) btn.classList.add('watched');
    },
  });

  epList.addEventListener('click', (e) => {
    const n = Number(e.target.closest('button')?.dataset.ep);
    if (n && n !== episode) openEpisode(n, { autoplay: true });
  });
  dubList.addEventListener('click', (e) => {
    const srcId = e.target.closest('button')?.dataset.src;
    if (!srcId || srcId === player.source?.id) return;
    setSourcePref(id, srcId);
    renderDubs(srcId);
    // Новая озвучка продолжает с того же момента
    player.setSource(srcId, player.video.currentTime, !player.video.paused);
  });
  document.getElementById('prevEp').addEventListener('click', () => episode > 1 && openEpisode(episode - 1, { autoplay: true }));
  document.getElementById('nextEp').addEventListener('click', () => episode < total && openEpisode(episode + 1, { autoplay: true }));
  document.getElementById('epSelect')?.addEventListener('change', (e) => {
    openEpisode(Number(e.target.value), { autoplay: true });
  });
  document.getElementById('epJump')?.addEventListener('change', (e) => {
    const n = Math.min(total, Math.max(1, Number(e.target.value) || 1));
    openEpisode(n, { autoplay: true });
    e.target.value = '';
  });

  await openEpisode(episode);
  if (requestedEp) document.getElementById('watch').scrollIntoView();
}

// --- История и избранное ---

function renderHistory() {
  document.title = 'История — AniStream';
  const items = getHistory();
  app.innerHTML = `
    <div class="row-head"><h2>История просмотра</h2></div>
    ${items.length ? `<div class="grid" id="hist">${items.map((h) => `<div class="card-wrap">${continueCard(h)}<button class="card-remove" data-id="${h.id}" title="Удалить из истории">×</button></div>`).join('')}</div>`
      : '<div class="empty">Вы ещё ничего не смотрели. <a href="#/">Открыть каталог</a></div>'}`;
  document.getElementById('hist')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.card-remove');
    if (!btn) return;
    removeHistory(Number(btn.dataset.id));
    btn.closest('.card-wrap').remove();
  });
}

function renderFavorites() {
  document.title = 'Избранное — AniStream';
  const items = getFavorites();
  app.innerHTML = `
    <div class="row-head"><h2>Избранное</h2></div>
    ${items.length ? `<div class="grid">${items.map((a) => card(a)).join('')}</div>`
      : '<div class="empty">Здесь появятся тайтлы, которые вы добавите в избранное.</div>'}`;
}

// --- Поиск в шапке ---

const topSearch = document.getElementById('topSearch');
const drop = document.getElementById('searchDrop');
const topInput = topSearch.querySelector('input');
let searchTimer, searchSeq = 0;

topInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = topInput.value.trim();
  if (q.length < 2) { drop.hidden = true; return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const list = await listAnimes({ search: q, order: 'popularity' }, 1);
      if (seq !== searchSeq) return;
      drop.innerHTML = list.length
        ? list.slice(0, 7).map((a) => `
            <a href="#/anime/${a.id}" class="drop-item">
              <span class="drop-img">${poster(a, 'x96')}</span>
              <span><b>${esc(title(a))}</b><small>${[KIND[a.kind], year(a)].filter(Boolean).map(esc).join(' · ')}</small></span>
            </a>`).join('') + `<a class="drop-all" href="#/?q=${encodeURIComponent(q)}">Все результаты ›</a>`
        : '<div class="drop-empty">Ничего не найдено</div>';
      drop.hidden = false;
    } catch { drop.hidden = true; }
  }, 300);
});
topSearch.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = topInput.value.trim();
  drop.hidden = true;
  if (q) location.hash = `#/?q=${encodeURIComponent(q)}`;
});
drop.addEventListener('click', () => { drop.hidden = true; topInput.value = ''; });
document.addEventListener('click', (e) => { if (!topSearch.contains(e.target)) drop.hidden = true; });

route();
