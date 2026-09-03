#!/usr/bin/env python3
"""Carimba o hash do conteudo nas URLs de CSS/JS de todas as paginas HTML.

Por que isto existe
-------------------
O nome do arquivo nao muda quando o conteudo muda. Um navegador que ja
guardou /assets/css/site.css continua servindo a versao velha contra o HTML
novo — e o visitante ve uma pagina meio quebrada, com o texto lavado ou
invisivel. Aconteceu em 27/08/2026 e de novo em 03/09/2026, quando o site no
ar estava com CSS Aurum e o Chrome do Rafael renderizava o design antigo.

Cache-Control nao resolve sozinho: quem baixou o arquivo enquanto valia uma
politica longa fica com ele ate aquela validade expirar. A unica correcao
confiavel e mudar a URL.

Rode isto ANTES de cada deploy:
    python3 tools/versionar.py
E idempotente: reescreve o ?v= existente em vez de empilhar.
"""
import hashlib, pathlib, re, sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
ATIVOS = ["assets/css/site.css", "assets/js/site.js", "assets/js/consent.js"]

def hash_curto(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()[:8]

hashes = {}
for rel in ATIVOS:
    p = RAIZ / rel
    if not p.exists():
        print(f"  ! ausente, ignorado: {rel}"); continue
    hashes[rel] = hash_curto(p)

mudou = 0
for html in sorted(RAIZ.rglob("*.html")):
    if any(parte in {"node_modules", ".git", "_site-backups"} for parte in html.parts):
        continue
    txt = original = html.read_text(encoding="utf-8")
    for rel, h in hashes.items():
        # casa /assets/x.css ou /assets/x.css?v=qualquercoisa
        padrao = re.compile(r'(["\'])(/' + re.escape(rel) + r')(\?v=[A-Za-z0-9]+)?\1')
        txt = padrao.sub(lambda m: f'{m.group(1)}{m.group(2)}?v={h}{m.group(1)}', txt)
    if txt != original:
        html.write_text(txt, encoding="utf-8"); mudou += 1

for rel, h in hashes.items():
    print(f"  {rel} -> ?v={h}")
print(f"  {mudou} pagina(s) HTML atualizada(s)")
