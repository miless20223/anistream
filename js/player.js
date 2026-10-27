// Плеер на hls.js: адаптивное качество, дорожки/субтитры, скорость, горячие клавиши,
// запоминание громкости, продолжение с места остановки, автопереход на следующую серию.
import { getPrefs, setPrefs } from './store.js';

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16.5" font-size="6.5" text-anchor="middle" font-family="sans-serif" font-weight="700">10</text></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16.5" font-size="6.5" text-anchor="middle" font-family="sans-serif" font-weight="700">10</text></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 5V4L8 9zm12.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 5V4L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.7 7.7 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.3 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.7 7.7 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.3-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>',
  pip: '<svg viewBox="0 0 24 24"><path d="M19 11h-8v6h8zm4 8V5a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2zm-2 0H3V5h18z"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 3v-3h2v5h-5v-2z"/></svg>',
  exitFull: '<svg viewBox="0 0 24 24"><path d="M8 5h2v5H5V8h3zm6 0h2v3h3v2h-5zM5 14h5v5H8v-3H5zm9 0h5v2h-3v3h-2z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6zm9-12v12h2V6z"/></svg>',
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const OPENING_SKIP = 85;

const fmt = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

export class Player {
  constructor(root, { onProgress, onNearEnd, onNext, hasNext } = {}) {
    this.root = root;
    this.onProgress = onProgress;
    this.onNearEnd = onNearEnd;
    this.onNext = onNext;
    this.hasNext = hasNext || (() => false);
    this.hls = null;
    this.lastSaved = 0;
    this.nearEndFired = false;
    this.prefs = getPrefs();
    this.render();
    this.bind();
  }

  render() {
    this.root.classList.add('player');
    this.root.tabIndex = 0;
    this.root.innerHTML = `
      <video playsinline preload="auto"></video>
      <div class="pl-spinner" hidden></div>
      <div class="pl-error" hidden></div>
      <div class="pl-flash" aria-hidden="true"></div>
      <button class="pl-big-play" aria-label="Смотреть">${ICON.play}</button>
      <button class="pl-chip pl-skip" hidden>Пропустить опенинг ›</button>
      <div class="pl-next-card" hidden>
        <span>Следующая серия через <b class="pl-next-count">5</b></span>
        <button class="pl-next-now">Смотреть</button>
        <button class="pl-next-cancel">Отмена</button>
      </div>
      <div class="pl-menu" hidden></div>
      <div class="pl-controls">
        <div class="pl-progress">
          <div class="pl-track"><div class="pl-buffered"></div><div class="pl-played"></div><div class="pl-thumb"></div></div>
          <div class="pl-tooltip" hidden>0:00</div>
        </div>
        <div class="pl-bar">
          <button data-act="play" aria-label="Воспроизвести">${ICON.play}</button>
          <button data-act="back" aria-label="Назад 10 с">${ICON.back}</button>
          <button data-act="fwd" aria-label="Вперёд 10 с">${ICON.fwd}</button>
          <button data-act="next" aria-label="Следующая серия" hidden>${ICON.next}</button>
          <div class="pl-volume">
            <button data-act="mute" aria-label="Звук">${ICON.vol}</button>
            <input type="range" min="0" max="1" step="0.02" aria-label="Громкость">
          </div>
          <span class="pl-time"><span class="pl-cur">0:00</span> / <span class="pl-dur">0:00</span></span>
          <span class="pl-spacer"></span>
          <span class="pl-quality-badge"></span>
          <button data-act="settings" aria-label="Настройки">${ICON.gear}</button>
          <button data-act="pip" aria-label="Картинка в картинке">${ICON.pip}</button>
          <button data-act="full" aria-label="Во весь экран">${ICON.full}</button>
        </div>
      </div>`;
    const $ = (s) => this.root.querySelector(s);
    this.video = $('video');
    this.el = {
      spinner: $('.pl-spinner'), error: $('.pl-error'), flash: $('.pl-flash'), bigPlay: $('.pl-big-play'),
      skip: $('.pl-skip'), nextCard: $('.pl-next-card'), nextCount: $('.pl-next-count'), menu: $('.pl-menu'),
      progress: $('.pl-progress'), buffered: $('.pl-buffered'), played: $('.pl-played'), thumb: $('.pl-thumb'),
      tooltip: $('.pl-tooltip'), play: $('[data-act=play]'), next: $('[data-act=next]'), mute: $('[data-act=mute]'),
      volume: $('.pl-volume input'), cur: $('.pl-cur'), dur: $('.pl-dur'), badge: $('.pl-quality-badge'),
      full: $('[data-act=full]'), pip: $('[data-act=pip]'),
    };
    if (!document.pictureInPictureEnabled) this.el.pip.hidden = true;
    this.video.volume = this.prefs.volume;
    this.video.muted = this.prefs.muted;
    this.el.volume.value = this.prefs.muted ? 0 : this.prefs.volume;
    this.updateVolumeIcon();
  }

