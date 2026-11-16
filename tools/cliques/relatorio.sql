-- Relatório semanal dos cliques de anúncio da Laine (16/11/2026). Rodar no painel da Cloudflare:
-- Workers & Pages → D1 → lainebitencourt-cliques → Console. Nada aqui muda a conta do Google Ads.
-- As exclusões são automáticas (worker/cliques.js → decideBlocks); isto é a conferência humana.

-- 0 · Rodar primeiro: a promessa de 90 dias da Política de Privacidade.
DELETE FROM clicks WHERE ts < datetime('now', '-90 days');
DELETE FROM blocks WHERE status = 'ended' AND created_ts < datetime('now', '-90 days');

-- 1 · A semana: cliques, redes distintas, cliques que viraram contato.
SELECT COUNT(*) AS cliques, COUNT(DISTINCT net) AS redes, SUM(contato) AS contatos
FROM clicks WHERE ts >= datetime('now', '-7 days');

-- 2 · Mesma rede, 3+ cliques em 7 dias, sem contato (em IPv4 é só para olhar: não bloqueia, por causa do CGNAT).
SELECT net, COUNT(DISTINCT click_id) AS cliques, MIN(ts) AS primeiro, MAX(ts) AS ultimo,
       MAX(as_org) AS rede, MAX(city) AS cidade, GROUP_CONCAT(DISTINCT page) AS paginas
FROM clicks WHERE ts >= datetime('now', '-7 days')
GROUP BY net HAVING COUNT(DISTINCT click_id) >= 3 AND SUM(contato) = 0 ORDER BY cliques DESC;

-- 3 · Cliques por rede (provedor): ajuda a ver se algum data center escapou da regra.
SELECT as_org AS rede, asn, COUNT(*) AS cliques, COUNT(DISTINCT ip) AS ips, SUM(contato) AS contatos
FROM clicks WHERE ts >= datetime('now', '-7 days') GROUP BY as_org, asn ORDER BY cliques DESC LIMIT 30;

-- 4 · Cliques de fora do Brasil.
SELECT country, COUNT(*) AS cliques, COUNT(DISTINCT ip) AS ips
FROM clicks WHERE ts >= datetime('now', '-7 days') AND (country IS NULL OR country <> 'BR')
GROUP BY country ORDER BY cliques DESC;

-- 5 · Por página e campanha, com a taxa de contato.
SELECT page, campaign, COUNT(*) AS cliques, SUM(contato) AS contatos,
       ROUND(100.0 * SUM(contato) / COUNT(*), 1) AS pct_contato
FROM clicks WHERE ts >= datetime('now', '-7 days') GROUP BY page, campaign ORDER BY cliques DESC;

-- 6 · O que o bloqueio fez nos últimos 30 dias.
SELECT ip, rule, status, end_reason, clicks, network, place, created_ts, until_ts, end_ts
FROM blocks WHERE created_ts >= datetime('now', '-30 days') ORDER BY created_ts DESC;

-- 7 · O script ainda roda? last_run deve ter menos de ~2 horas enquanto os anúncios rodam.
SELECT k, v FROM meta WHERE k = 'last_run';
