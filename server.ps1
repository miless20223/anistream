# Простой статический сервер для разработки: .\server.ps1 [-Port 5500]
param([int]$Port = 5500)

$root = $PSScriptRoot
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.webp' = 'image/webp'
  '.ico' = 'image/x-icon'; '.m3u8' = 'application/vnd.apple.mpegurl'; '.ts' = 'video/mp2t'
  '.m4s' = 'video/iso.segment'; '.mp4' = 'video/mp4'; '.vtt' = 'text/vtt; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "AniStream: http://localhost:$Port/  (Ctrl+C - остановить)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $path.StartsWith($root) -or -not (Test-Path $path -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
      } else {
        $ext = [IO.Path]::GetExtension($path).ToLower()
        $res.ContentType = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
        $res.AddHeader('Cache-Control', $(if ($ext -in '.ts', '.m4s', '.jpg', '.png', '.webp') { 'max-age=86400' } else { 'no-cache' }))
        $bytes = [IO.File]::ReadAllBytes($path)
      }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
