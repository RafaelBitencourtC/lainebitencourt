// Worker do site da Laine (16/11/2026). O site continua sendo só arquivos estáticos: o wrangler.jsonc manda para cá
// APENAS /api/* (run_worker_first); qualquer outra URL é servida direto pelos assets, sem passar por este código.
//
//   POST /api/click      — beacon do site.js: um clique de anúncio chegou, ou essa visita tocou num contato.
//   POST /api/blocklist  — o script do Google Ads, de hora em hora: quais IPs excluir e quais tirar.
//
// Porte de a1windows-site/functions/api/click.js e blocklist.js. Contrato: docs/2026-11-16-bloqueio-automatico-ip.md.
import { normalizeClick, logClick, markContato, planBlocks } from './cliques.js';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/click') return request.method === 'POST' ? click(request, env, ctx) : notAllowed();
    if (pathname === '/api/blocklist') return request.method === 'POST' ? blocklist(request, env) : notAllowed();
    // Outra /api/*: não existe. O resto nem chega aqui; se chegar, os assets respondem (com o 404.html, se for o caso).
    if (pathname.startsWith('/api/')) return new Response(null, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};

const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });

// ─── /api/click ───
// Endpoint público, então: só beacon da mesma origem (quando o navegador diz de onde veio), corpo pequeno, id de
// clique e página válidos, e no máximo BURST linhas por minuto por IP em cada isolate. Beacon bem formado recebe 204 na
// hora e a gravação roda em waitUntil — o navegador do visitante nunca espera o D1 nem vê erro.
const MAX_BODY = 2048;
const BURST = 20;
const MAX_IPS = 5000;
const PAGE_RE = /^\/(?!\/)(?!.*\.\.)[A-Za-z0-9/_.-]{0,119}$/;
const recent = new Map();   // ip → [timestamps] no último minuto (por isolate)

function tooMany(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 60e3);
  list.push(now);
  recent.delete(ip);
  recent.set(ip, list);
  if (recent.size > MAX_IPS) {
    for (const [k, v] of recent) { if (recent.size <= MAX_IPS) break; if (k !== ip && !v.some((t) => now - t < 60e3)) recent.delete(k); }
    for (const [k, v] of recent) { if (recent.size <= MAX_IPS) break; if (k !== ip && v.length <= 1) recent.delete(k); }
    for (const k of recent.keys()) { if (recent.size <= MAX_IPS) break; if (k !== ip) recent.delete(k); }
  }
  return list.length > BURST;
}

async function click(request, env, ctx) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return new Response(null, { status: 403 });
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return new Response(null, { status: 400 });

  const text = await request.text().catch(() => '');
  if (!text || text.length > MAX_BODY) return new Response(null, { status: 400 });
  let body;
  try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return new Response(null, { status: 400 });

  const clk = normalizeClick(body.click);
  const page = typeof body.page === 'string' && PAGE_RE.test(body.page) ? body.page : null;
  if (!clk || !page) return new Response(null, { status: 400 });
  // { event: 'contato' } = toque em WhatsApp/telefone/e-mail nessa visita: só marca a linha, nunca cria.
  if (body.event !== undefined && body.event !== 'contato') return new Response(null, { status: 400 });

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (tooMany(ip)) return new Response(null, { status: 429 });

  const job = body.event === 'contato'
    ? markContato(env, clk, ip).catch((err) => console.error('[click] marcar contato falhou (segue):', err && err.message))
    : logClick(env, {
      click: clk, ip, page,
      ua: request.headers.get('User-Agent') || '',
      cf: request.cf || {},
      campaign: typeof body.campaign === 'string' ? body.campaign : '',
    }).catch((err) => console.error('[click] gravar falhou (segue):', err && err.message));
  ctx.waitUntil(job);
  return new Response(null, { status: 204 });
}

// ─── /api/blocklist ───
// Trancado por BLOCKLIST_KEY (segredo no Cloudflare, o mesmo valor colado no script): sem chave = 503 e nada é
// bloqueado; chave errada = 401. A resposta tem IP de visitante, então nunca vai para cache. { preview: true } (o botão
// Preview do script) responde sem gravar nada.
const MAX_LIST_BODY = 65536;
const MAX_CURRENT = 1000;

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function sameKey(given, expected) {
  // Hash dos dois para a comparação levar o mesmo tempo seja qual for a entrada.
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function blocklist(request, env) {
  const key = typeof env.BLOCKLIST_KEY === 'string' ? env.BLOCKLIST_KEY.trim() : '';
  if (key.length < 32) return json({ error: 'blocklist not configured' }, 503);
  const auth = request.headers.get('Authorization') || '';
  if (!(await sameKey(auth, 'Bearer ' + key))) return json({ error: 'unauthorized' }, 401);

  if (Number(request.headers.get('Content-Length') || 0) > MAX_LIST_BODY) return json({ error: 'too large' }, 400);
  const text = await request.text().catch(() => '');
  if (text.length > MAX_LIST_BODY) return json({ error: 'too large' }, 400);
  let body;
  try { body = JSON.parse(text || '{}'); } catch { return json({ error: 'bad json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad body' }, 400);
  if (body.preview !== undefined && typeof body.preview !== 'boolean') return json({ error: 'preview must be true or false' }, 400);
  const current = body.current === undefined ? [] : body.current;
  if (!Array.isArray(current) || current.length > MAX_CURRENT || !current.every((s) => typeof s === 'string' && s.length <= 64)) {
    return json({ error: 'current must be the list of IP exclusions' }, 400);
  }

  let plan;
  try { plan = await planBlocks(env, { current, preview: body.preview === true }); }
  catch (err) {
    console.error('[blocklist] plano falhou:', err && err.message);
    return json({ error: 'plan failed' }, 500);
  }
  if (!plan) return json({ error: 'click log not bound (CLICKS)' }, 503);
  return json({ ok: true, preview: body.preview === true, ...plan }, 200);
}
