// Registro de cliques de anúncio + bloqueio automático de IP (16/11/2026): o "ClickCease nosso" do site da Laine.
// Porte do que a A1 roda desde 25/10/2026 (a1windows-site, functions/api/_clicks.js), com as regras trocadas para o
// Brasil. Contrato completo: docs/2026-11-16-bloqueio-automatico-ip.md.
//
// Toda visita que chega com id de clique do Google Ads (gclid / gbraid / wbraid) é gravada no D1: hora, id do clique,
// IP, navegador, cidade e rede aproximadas (request.cf), página de chegada, utm_campaign — e depois se aquela visita
// tocou em WhatsApp, telefone ou e-mail. De hora em hora o script do Google Ads (tools/ads-script/exclusoes-ip.js)
// pergunta ao /api/blocklist quais IPs excluir: as regras são decideBlocks() abaixo, as exclusões ficam na CONTA por 30
// dias e ninguém digita nada. A API do Google Ads nunca mostra o IP de quem clicou; sem este registro, é chute.
//
// Binding: D1 como CLICKS (wrangler.jsonc). Sem ele tudo aqui não faz nada e avisa uma vez: o registro nunca pode custar
// nada ao visitante, muito menos um contato.
// Privacidade: /politica-de-privacidade/ "Proteção contra cliques inválidos" (o quê, por quê, 90 dias).

export const CLICK_KINDS = Object.freeze(['gclid', 'gbraid', 'wbraid']);
export const RETENTION_DAYS = 90;
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

// → { kind, id } ou null. Aceita { kind, id } (o que o site.js manda) e nada mais.
export function normalizeClick(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const kind = typeof raw.kind === 'string' ? raw.kind.toLowerCase() : '';
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!CLICK_KINDS.includes(kind) || !ID_RE.test(id)) return null;
  return { kind, id };
}

