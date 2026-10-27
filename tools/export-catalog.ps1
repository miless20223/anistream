# Выгружает весь каталог аниме с Shikimori в catalog/ (запуск: powershell -ExecutionPolicy Bypass -File tools\export-catalog.ps1)
# catalog/index.json      — компактный список для каталога, поиска и фильтров
# catalog/details/N.json  — дополнительные поля тайтлов, разбитые на BUCKETS файлов по id % BUCKETS
# Описания не сохраняются: сайт подгружает их с Shikimori на странице тайтла.
param([int]$Buckets = 64, [int]$DelayMs = 750)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root 'catalog'
$detailsDir = Join-Path $outDir 'details'
New-Item -ItemType Directory -Force $detailsDir | Out-Null
$api = 'https://shikimori.io/api/graphql'
$inv = [Globalization.CultureInfo]::InvariantCulture

function Invoke-Graph([string]$query) {
  $body = [Text.Encoding]::UTF8.GetBytes((@{ query = $query } | ConvertTo-Json -Compress))
  for ($try = 1; $try -le 6; $try++) {
    try {
      $res = Invoke-WebRequest -Uri $api -Method Post -Body $body -ContentType 'application/json' -UserAgent 'AniStream catalog export' -UseBasicParsing
      $text = [Text.Encoding]::UTF8.GetString($res.RawContentStream.ToArray())
      return ($text | ConvertFrom-Json).data
    } catch {
      Write-Host "  повтор $try после ошибки: $($_.Exception.Message)"
      Start-Sleep -Seconds (5 * $try)
    }
  }
  throw "Shikimori не отвечает"
}

$fields = 'id name russian english japanese synonyms kind score status episodes episodesAired duration rating airedOn { year date } releasedOn { date } poster { previewUrl mainUrl } genres { id } studios { name }'

function Get-AllPages([string]$order) {
  $list = New-Object System.Collections.ArrayList
  for ($page = 1; ; $page++) {
    $data = Invoke-Graph "{ animes(limit: 50, page: $page, order: $order, censored: true) { $fields } }"
    $batch = @($data.animes)
    if ($batch.Count -eq 0) { break }
    [void]$list.AddRange($batch)
    if ($page % 20 -eq 0) { Write-Host "  $order`: страница $page, тайтлов $($list.Count)" }
    Start-Sleep -Milliseconds $DelayMs   # лимит API — 90 запросов в минуту
  }
  return $list
}

# --- JSON без экранирования кириллицы (ConvertTo-Json в PS 5 раздувает файл в разы) ---
function J($v) {
  if ($null -eq $v) { return 'null' }
  if ($v -is [string]) {
    $s = $v -replace '\\', '\\' -replace '"', '\"' -replace "`r", '' -replace "`n", '\n' -replace "`t", '\t'
    return '"' + $s + '"'
  }
  if ($v -is [bool]) { return $(if ($v) { 'true' } else { 'false' }) }
  if ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal]) { return $v.ToString($inv) }
  if ($v -is [System.Collections.IDictionary]) {
    return '{' + ((@($v.Keys) | ForEach-Object { (J ([string]$_)) + ':' + (J $v[$_]) }) -join ',') + '}'
  }
  if ($v -is [System.Collections.IEnumerable]) {
    return '[' + ((@($v) | ForEach-Object { J $_ }) -join ',') + ']'
  }
  return J ([string]$v)
}

function Save-Json([string]$path, [string]$json) {
  [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding $false))
}

# Из полного URL постера оставляем только имя файла — остальное восстанавливается по id
function Poster-File($url, $id) {
  if (-not $url -or $url -match 'missing') { return '' }
  $prefix = "https://shikimori.io/uploads/poster/animes/$id/"
  if ($url.StartsWith($prefix)) { return $url.Substring($prefix.Length) }
  return $url
}

Write-Host 'Жанры…'
$genresRaw = Invoke-RestMethod -Uri 'https://shikimori.io/api/genres' -UserAgent 'AniStream catalog export'
$genres = @($genresRaw | Where-Object { $_.entry_type -eq 'Anime' } | Sort-Object russian | ForEach-Object {
  ,@([int]$_.id, [string]$_.russian, $(if ($_.kind -eq 'genre') { 'g' } elseif ($_.kind -eq 'theme') { 't' } else { 'd' }))
})

Write-Host 'Каталог по популярности…'
$byPopularity = Get-AllPages 'popularity'
Write-Host 'Каталог по id (добираем пропущенное)…'
$byId = Get-AllPages 'id'

$all = [ordered]@{}
foreach ($a in $byPopularity) { if (-not $all.Contains([string]$a.id)) { $all[[string]$a.id] = $a } }
foreach ($a in $byId) { if (-not $all.Contains([string]$a.id)) { $all[[string]$a.id] = $a } }
Write-Host "Всего тайтлов: $($all.Count)"

# Порядок в index.json = порядок популярности; тайтлы, которых нет в выдаче по популярности, — в конце
$items = New-Object System.Collections.ArrayList
$details = @{}
foreach ($a in $all.Values) {
  $id = [int]$a.id
  $year = if ($a.airedOn.year) { [int]$a.airedOn.year } else { $null }
  $genreIds = @($a.genres | ForEach-Object { [int]$_.id })
  [void]$items.Add(@(
    $id, [string]$a.russian, [string]$a.name, [string]$a.english, [string]$a.kind,
    [double]$a.score, [string]$a.status, [int]$a.episodes, [int]$a.episodesAired, $year,
    (Poster-File $a.poster.previewUrl $id), $genreIds
  ))
  $bucket = $id % $Buckets
  if (-not $details[$bucket]) { $details[$bucket] = [ordered]@{} }
  $details[$bucket][[string]$id] = [ordered]@{
    jp = [string]$a.japanese
    syn = @($a.synonyms | Where-Object { $_ })
    dur = [int]$a.duration
    rating = [string]$a.rating
    date = [string]$a.airedOn.date
    rel = [string]$a.releasedOn.date
    main = (Poster-File $a.poster.mainUrl $id)
    studios = @($a.studios | ForEach-Object { [string]$_.name })
  }
}

Write-Host 'Сохраняю…'
$index = [ordered]@{
  v = 1
  updated = (Get-Date).ToString('yyyy-MM-dd')
  buckets = $Buckets
  fields = @('id', 'russian', 'name', 'english', 'kind', 'score', 'status', 'episodes', 'episodesAired', 'year', 'poster', 'genres')
  genres = $genres
  items = $items
}
Save-Json (Join-Path $outDir 'index.json') (J $index)
foreach ($b in $details.Keys) { Save-Json (Join-Path $detailsDir "$b.json") (J $details[$b]) }

$size = [math]::Round((Get-Item (Join-Path $outDir 'index.json')).Length / 1MB, 2)
Write-Host "Готово: $($items.Count) тайтлов, index.json = $size МБ"
