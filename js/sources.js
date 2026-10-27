// Источники видео. Каждая озвучка — отдельный HLS-поток (master.m3u8 с несколькими качествами).
// Свой контент описывается в media/library.json (формат — в README.md).
// Пока для тайтла нет своих файлов, показываются демо-ролики с открытой лицензией.

const DEMO_SOURCES = [
  {
    id: 'demo-bbb',
    name: 'Big Buck Bunny',
    team: 'Демо · Blender Foundation',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  },
  {
    id: 'demo-tos',
    name: 'Tears of Steel',
    team: 'Демо · Blender Foundation',
    url: 'https://test-streams.mux.dev/tos_ismc/main.m3u8',
  },
  {
    id: 'demo-apple',
    name: 'Apple HLS',
    team: 'Демо · субтитры, 60 fps',
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
  },
];

let libraryPromise;

function loadLibrary() {
  libraryPromise ||= fetch('media/library.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return libraryPromise;
}

export async function getEpisodeSources(animeId, episode) {
  const library = await loadLibrary();
  const own = library[animeId]?.episodes?.[episode];
  if (Array.isArray(own) && own.length) {
    return { demo: false, sources: own.map((s, i) => ({ id: s.id || `src-${i}`, type: 'hls', ...s })) };
  }
  return { demo: true, sources: DEMO_SOURCES.map((s) => ({ type: 'hls', ...s })) };
}

// Прогрев следующей серии: заранее тянем манифест, чтобы переход был мгновенным.
export async function prefetchEpisode(animeId, episode, sourceId) {
  const { sources } = await getEpisodeSources(animeId, episode);
  const src = sources.find((s) => s.id === sourceId) || sources[0];
  if (src?.type === 'hls') fetch(src.url, { mode: 'cors' }).catch(() => {});
}