// ─── Endereços IP ───
// Uma grafia por endereço, para o que mandamos ao Google e o que o Google lista de volta baterem: IPv4 como quatro
// números, IPv6 minúsculo e comprimido (RFC 5952), IPv6 que embute um IPv4 vira o IPv4. Outra coisa → null.
function v6numbers(s) {
  const tail = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (tail) {
    const o = tail.slice(2).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = tail[1] + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  let groups;
  if (rest === null) groups = head;
  else {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = head.concat(Array(fill).fill('0'), rest);
  }
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}
function v6text(n) {
  let at = -1, len = 0;
  for (let i = 0; i < 8;) {
    if (n[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && n[j] === 0) j++;
    if (j - i >= 2 && j - i > len) { at = i; len = j - i; }
    i = j;
  }
  const hex = n.map((x) => x.toString(16));
  return at < 0 ? hex.join(':') : hex.slice(0, at).join(':') + '::' + hex.slice(at + len).join(':');
}
export function canonIp(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\/(32|128)$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
    const o = s.split('.').map(Number);
    return o.every((x) => x <= 255) ? o.join('.') : null;
  }
  if (!s.includes(':') || !/^[0-9a-f:.]+$/.test(s)) return null;
  const n = v6numbers(s);
  if (!n) return null;
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) return [n[6] >> 8, n[6] & 255, n[7] >> 8, n[7] & 255].join('.');
  return v6text(n);
}
export const isV4 = (ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip || '');
// Sob o que as regras contam: o próprio IPv4, ou o bloco IPv6 /64 (o celular mantém o /64 e troca o resto todo dia).
export function netOf(raw) {
  const ip = canonIp(raw);
  if (!ip || isV4(ip)) return ip;
  const n = v6numbers(ip);
  return v6text(n.slice(0, 4).concat([0, 0, 0, 0])) + '/64';
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  click_id TEXT NOT NULL,
  ip TEXT,
  net TEXT,
  ua TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  asn INTEGER,
  as_org TEXT,
  page TEXT,
  campaign TEXT,
  lead INTEGER NOT NULL DEFAULT 0,
  contato INTEGER NOT NULL DEFAULT 0,
  UNIQUE (click_id, ip)
)`;

// Por isolate: cria a tabela uma vez, apaga o que passou de 90 dias no máximo uma vez por hora.
let schemaReady = false;
let lastPrune = 0;
let warned = false;

function binding(env) {
  const db = env && env.CLICKS;
  if (db && typeof db.prepare === 'function') return db;
  if (!warned) { warned = true; console.warn('[cliques] binding D1 CLICKS ausente — cliques de anúncio não estão sendo gravados'); }
  return null;
}

async function ready(db) {
  if (!schemaReady) {
    await db.prepare(SCHEMA).run();
    await db.prepare('CREATE INDEX IF NOT EXISTS clicks_ts ON clicks (ts)').run();
    schemaReady = true;
  }
  // Também a consulta 0 de tools/cliques/relatorio.sql, para os 90 dias valerem mesmo com os anúncios parados.
  if (Date.now() - lastPrune > 3600e3) {
    lastPrune = Date.now();
    await db.prepare(`DELETE FROM clicks WHERE ts < datetime('now', '-${RETENTION_DAYS} days')`).run();
  }
}

const clip = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max) : '') || null;
// Texto que uma planilha rodaria como fórmula (=, +, -, @) ganha um apóstrofo, caso o relatório seja exportado.
const sheetSafe = (v) => (v && /^[=+\-@]/.test(v) ? "'" + v : v);

// Uma enxurrada de muitos IPs (o limite de rajada é por IP) para de encher a tabela depois de DAILY_CAP linhas no dia.
// Cliques reais com o orçamento de hoje são poucos por dia; 500 também mantém a rodada horária do /api/blocklist dentro
// do tempo de CPU do plano grátis durante uma enxurrada.
export const DAILY_CAP = 500;
let capWarned = '';

// row: { click, ip, ua, cf, page, campaign }. Devolve true quando gravou.
export async function logClick(env, row) {
  const db = binding(env);
  if (!db) return false;
  await ready(db);
  const today = await db.prepare(`SELECT COUNT(*) AS n FROM clicks WHERE ts >= date('now')`).first();
  if (today && today.n >= DAILY_CAP) {
    const day = new Date().toISOString().slice(0, 10);
    if (capWarned !== day) { capWarned = day; console.warn(`[cliques] teto diário de ${DAILY_CAP} linhas — não grava mais hoje`); }
    return false;
  }
  const cf = row.cf || {};
  await db.prepare(
    `INSERT OR IGNORE INTO clicks (ts, kind, click_id, ip, net, ua, country, region, city, asn, as_org, page, campaign)
     VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.click.kind, row.click.id, canonIp(row.ip) || clip(row.ip, 64), netOf(row.ip), sheetSafe(clip(row.ua, 300)),
    clip(cf.country, 8), sheetSafe(clip(cf.region, 80)), sheetSafe(clip(cf.city, 80)),
    Number.isInteger(cf.asn) ? cf.asn : null, sheetSafe(clip(cf.asOrganization, 120)),
    clip(row.page, 120), sheetSafe(clip(row.campaign, 60))
  ).run();
  return true;
}

// Toque em WhatsApp, telefone ou e-mail vindo de uma visita de anúncio (/api/click com event 'contato'). Só a própria
// rede de quem tocou marca a linha, então ninguém marca a linha de outro. O beacon é público (um robô pode mandar um
// para si mesmo), por isso o toque só cancela a regra "repeat" (ver decideBlocks): servidor, fora do Brasil e navegador
// de robô continuam bloqueados.
export async function markContato(env, click, ip) {
  const db = binding(env);
  const net = netOf(ip);
  if (!db || !click || !net) return false;
  await ready(db);
  await db.prepare(`UPDATE clicks SET contato = 1 WHERE click_id = ? AND contato = 0 AND net = ?`).bind(click.id, net).run();
  return true;
}

// ─── Exclusões automáticas de IP ───
// Uma exclusão é uma entrada na lista de IPs excluídos da CONTA do Google Ads (vale para todas as campanhas): um IPv4
// ou um IPv6 /64 (se o Google recusar o /64, os endereços vistos dentro dele), nossa por BLOCK_DAYS, depois sai.
// Linhas em `blocks`:
//   pending  → mandada ao script, ainda não vista na lista do Google (reenviada até MAX_TRIES rodadas, depois failed)
//   active   → na lista do Google; sai quando acabam os BLOCK_DAYS, quando a rede faz contato (só para "repeat") ou
//              para abrir espaço
//   leaving  → remoção mandada, esperando sumir da lista (reenviada até MAX_TRIES rodadas, depois stuck)
//   ended    → saiu (end_reason: expired | cleared | room | by_hand | failed | stuck). by_hand = o Rafael tirou no
//              Google Ads: nunca volta enquanto a linha existir. stuck = o Google não deixou tirar: fica na lista, o
//              e-mail avisa. As outras só voltam com um clique novo depois que o bloqueio acabou.
export const BLOCK_DAYS = 30;
export const WINDOW_DAYS = 7;
export const REPEAT_CLICKS = 3;
export const MAX_OURS = 400;          // o Google aceita 500 por conta: 100 ficam livres para o Rafael
export const ACCOUNT_LIMIT = 500;
export const MAX_NEW_PER_RUN = 50;
export const MAX_NEW_PER_DAY = 100;
export const MAX_TRIES = 3;
const MAX_V6_PER_NET = 5;
// As campanhas da Laine só mostram anúncio no Brasil (Goiânia e região).
export const HOME_COUNTRY = 'BR';

