# AniStream — прототип аниме-сайта

Каталог (данные Shikimori), страница тайтла, список серий, выбор озвучки и HLS-плеер.
Сборка не нужна: чистый HTML/CSS/JS + [hls.js](https://github.com/video-dev/hls.js).

## Запуск

```powershell
powershell -ExecutionPolicy Bypass -File server.ps1
```

Откройте http://localhost:5500

## Структура

| Файл | Что делает |
|---|---|
| `catalog/` | Весь каталог аниме (выгрузка Shikimori): `index.json` — список, `details/*.json` — доп. поля |
| `tools/export-catalog.ps1` | Обновить каталог: `powershell -ExecutionPolicy Bypass -File tools\export-catalog.ps1` (~15 мин) |
| `js/api.js` | Каталог, поиск, фильтры, жанры, похожие — локально из `catalog/`. С Shikimori берётся только описание |
| `js/player.js` | Плеер: адаптивное качество, ручной выбор качества, аудиодорожки, субтитры, скорость, PiP, полноэкранный режим, горячие клавиши, «пропустить опенинг», автопереход |
| `js/sources.js` | Откуда брать видео серии (озвучки) |
| `js/store.js` | История, прогресс серий, избранное, настройки (localStorage) |
| `js/app.js` | Роутинг и страницы |
| `media/library.json` | Ваш видеоконтент |

## Подключение своих серий

Ключ — id тайтла на Shikimori (виден в адресе: `#/anime/62913`). Для каждой серии — список озвучек:

```json
{
  "62913": {
    "episodes": {
      "1": [
        { "id": "studio-a", "name": "Студия A", "team": "Многоголосая", "url": "/media/62913/1/studio-a/master.m3u8" },
        { "id": "subs",     "name": "Оригинал",  "team": "Субтитры",     "url": "https://cdn.example.com/62913/1/orig/master.m3u8" }
      ]
    }
  }
}
```

Одинаковый `id` озвучки во всех сериях — тогда плеер запоминает выбор и сохраняет его при переходе на следующую серию.
Поддерживаются `"type": "hls"` (по умолчанию) и `"type": "mp4"`.

## Как сделать, чтобы не лагало

1. Нарезайте видео в HLS с несколькими качествами — плеер сам выберет подходящее под скорость интернета:

   ```bash
   ffmpeg -i episode.mkv -filter_complex "[0:v]split=3[v1][v2][v3];[v1]scale=-2:1080[v1o];[v2]scale=-2:720[v2o];[v3]scale=-2:480[v3o]" \
     -map "[v1o]" -c:v:0 libx264 -b:v:0 5000k -maxrate:v:0 5500k -bufsize:v:0 10000k \
     -map "[v2o]" -c:v:1 libx264 -b:v:1 2800k -maxrate:v:1 3000k -bufsize:v:1 5600k \
     -map "[v3o]" -c:v:2 libx264 -b:v:2 1200k -maxrate:v:2 1300k -bufsize:v:2 2400k \
     -map a:0 -map a:0 -map a:0 -c:a aac -b:a 128k -ac 2 \
     -preset veryfast -g 48 -keyint_min 48 -sc_threshold 0 \
     -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 \
     -master_pl_name master.m3u8 -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
     -hls_segment_filename "%v/seg_%03d.m4s" "%v/index.m3u8"
   ```

2. Раздавайте файлы через CDN (Cloudflare R2, Bunny CDN, BunnyStream и т. п.), а не с одного сервера.
3. Короткие сегменты (4 с) и фиксированный GOP — быстрый старт и мгновенная перемотка.

## Что дальше

- Бэкенд с аккаунтами (история и избранное между устройствами), комментарии, админка для загрузки серий.
- Расписание онгоингов, уведомления о новых сериях.
- Миграция на Next.js для SEO (страницы тайтлов рендерятся на сервере).