  bind() {
    const v = this.video, el = this.el;
    this.listeners = [];
    const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); this.listeners.push([target, ev, fn, opts]); };

    on(this.root.querySelector('.pl-bar'), 'click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act) this.action(act);
    });
    el.bigPlay.addEventListener('click', () => this.toggle());
    el.skip.addEventListener('click', () => { v.currentTime = Math.min(v.duration || Infinity, v.currentTime + OPENING_SKIP); this.skipUsed = true; el.skip.hidden = true; });
    el.nextCard.querySelector('.pl-next-now').addEventListener('click', () => this.goNext());
    el.nextCard.querySelector('.pl-next-cancel').addEventListener('click', () => this.cancelNext());

    v.addEventListener('click', () => { if (!el.menu.hidden) return this.closeMenu(); this.toggle(); });
    v.addEventListener('dblclick', () => this.action('full'));
    v.addEventListener('play', () => this.syncPlay());
    v.addEventListener('pause', () => { this.syncPlay(); this.saveProgress(true); });
    v.addEventListener('waiting', () => (el.spinner.hidden = false));
    v.addEventListener('playing', () => { el.spinner.hidden = true; el.error.hidden = true; });
    v.addEventListener('canplay', () => (el.spinner.hidden = true));
    v.addEventListener('loadedmetadata', () => { el.dur.textContent = fmt(v.duration); });
    v.addEventListener('durationchange', () => { el.dur.textContent = fmt(v.duration); });
    v.addEventListener('timeupdate', () => this.onTime());
    v.addEventListener('progress', () => this.drawBuffered());
    v.addEventListener('ended', () => this.onEnded());
    // Перемотка или повторный запуск отменяют автопереход
    v.addEventListener('seeking', () => { if (!v.ended) this.cancelNext(); });
    v.addEventListener('play', () => this.cancelNext());
    v.addEventListener('volumechange', () => {
      el.volume.value = v.muted ? 0 : v.volume;
      this.updateVolumeIcon();
      setPrefs({ volume: v.volume, muted: v.muted });
    });
    v.addEventListener('ratechange', () => setPrefs({ speed: v.playbackRate }));

    el.volume.addEventListener('input', () => {
      v.volume = Number(el.volume.value);
      v.muted = v.volume === 0;
    });

    // Перемотка по полосе прогресса
    const seekAt = (clientX) => {
      const r = el.progress.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return ratio * (v.duration || 0);
    };
    el.progress.addEventListener('pointerdown', (e) => {
      el.progress.setPointerCapture(e.pointerId);
      this.scrubbing = true;
      this.previewSeek(seekAt(e.clientX));
    });
    el.progress.addEventListener('pointermove', (e) => {
      const t = seekAt(e.clientX);
      const r = el.progress.getBoundingClientRect();
      el.tooltip.hidden = false;
      el.tooltip.textContent = fmt(t);
      el.tooltip.style.left = `${Math.min(r.width - 24, Math.max(24, e.clientX - r.left))}px`;
      if (this.scrubbing) this.previewSeek(t);
    });
    el.progress.addEventListener('pointerleave', () => { if (!this.scrubbing) el.tooltip.hidden = true; });
    el.progress.addEventListener('pointerup', (e) => {
      if (!this.scrubbing) return;
      this.scrubbing = false;
      el.tooltip.hidden = true;
      v.currentTime = seekAt(e.clientX);
    });

    // Автоскрытие панели
    const wake = () => {
      this.root.classList.add('show-ui');
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        if (!v.paused && el.menu.hidden && !this.scrubbing) this.root.classList.remove('show-ui');
      }, 2500);
    };
    this.root.addEventListener('pointermove', wake);
    this.root.addEventListener('pointerdown', wake);
    this.root.addEventListener('keydown', (e) => this.onKey(e));
    on(document, 'keydown', (e) => {
      // Горячие клавиши работают на всей странице, если фокус не в поле ввода
      if (this.root.contains(document.activeElement) || e.target.closest?.('input, textarea, select')) return;
      this.onKey(e);
    });
    on(document, 'fullscreenchange', () => {
      const isFull = document.fullscreenElement === this.root;
      el.full.innerHTML = isFull ? ICON.exitFull : ICON.full;
      this.root.classList.toggle('is-full', isFull);
    });
    on(window, 'beforeunload', () => this.saveProgress(true));
    wake();
  }

  // --- Загрузка источника ---

  load({ sources, sourceId, startTime = 0, autoplay = false }) {
    this.sources = sources;
    this.cancelNext();
    this.nearEndFired = false;
    this.skipUsed = startTime > OPENING_SKIP;
    this.el.next.hidden = !this.hasNext();
    this.setSource(sourceId, startTime, autoplay);
  }

  setSource(sourceId, startTime = 0, autoplay = !this.video.paused) {
    const v = this.video;
    const src = this.sources.find((s) => s.id === sourceId) || this.sources[0];
    this.source = src;
    this.destroyHls();
    this.el.error.hidden = true;
    this.el.spinner.hidden = false;
    this.el.badge.textContent = '';
    this.closeMenu();

    const begin = () => {
      v.playbackRate = this.prefs.speed;
      if (autoplay) v.play().catch(() => this.syncPlay());
    };

    if (src.type === 'hls' && window.Hls?.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        startPosition: startTime > 0 ? startTime : -1,
        capLevelToPlayerSize: true,       // не тянуть 1080p в маленькое окно
        startLevel: -1,                   // стартовое качество по оценке канала
        abrEwmaDefaultEstimate: 4_000_000,
        maxBufferLength: 40,
        maxMaxBufferLength: 120,
        backBufferLength: 60,
        startFragPrefetch: true,
        fragLoadingMaxRetry: 6,
        manifestLoadingMaxRetry: 4,
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { this.updateBadge(); begin(); });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => this.updateBadge());
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else this.showError('Не удалось воспроизвести видео. Попробуйте другую озвучку.');
      });
      hls.loadSource(src.url);
      hls.attachMedia(v);
      this.hls = hls;
    } else if (src.type === 'mp4' || v.canPlayType('application/vnd.apple.mpegurl')) {
      // MP4 или нативный HLS (Safari/iOS)
      v.src = src.url;
      v.addEventListener('loadedmetadata', () => {
        if (startTime > 0) v.currentTime = startTime;
        begin();
      }, { once: true });
    } else {
      this.showError('Браузер не поддерживает HLS-видео.');
    }
  }

  destroyHls() {
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.video.removeAttribute('src');
    this.video.load();
  }

  destroy() {
    this.saveProgress(true);
    this.cancelNext();
    clearTimeout(this.idleTimer);
    this.destroyHls();
    for (const [t, ev, fn, opts] of this.listeners) t.removeEventListener(ev, fn, opts);
    if (document.fullscreenElement === this.root) document.exitFullscreen().catch(() => {});
  }

  // --- Управление ---

  toggle() {
    const v = this.video;
    if (v.paused || v.ended) v.play().catch(() => {});
    else v.pause();
    this.flash(v.paused ? ICON.pause : ICON.play);
  }

  action(act) {
    const v = this.video;
    switch (act) {
      case 'play': return this.toggle();
      case 'back': v.currentTime = Math.max(0, v.currentTime - 10); return this.flash(ICON.back);
      case 'fwd': v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); return this.flash(ICON.fwd);
      case 'mute': v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 0.5; return;
      case 'next': return this.goNext();
      case 'settings': return this.el.menu.hidden ? this.openMenu() : this.closeMenu();
      case 'pip':
        if (document.pictureInPictureElement) document.exitPictureInPicture();
        else v.requestPictureInPicture?.().catch(() => {});
        return;
      case 'full':
        if (document.fullscreenElement) document.exitFullscreen();
        else (this.root.requestFullscreen?.() || v.webkitEnterFullscreen?.());
        return;
    }
  }

  onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const v = this.video;
    const key = e.key.toLowerCase();
    const handled = {
      ' ': () => this.toggle(), k: () => this.toggle(), 'л': () => this.toggle(),
      arrowleft: () => { v.currentTime = Math.max(0, v.currentTime - 5); },
      arrowright: () => { v.currentTime = Math.min(v.duration || 0, v.currentTime + 5); },
      j: () => this.action('back'), l: () => this.action('fwd'),
      arrowup: () => { v.muted = false; v.volume = Math.min(1, v.volume + 0.1); },
      arrowdown: () => { v.volume = Math.max(0, v.volume - 0.1); },
      f: () => this.action('full'), 'а': () => this.action('full'),
      m: () => this.action('mute'), 'ь': () => this.action('mute'),
      n: () => this.hasNext() && this.goNext(), 'т': () => this.hasNext() && this.goNext(),
      escape: () => this.closeMenu(),
    }[key];
    if (handled) { e.preventDefault(); handled(); return; }
    if (/^[0-9]$/.test(key) && v.duration) { v.currentTime = (Number(key) / 10) * v.duration; }
  }

  // --- Отрисовка состояния ---

  syncPlay() {
    const paused = this.video.paused;
    this.el.play.innerHTML = paused ? ICON.play : ICON.pause;
    this.el.bigPlay.hidden = !paused;
    this.root.classList.toggle('is-paused', paused);
    if (paused) this.root.classList.add('show-ui');
  }

  updateVolumeIcon() {
    this.el.mute.innerHTML = this.video.muted || this.video.volume === 0 ? ICON.mute : ICON.vol;
  }

  flash(icon) {
    const f = this.el.flash;
    f.innerHTML = icon;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  previewSeek(t) {
    const d = this.video.duration || 1;
    this.el.played.style.width = `${(t / d) * 100}%`;
    this.el.thumb.style.left = `${(t / d) * 100}%`;
    this.el.cur.textContent = fmt(t);
  }

  onTime() {
    const v = this.video;
    if (!this.scrubbing) this.previewSeek(v.currentTime);
    this.drawBuffered();
    this.el.skip.hidden = this.skipUsed || v.currentTime < 5 || v.currentTime > 240 || (v.duration && v.duration < 600);
    this.saveProgress(false);
    if (v.duration && !this.nearEndFired && v.currentTime / v.duration > 0.8) {
      this.nearEndFired = true;
      this.onNearEnd?.(this.source?.id);
    }
  }

  drawBuffered() {
    const v = this.video, b = v.buffered;
    if (!v.duration || !b.length) return;
    let end = 0;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= v.currentTime + 0.5) end = Math.max(end, b.end(i));
    }
    this.el.buffered.style.width = `${(end / v.duration) * 100}%`;
  }

  saveProgress(force) {
    const v = this.video;
    if (!this.onProgress || !v.duration || !Number.isFinite(v.duration)) return;
    const now = Date.now();
    if (!force && now - this.lastSaved < 5000) return;
    this.lastSaved = now;
    this.onProgress(v.currentTime, v.duration);
  }

  updateBadge() {
    const lvl = this.hls?.levels?.[this.hls.currentLevel];
    this.el.badge.textContent = lvl?.height ? `${lvl.height}p${this.hls.autoLevelEnabled ? ' · авто' : ''}` : '';
  }

  showError(text) {
    this.el.spinner.hidden = true;
    this.el.error.hidden = false;
    this.el.error.textContent = text;
  }

  // --- Следующая серия ---

  onEnded() {
    this.saveProgress(true);
    if (!this.hasNext() || !getPrefs().autoNext) return;
    let left = 5;
    this.el.nextCount.textContent = left;
    this.el.nextCard.hidden = false;
    this.nextTimer = setInterval(() => {
      left -= 1;
      this.el.nextCount.textContent = left;
      if (left <= 0) this.goNext();
    }, 1000);
  }

  cancelNext() {
    clearInterval(this.nextTimer);
    this.nextTimer = null;
    this.el.nextCard.hidden = true;
  }

  goNext() {
    this.cancelNext();
    this.onNext?.(this.source?.id);
  }

  // --- Меню настроек: качество, дорожка, субтитры, скорость ---

  openMenu() {
    const m = this.el.menu;
    const hls = this.hls;
    const sections = [];

    if (hls?.levels?.length) {
      const levels = hls.levels
        .map((l, i) => ({ i, h: l.height, br: l.bitrate }))
        .filter((l) => l.h)
        .sort((a, b) => b.h - a.h || b.br - a.br)
        .filter((l, idx, arr) => idx === 0 || arr[idx - 1].h !== l.h);
      const manual = hls.autoLevelEnabled ? -1 : hls.nextLevel === -1 ? hls.currentLevel : hls.nextLevel;
      const autoLabel = hls.autoLevelEnabled && hls.levels[hls.currentLevel]?.height ? ` (${hls.levels[hls.currentLevel].height}p)` : '';
      sections.push(this.menuSection('Качество', 'quality', [
        { value: -1, label: `Авто${autoLabel}`, active: hls.autoLevelEnabled },
        ...levels.map((l) => ({ value: l.i, label: `${l.h}p${l.h >= 1080 ? ' HD' : ''}`, active: manual === l.i })),
      ]));
    }

    if (hls?.audioTracks?.length > 1) {
      sections.push(this.menuSection('Аудиодорожка', 'audio', hls.audioTracks.map((t, i) => ({
        value: i, label: t.name || t.lang || `Дорожка ${i + 1}`, active: hls.audioTrack === i,
      }))));
    }

    if (hls?.subtitleTracks?.length) {
      sections.push(this.menuSection('Субтитры', 'subs', [
        { value: -1, label: 'Выключены', active: hls.subtitleTrack === -1 },
        ...hls.subtitleTracks.map((t, i) => ({ value: i, label: t.name || t.lang || `Субтитры ${i + 1}`, active: hls.subtitleTrack === i })),
      ]));
    }

    sections.push(this.menuSection('Скорость', 'speed', SPEEDS.map((s) => ({
      value: s, label: s === 1 ? 'Обычная' : `${s}×`, active: this.video.playbackRate === s,
    }))));

    const autoNext = getPrefs().autoNext;
    sections.push(`<label class="pl-menu-toggle"><input type="checkbox" data-kind="autonext" ${autoNext ? 'checked' : ''}> Автопереход к следующей серии</label>`);

    m.innerHTML = sections.join('');
    m.hidden = false;
    m.onclick = (e) => {
      const btn = e.target.closest('button[data-kind]');
      if (!btn) return;
      const value = Number(btn.dataset.value);
      if (btn.dataset.kind === 'quality') {
        // nextLevel переключает без сброса буфера — без паузы и рывка
        if (value === -1) hls.currentLevel = -1;
        else hls.nextLevel = value;
        setTimeout(() => this.updateBadge(), 50);
      }
      if (btn.dataset.kind === 'audio') hls.audioTrack = value;
      if (btn.dataset.kind === 'subs') { hls.subtitleDisplay = value !== -1; hls.subtitleTrack = value; }
      if (btn.dataset.kind === 'speed') this.video.playbackRate = value;
      this.openMenu();
    };
    m.onchange = (e) => {
      if (e.target.dataset.kind === 'autonext') setPrefs({ autoNext: e.target.checked });
    };
  }

  menuSection(title, kind, items) {
    return `<div class="pl-menu-sec"><div class="pl-menu-title">${title}</div><div class="pl-menu-items">${
      items.map((it) => `<button data-kind="${kind}" data-value="${it.value}" class="${it.active ? 'active' : ''}">${it.label}</button>`).join('')
    }</div></div>`;
  }

  closeMenu() {
    this.el.menu.hidden = true;
  }
}