// Um IP = muita gente sem relação ao mesmo tempo (iCloud Private Relay na Akamai 36183, Cloudflare WARP, Fastly).
export const RELAY_ASNS = Object.freeze([36183, 13335, 54113]);
// Verificação do próprio Google (AdsBot, Googlebot) vem da rede do Google e não é clique pago. Agente do Google vindo de
// outra rede é falso e conta como robô. Google Cloud (396982) é data center como qualquer outro.
export const GOOGLE_ASNS = Object.freeze([15169]);
const GOOGLE_UA_RE = /AdsBot-Google|Googlebot|Google-InspectionTool|Mediapartners-Google|APIs-Google|Google-Read-Aloud|FeedFetcher-Google/i;
// Data centers: as nuvens grandes pelo número (Google Cloud, AWS, Microsoft, DigitalOcean, OVH, Hetzner, Linode, Vultr,
// Oracle, Contabo, Locaweb), o resto pelo nome da rede. Nunca "google" sozinho, nem "telecom"/"internet"/"net": no
// Brasil são os nomes dos provedores de casa.
export const HOSTING_ASNS = Object.freeze([396982, 16509, 14618, 8075, 14061, 16276, 24940, 63949, 20473, 31898, 51167, 27715]);
const HOSTING_RE = /amazon|\baws\b|google cloud|microsoft|azure|digitalocean|\bovh|hetzner|linode|akamai|vultr|choopa|oracle|contabo|leaseweb|scaleway|m247|colocrossing|hostinger|hostwinds|hostgator|kinghost|locaweb|hosting|data ?cent(er|re)|datacenter|\bserver|\bcloud\b/i;
// Navegadores que rodaram a página mas se declaram automação.
const ROBOT_UA_RE = /HeadlessChrome|PhantomJS|SlimerJS|HtmlUnit|Selenium|webdriver|puppeteer|playwright/i;
// Todo navegador que roda o site.js diz "Mozilla/…" (Opera Mini: "Opera/…"). Linha sem isso (curl, python, agente
// vazio) é beacon feito à mão, não clique pago: não conta para nada, então uma requisição não bloqueia endereço nenhum.
const BROWSER_RE = /^(Mozilla|Opera)\/\d/;

// → 'google' | 'relay' | 'hosting' | 'home' para uma linha de clique.
export function networkOf(row) {
  const asn = Number(row.asn), org = String(row.as_org || '');
  if (GOOGLE_ASNS.includes(asn)) return 'google';
  if (RELAY_ASNS.includes(asn)) return 'relay';
  if (HOSTING_ASNS.includes(asn) || HOSTING_RE.test(org)) return 'hosting';
  return 'home';
}

// Uma entrada da lista do Google na nossa grafia: endereço único (canonIp) ou IPv6 /64. Outras faixas ("1.2.3.*",
// "1.2.3.0/24") são do Rafael e ficam fora do nosso alcance; ainda contam nos 500 da conta.
export function canonEntry(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  const m = s.match(/^([0-9a-f:.]+)\/64$/);
  if (m) { const ip = canonIp(m[1]); return ip && !isV4(ip) ? netOf(ip) : null; }
  return canonIp(s);
}

const DAY = 864e5;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const msOf = (t) => (t ? Date.parse(String(t).replace(' ', 'T') + 'Z') : NaN);
const RULE_TEXT = {
  robot: () => 'navegador de robô',
  hosting: (b) => `clique de servidor (${b.network || 'data center'})`,
  abroad: (b) => `clique de fora do Brasil (${b.place || 'país desconhecido'})`,
  repeat: (b) => `${b.clicks} cliques em ${WINDOW_DAYS} dias sem nenhum contato`,
};
const END_TEXT = { expired: `passaram os ${BLOCK_DAYS} dias`, cleared: 'fez contato', room: 'abriu espaço na lista (era dos mais antigos)' };

