# Publica o site. Use SEMPRE isto em vez de chamar o wrangler direto.
#
# O passo do versionar.py nao e opcional: sem ele o navegador de quem ja
# visitou continua usando o CSS/JS antigo contra o HTML novo, e a pagina
# chega quebrada — texto lavado, invisivel, ou o design errado inteiro.
# Aconteceu em 27/08/2026 e em 03/09/2026.
#
#   .\tools\publicar.ps1

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "1/3  Carimbando a versao nos ativos..." -ForegroundColor Cyan
python3 tools/versionar.py
if ($LASTEXITCODE -ne 0) { python tools/versionar.py }

$pendente = git status --porcelain
if ($pendente) {
  Write-Host ""
  Write-Host "     O versionar.py mudou arquivos. Faca o commit antes de publicar:" -ForegroundColor Yellow
  git status --short
  Write-Host ""
  Write-Host "     git add -A ; git commit -m 'Carimba versao dos ativos' ; git push origin main" -ForegroundColor Yellow
  exit 1
}

Write-Host "2/3  Enviando para o GitHub..." -ForegroundColor Cyan
git push origin main

Write-Host "3/3  Publicando no Cloudflare..." -ForegroundColor Cyan
npx wrangler deploy

Write-Host ""
Write-Host "Publicado. Confira em uma janela anonima — nao na aba que ja estava aberta." -ForegroundColor Green
