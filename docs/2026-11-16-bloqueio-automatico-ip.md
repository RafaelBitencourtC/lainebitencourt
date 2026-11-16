# 16/11/2026 · Bloqueio automático de IP (o "ClickCease nosso") no site da Laine

Pedido: Rafael, 16/11: "podemos colocar o código que simula o ClickCease no site dela também?" e "vou com as suas
recomendações". Os anúncios da Laine começam em 16/11. Porte do que a A1 roda desde 25/10/2026
(a1windows-site, docs/rodadas/2026-10-25-bloqueio-automatico-ip.md), com as regras trocadas para o Brasil.

## Como funciona

1. Visita com `gclid`/`gbraid`/`wbraid` na URL → o `site.js` manda 1 beacon para `POST /api/click` (uma vez por clique
   por aba). O Worker grava no D1 `lainebitencourt-cliques`: IP, rede /64, navegador, país/cidade/rede (request.cf),
   página, utm_campaign.
2. Toque em WhatsApp, telefone ou e-mail nessa mesma aba → beacon `event: 'contato'`, que só marca a linha (`contato = 1`).
3. De hora em hora o script do Google Ads (`tools/ads-script/exclusoes-ip.js`) manda as exclusões de IP da conta para
   `POST /api/blocklist` (chave `BLOCKLIST_KEY`), recebe o que pôr e tirar, aplica e manda e-mail quando algo muda.

## Regras (worker/cliques.js → decideBlocks)

Bloqueia por 30 dias (só cliques de anúncio, só navegador de verdade):
- `robot`: navegador de automação, ou que se diz Google fora da rede do Google.
- `hosting`: 1 clique de data center (AWS, Google Cloud, Azure, Locaweb, OVH, Hetzner…).
- `abroad`: 1 clique de fora do Brasil.
- `repeat`: 3+ cliques distintos em 7 dias **do mesmo IPv6 /64**, sem nenhum contato.

**Diferença da A1:** `repeat` nunca vale para IPv4. No Brasil quase todo provedor (Vivo, Claro, TIM, Oi e os de casa)
divide um IPv4 entre muitos clientes (CGNAT): 3 cliques de um IPv4 podem ser 3 pessoas. IPv4 só sai por robô,
servidor ou fora do Brasil.

Nunca bloqueia: rede do Google (15169), iCloud Private Relay / Cloudflare WARP / Fastly, beacon sem navegador (curl),
exclusões digitadas à mão, IP que o Rafael tirou à mão (não volta). Toque em contato só cancela `repeat` (o beacon é
público; um robô poderia mandar um para si). Limites: 50 novos por hora, 100 por dia, 400 nossos na lista (o Google
aceita 500), 500 linhas gravadas por dia.

Seguro por padrão: sem `BLOCKLIST_KEY` → 503 e nada é bloqueado; chave errada → 401; o visitante nunca espera nem vê
erro (o `/api/click` responde 204 na hora).

## LGPD

Base legal: legítimo interesse, prevenção a fraude (art. 7º, IX). Política de Privacidade ganhou a seção "Proteção
contra cliques inválidos em anúncios", uma frase em "Compartilhamento" (IPs suspeitos vão à Google) e o prazo de 90 dias
em "Prazo de guarda". Não depende do aviso de cookies: não grava cookie; o id do clique fica no sessionStorage da aba.

## Para ligar

1. `npx wrangler d1 create lainebitencourt-cliques` → pôr o `database_id` no `wrangler.jsonc`.
2. O Rafael cola a `BLOCKLIST_KEY` no Cloudflare: Workers & Pages → lainebitencourt → Settings → Variables and Secrets
   → Add → tipo **Secret**.
3. Deploy (`tools/publicar.ps1`).
4. O Rafael cola o script no Google Ads da Laine (Ferramentas → Ações em massa → Scripts), com a chave e o e-mail,
   Autorizar → Preview → Salvar → de hora em hora.

Testes: `node --test worker/cliques.test.mjs` (16 casos das regras). Relatório semanal: `tools/cliques/relatorio.sql`.