// Pura: o que muda nesta rodada. clicks = linhas dos últimos WINDOW_DAYS mais as antigas (até RETENTION_DAYS) com lead
// ou contato; blocks = todas as linhas de `blocks`; current = exclusões de IP da conta como o script leu (texto cru);
// now = ms.
// → { add: [entrada], remove: [texto como o Google lista], rows: [linhas mudadas], notes, warnings: [{ k, text }] }
// (k = do que é o aviso, para o mesmo aviso sair 1 vez por dia e não toda hora)
//
// REGRAS DO BRASIL (o que muda em relação à A1):
// - "repeat" (3 cliques em 7 dias sem contato) vale SÓ para IPv6 /64. No Brasil o IPv4 é compartilhado (CGNAT) em
//   quase todo provedor — Vivo, Claro, TIM, Oi e a maioria dos provedores de casa —, então 3 cliques de um IPv4 podem
//   ser 3 pessoas diferentes. Um IPv4 só é bloqueado por servidor, fora do Brasil ou robô.
// - "fora" = país diferente de BR.
// - Ainda não há formulário (B-6): `lead` fica 0 e o único sinal de cliente é o toque em WhatsApp/telefone/e-mail, que
//   só cancela "repeat" (o beacon é público).
export function decideBlocks({ clicks = [], blocks = [], current = [], now = Date.now(), capHit = false }) {
  const cur = new Map();   // nossa grafia → texto cru, para endereços únicos e IPv6 /64
  for (const raw of current) { const c = canonEntry(raw); if (c && !cur.has(c)) cur.set(c, String(raw)); }
  const listed = new Set(current.map((x) => String(x).trim())).size;   // toda entrada conta nos 500
  const nowT = sqlTime(now), since = now - WINDOW_DAYS * DAY;
  const notes = { added: [], removed: [], byHand: [] }, warnings = [], add = [], remove = [], changed = new Map();
  const touch = (b) => changed.set(b.ip, b);
  const leave = (b, reason) => { b.status = 'leaving'; b.end_reason = reason; b.tries = 1; touch(b); remove.push(cur.get(b.ip)); notes.removed.push({ ip: b.ip, why: END_TEXT[reason] }); };
  const end = (b, reason) => { b.status = 'ended'; if (reason) b.end_reason = reason; b.end_ts = nowT; touch(b); };

  for (const c of clicks) if (!c.net) c.net = netOf(c.ip);
  const leadNets = new Set(clicks.filter((c) => c.net && Number(c.lead) === 1).map((c) => c.net));
  const contatoNets = new Set(clicks.filter((c) => c.net && Number(c.contato) === 1).map((c) => c.net));
  const cleared = (b) => leadNets.has(b.net) || (b.rule === 'repeat' && contatoNets.has(b.net));

  // 1 · Nossos bloqueios contra a lista do Google.
  const byIp = new Map(blocks.map((b) => [b.ip, { ...b }]));
  const wasActive = [...byIp.values()].filter((b) => b.status === 'active').length;
  for (const b of byIp.values()) {
    const on = cur.has(b.ip);
    if (b.status === 'pending') {
      if (cleared(b)) {
        if (on) leave(b, 'cleared');
        else { end(b, 'cleared'); notes.removed.push({ ip: b.ip, why: END_TEXT.cleared }); }
      } else if (on) {
        b.status = 'active'; b.active_ts = nowT; b.until_ts = sqlTime(now + BLOCK_DAYS * DAY); touch(b);
      } else if (Number(b.tries) >= MAX_TRIES) {
        end(b, 'failed');
        warnings.push({ k: 'failed:' + b.ip, text: `O Google não aceitou ${b.ip} depois de ${MAX_TRIES} tentativas; ficou fora da lista.` });
      } else {
        b.tries = Number(b.tries) + 1; add.push(b.ip); touch(b);
      }
    } else if (b.status === 'active') {
      if (!on) { end(b, 'by_hand'); notes.byHand.push(b.ip); }
      else if (cleared(b)) leave(b, 'cleared');
      else if (!(msOf(b.until_ts) > now)) leave(b, 'expired');
    } else if (b.status === 'leaving') {
      if (!on) end(b);
      else if (Number(b.tries) >= MAX_TRIES) {
        end(b, 'stuck');
        warnings.push({ k: 'stuck:' + b.ip, text: `O Google não deixou tirar ${b.ip} da lista em ${MAX_TRIES} tentativas: continua bloqueado. Para tirar à mão: Google Ads → Admin → Configurações da conta → Exclusões de IP.` });
      } else { b.tries = Number(b.tries) + 1; remove.push(cur.get(b.ip)); touch(b); }
    }
  }
  if (wasActive >= 3 && notes.byHand.length === wasActive) {
    warnings.push({ k: 'all-gone', text: `Os ${wasActive} IPs que o site tinha bloqueado sumiram juntos da lista do Google Ads. Se não foi você, me avise: eles não voltam sozinhos.` });
  }

  // 2 · Candidatos dos últimos WINDOW_DAYS, agrupados por rede (IPv4 ou IPv6 /64). "repeat" conta cliques de anúncio
  // (ids distintos), não carregamentos: o mesmo link reaberto do histórico é um clique só.
  const groups = new Map();
  for (const c of clicks) {
    const t = msOf(c.ts), ua = String(c.ua || '');
    if (!(t >= since) || !c.net || leadNets.has(c.net) || !BROWSER_RE.test(ua)) continue;
    const ip = canonIp(c.ip), kind = networkOf(c);
    if (!ip || kind === 'google' || kind === 'relay') continue;
    const g = groups.get(c.net) || { net: c.net, ids: new Set(), last: 0, ips: new Map(), robot: false, hosting: false, abroad: '', network: '', place: '' };
    g.ids.add(c.click_id || 'row:' + c.id);
    g.last = Math.max(g.last, t);
    g.ips.set(ip, Math.max(g.ips.get(ip) || 0, t));
    if (ROBOT_UA_RE.test(ua) || GOOGLE_UA_RE.test(ua)) g.robot = true;
    if (kind === 'hosting') g.hosting = true;
    const country = String(c.country || '').toUpperCase();
    if (country && country !== HOME_COUNTRY && country !== 'XX' && country !== 'T1') g.abroad = country;
    if (c.as_org) g.network = String(c.as_org).slice(0, 120);
    if (c.city || c.country) g.place = [c.city, c.country].filter(Boolean).join(', ');
    groups.set(c.net, g);
  }
  const candidates = [];
  for (const g of groups.values()) {
    const n = g.ids.size;
    const repeat = !isV4(g.net) && n >= REPEAT_CLICKS && !contatoNets.has(g.net);   // nunca em IPv4 (CGNAT)
    const rule = g.robot ? 'robot' : g.hosting ? 'hosting' : g.abroad ? 'abroad' : repeat ? 'repeat' : null;
    if (!rule) continue;
    let targets;
    if (isV4(g.net)) targets = [[g.net, g.last]];
    else {
      const whole = byIp.get(g.net);
      targets = whole && whole.end_reason === 'failed'
        ? [...g.ips.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_V6_PER_NET)   // o Google recusou o /64
        : [[g.net, g.last]];
    }
    for (const [ip, lastSeen] of targets) {
      if (cur.has(ip) || (ip !== g.net && cur.has(g.net))) continue;   // já na lista (nossa ou do Rafael)
      const old = byIp.get(ip);
      if (old && old.status !== 'ended') continue;
      if (old && (old.end_reason === 'by_hand' || old.end_reason === 'stuck')) continue;
      if (old && !(lastSeen > msOf(old.end_ts))) continue;   // o bloqueio acabou: só um clique mais novo traz de volta
      candidates.push({ ip, net: g.net, rule, clicks: n, network: g.network, place: g.place.slice(0, 80), last: g.last });
    }
  }
  candidates.sort((a, b) => b.last - a.last);

  // 3 · Espaço: MAX_NEW_PER_RUN por hora, MAX_NEW_PER_DAY por dia, MAX_OURS nossos, ACCOUNT_LIMIT na lista toda.
  const today = nowT.slice(0, 10);
  const madeToday = blocks.filter((b) => String(b.created_ts || '').slice(0, 10) === today).length;
  let take = Math.min(candidates.length, MAX_NEW_PER_RUN, Math.max(0, MAX_NEW_PER_DAY - madeToday));
  if (candidates.length > take) {
    warnings.push(take < MAX_NEW_PER_RUN && madeToday + take >= MAX_NEW_PER_DAY
      ? { k: 'daycap', text: `Hoje o site já bloqueou ${MAX_NEW_PER_DAY} IPs (o máximo por dia): os outros suspeitos esperam até amanhã. Tanto bloqueio num dia pode ser ataque; vale olhar o relatório.` }
      : { k: 'postponed', text: `Mais IPs suspeitos do que cabem numa hora: ${candidates.length - take} ficaram para a próxima (no máximo ${MAX_NEW_PER_RUN} por hora).` });
  }
  const ours = () => [...byIp.values()].filter((b) => b.status === 'pending' || b.status === 'active').length;
  let over = ours() + take - MAX_OURS;
  if (over > 0) {
    const oldest = [...byIp.values()].filter((b) => b.status === 'active').sort((a, b) => msOf(a.active_ts) - msOf(b.active_ts));
    for (const b of oldest.slice(0, over)) leave(b, 'room');
    over = ours() + take - MAX_OURS;
    if (over > 0) take = Math.max(0, take - over);
    warnings.push({ k: 'room', text: `A lista de bloqueio chegou a ${MAX_OURS} IPs nossos; os mais antigos saíram antes dos ${BLOCK_DAYS} dias.` });
  }
  const after = listed - new Set(remove.filter(Boolean)).size + add.length;
  if (after + take > ACCOUNT_LIMIT) {
    const left = take - Math.max(0, ACCOUNT_LIMIT - after);
    take -= left;
    warnings.push({ k: 'full', text: `A lista de exclusão de IP da conta está cheia (${ACCOUNT_LIMIT}, contando as que você digitou): ${left} IP(s) suspeitos não entraram.` });
  }
  for (const c of candidates.slice(0, take)) {
    const b = { ip: c.ip, net: c.net, rule: c.rule, clicks: c.clicks, network: c.network || null, place: c.place || null, status: 'pending', tries: 1, created_ts: nowT, active_ts: null, until_ts: null, end_ts: null, end_reason: null };
    byIp.set(b.ip, b); touch(b); add.push(b.ip);
    notes.added.push({ ip: b.ip, why: RULE_TEXT[b.rule](b), network: b.network, place: b.place });
  }
  if (capHit) warnings.push({ k: 'cap', text: `Hoje o registro chegou a ${DAILY_CAP} cliques e parou de gravar até amanhã (pode ser uma enxurrada de robôs): os cliques seguintes não entram nas regras.` });
  return { add, remove: remove.filter(Boolean), rows: [...changed.values()], notes, warnings };
}

// O e-mail que o script manda (só quando algo mudou ou há aviso).
export function blockEmail(notes, warningTexts) {
  const { added, removed, byHand } = notes;
  if (!added.length && !removed.length && !byHand.length && !warningTexts.length) return null;
  const parts = [];
  if (added.length) parts.push(added.length === 1 ? '1 bloqueado' : `${added.length} bloqueados`);
  if (removed.length) parts.push(removed.length === 1 ? '1 saiu' : `${removed.length} saíram`);
  if (byHand.length) parts.push(byHand.length === 1 ? '1 tirado à mão' : `${byHand.length} tirados à mão`);
  if (!parts.length) parts.push('aviso');
  const lines = [];
  if (added.length) {
    lines.push(`Bloqueados agora por ${BLOCK_DAYS} dias (deixam de ver os anúncios da conta):`);
    for (const a of added) lines.push(`- ${a.ip} · ${a.why}${a.network ? ' · ' + a.network : ''}${a.place ? ' · ' + a.place : ''}`);
    lines.push('');
  }
  if (removed.length) {
    lines.push('Saíram da lista:');
    for (const r of removed) lines.push(`- ${r.ip} · ${r.why}`);
    lines.push('');
  }
  if (byHand.length) {
    lines.push('Você tirou à mão no Google Ads (não voltam sozinhos):');
    for (const ip of byHand) lines.push(`- ${ip}`);
    lines.push('');
  }
  if (warningTexts.length) {
    lines.push('Avisos:');
    for (const w of warningTexts) lines.push(`- ${w}`);
    lines.push('');
  }
  lines.push('Para desbloquear alguém: Google Ads → Admin → Configurações da conta → Exclusões de IP → apagar o IP. Ele não volta sozinho.');
  return { subject: `Laine · bloqueio de IP: ${parts.join(', ')}`, body: lines.join('\n') };
}

async function readyBlocks(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS blocks (
    ip TEXT PRIMARY KEY, net TEXT NOT NULL, rule TEXT NOT NULL, clicks INTEGER, network TEXT, place TEXT,
    status TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, created_ts TEXT NOT NULL,
    active_ts TEXT, until_ts TEXT, end_ts TEXT, end_reason TEXT
  )`).run();
  await db.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)').run();
}

// Todas as linhas mudadas em UM comando (um array JSON via json_each): o plano grátis permite 50 consultas D1 por
// pedido e o D1 aceita no máximo 100 parâmetros por consulta.
const BLOCK_COLS = ['ip', 'net', 'rule', 'clicks', 'network', 'place', 'status', 'tries', 'created_ts', 'active_ts', 'until_ts', 'end_ts', 'end_reason'];
const UPSERT_BLOCKS = `INSERT INTO blocks (${BLOCK_COLS.join(', ')})
  SELECT ${BLOCK_COLS.map((c) => `json_extract(value, '$.${c}')`).join(', ')} FROM json_each(?) WHERE true
  ON CONFLICT(ip) DO UPDATE SET ${BLOCK_COLS.slice(1).map((c) => `${c} = excluded.${c}`).join(', ')}`;
const UPSERT_META = `INSERT INTO meta (k, v) SELECT json_extract(value, '$.k'), json_extract(value, '$.v') FROM json_each(?) WHERE true
  ON CONFLICT(k) DO UPDATE SET v = excluded.v`;

// /api/blocklist: lê, decide, grava (fora do preview) e diz ao script o que fazer.
// → null sem o binding, senão { add, remove, email, warnings }.
export async function planBlocks(env, { current = [], preview = false, now = Date.now() } = {}) {
  const db = binding(env);
  if (!db) return null;
  await ready(db);
  await readyBlocks(db);
  const clicks = ((await db.prepare(
    `SELECT id, ts, click_id, ip, net, ua, country, city, asn, as_org, lead, contato FROM clicks
     WHERE ts >= ? OR ((lead = 1 OR contato = 1) AND ts >= ?)`
  ).bind(sqlTime(now - WINDOW_DAYS * DAY), sqlTime(now - RETENTION_DAYS * DAY)).all()).results) || [];
  const blocks = ((await db.prepare('SELECT * FROM blocks').all()).results) || [];
  const today = await db.prepare('SELECT COUNT(*) AS n FROM clicks WHERE ts >= ?').bind(sqlTime(now).slice(0, 10)).first();
  const meta = new Map((((await db.prepare('SELECT k, v FROM meta').all()).results) || []).map((r) => [r.k, r.v]));
  const plan = decideBlocks({ clicks, blocks, current, now, capHit: !!(today && today.n >= DAILY_CAP) });

  // Um aviso sai uma vez por dia, não toda hora.
  const day = sqlTime(now).slice(0, 10);
  const fresh = plan.warnings.filter((w) => meta.get('warned:' + w.k) !== day);
  const email = blockEmail(plan.notes, fresh.map((w) => w.text));
  if (!preview) {
    const rows = plan.rows.map((b) => Object.fromEntries(BLOCK_COLS.map((c) => [c, b[c] === undefined ? null : b[c]])));
    const metaRows = fresh.map((w) => ({ k: 'warned:' + w.k, v: day })).concat([{ k: 'last_run', v: sqlTime(now) }]);
    await db.batch([
      ...(rows.length ? [db.prepare(UPSERT_BLOCKS).bind(JSON.stringify(rows))] : []),
      db.prepare(UPSERT_META).bind(JSON.stringify(metaRows)),
      db.prepare(`DELETE FROM blocks WHERE status = 'ended' AND created_ts < ?`).bind(sqlTime(now - RETENTION_DAYS * DAY)),
      db.prepare(`DELETE FROM meta WHERE k LIKE 'warned:%' AND v < ?`).bind(sqlTime(now - 7 * DAY).slice(0, 10)),
    ]);
  }
  return { add: plan.add, remove: plan.remove, email, warnings: plan.warnings.map((w) => w.text) };
}

// Só para testes.
export function resetClicks() { schemaReady = false; lastPrune = 0; warned = false; capWarned = ''; }
