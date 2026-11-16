// node --test worker/   — regras do bloqueio automático de IP (Brasil). Sem dependências.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideBlocks, canonIp, netOf, normalizeClick, blockEmail, BLOCK_DAYS } from './cliques.js';

const NOW = Date.parse('2026-11-16T15:00:00Z');
const ts = (h) => new Date(NOW - h * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
let seq = 0;
const clk = (o) => ({ id: ++seq, ts: ts(1), click_id: 'gclid' + seq + 'xxxxxxxx', ua: UA, country: 'BR', city: 'Goiânia', asn: 26599, as_org: 'TELEFONICA BRASIL S.A', lead: 0, contato: 0, ...o });
const added = (r) => r.add.slice().sort();

test('IPv4 com 3+ cliques de provedor brasileiro NÃO é bloqueado (CGNAT)', () => {
  const r = decideBlocks({ now: NOW, clicks: [1, 2, 3, 4].map(() => clk({ ip: '177.10.20.30' })) });
  assert.deepEqual(r.add, []);
});

test('IPv6 com 3 cliques no mesmo /64, sem contato, é bloqueado como /64', () => {
  const r = decideBlocks({ now: NOW, clicks: [
    clk({ ip: '2804:14c:1:2:aaaa::1' }), clk({ ip: '2804:14c:1:2:bbbb::2' }), clk({ ip: '2804:14c:1:2:cccc::3' }),
  ] });
  assert.deepEqual(r.add, ['2804:14c:1:2::/64']);
  assert.equal(r.rows[0].rule, 'repeat');
});

test('IPv6 com 3 cliques mas que tocou no WhatsApp não é bloqueado', () => {
  const r = decideBlocks({ now: NOW, clicks: [
    clk({ ip: '2804:14c:1:2::1' }), clk({ ip: '2804:14c:1:2::1' }), clk({ ip: '2804:14c:1:2::1', contato: 1 }),
  ] });
  assert.deepEqual(r.add, []);
});

test('2 cliques de IPv6 não bastam', () => {
  const r = decideBlocks({ now: NOW, clicks: [clk({ ip: '2804:14c:9::1' }), clk({ ip: '2804:14c:9::2' })] });
  assert.deepEqual(r.add, []);
});

test('o mesmo id de clique recarregado conta uma vez', () => {
  const r = decideBlocks({ now: NOW, clicks: [1, 2, 3].map(() => clk({ ip: '2804:14c:8::1', click_id: 'mesmoIdDeClique123' })) });
  assert.deepEqual(r.add, []);
});

test('servidor (AWS) com 1 clique é bloqueado, mesmo IPv4, mesmo com toque no contato', () => {
  const r = decideBlocks({ now: NOW, clicks: [clk({ ip: '3.4.5.6', asn: 16509, as_org: 'AMAZON-02', contato: 1 })] });
  assert.deepEqual(r.add, ['3.4.5.6']);
  assert.equal(r.rows[0].rule, 'hosting');
});

test('Locaweb conta como servidor', () => {
  const r = decideBlocks({ now: NOW, clicks: [clk({ ip: '186.202.1.1', asn: 27715, as_org: 'Locaweb Servicos de Internet SA' })] });
  assert.deepEqual(r.add, ['186.202.1.1']);
});

test('provedor de casa com "Telecom"/"Internet" no nome não conta como servidor', () => {
  const r = decideBlocks({ now: NOW, clicks: [
    clk({ ip: '45.1.1.1', asn: 263000, as_org: 'GOIAS TELECOM LTDA' }),
    clk({ ip: '45.1.1.2', asn: 263001, as_org: 'Mais Internet Provedor' }),
    clk({ ip: '45.1.1.3', asn: 28573, as_org: 'Claro NXT Telecomunicacoes Ltda' }),
  ] });
  assert.deepEqual(r.add, []);
});

test('clique de fora do Brasil é bloqueado; BR não', () => {
  const r = decideBlocks({ now: NOW, clicks: [clk({ ip: '81.2.3.4', country: 'DE', city: 'Berlin', asn: 3320, as_org: 'Deutsche Telekom AG' }), clk({ ip: '189.1.2.3' })] });
  assert.deepEqual(r.add, ['81.2.3.4']);
  assert.equal(r.rows[0].rule, 'abroad');
});

test('navegador de robô é bloqueado; Googlebot de verdade (rede do Google) não', () => {
  const r = decideBlocks({ now: NOW, clicks: [
    clk({ ip: '189.9.9.9', ua: 'Mozilla/5.0 HeadlessChrome/120' }),
    clk({ ip: '66.249.66.1', ua: 'Mozilla/5.0 (compatible; AdsBot-Google)', asn: 15169, as_org: 'GOOGLE', country: 'US' }),
  ] });
  assert.deepEqual(r.add, ['189.9.9.9']);
});

test('iCloud Private Relay e Cloudflare WARP nunca entram', () => {
  const r = decideBlocks({ now: NOW, clicks: [
    clk({ ip: '172.224.1.1', asn: 36183, as_org: 'Akamai', country: 'US' }),
    clk({ ip: '104.28.1.1', asn: 13335, as_org: 'Cloudflare', country: 'US' }),
  ] });
  assert.deepEqual(r.add, []);
});

test('beacon sem navegador (curl) não conta para nada', () => {
  const r = decideBlocks({ now: NOW, clicks: [clk({ ip: '3.4.5.6', asn: 16509, as_org: 'AMAZON-02', ua: 'curl/8.0' })] });
  assert.deepEqual(r.add, []);
});

test('ciclo: pendente → ativo → sai depois de 30 dias; tirado à mão nunca volta', () => {
  const c = [clk({ ip: '3.4.5.6', asn: 16509, as_org: 'AMAZON-02' })];
  const r1 = decideBlocks({ now: NOW, clicks: c });
  const r2 = decideBlocks({ now: NOW + 3600e3, clicks: c, blocks: r1.rows, current: ['3.4.5.6'] });
  assert.equal(r2.rows[0].status, 'active');
  const later = NOW + (BLOCK_DAYS + 1) * 864e5;
  const r3 = decideBlocks({ now: later, clicks: [], blocks: r2.rows, current: ['3.4.5.6'] });
  assert.deepEqual(r3.remove, ['3.4.5.6']);
  const byHand = decideBlocks({ now: NOW + 7200e3, clicks: c, blocks: r2.rows, current: [] });
  assert.equal(byHand.rows[0].end_reason, 'by_hand');
  const again = decideBlocks({ now: NOW + 10800e3, clicks: c.concat(clk({ ip: '3.4.5.6', asn: 16509, as_org: 'AMAZON-02', ts: ts(-2) })), blocks: byHand.rows, current: [] });
  assert.deepEqual(again.add, []);
});

test('bloqueio "repeat" sai quando a rede faz contato', () => {
  const ips = ['2804:7f0:1:1::1', '2804:7f0:1:1::2', '2804:7f0:1:1::3'];
  const c = ips.map((ip) => clk({ ip }));
  const r1 = decideBlocks({ now: NOW, clicks: c });
  const r2 = decideBlocks({ now: NOW + 3600e3, clicks: c, blocks: r1.rows, current: ['2804:7f0:1:1::/64'] });
  const r3 = decideBlocks({ now: NOW + 7200e3, clicks: c.concat(clk({ ip: '2804:7f0:1:1::9', contato: 1 })), blocks: r2.rows, current: ['2804:7f0:1:1::/64'] });
  assert.deepEqual(r3.remove, ['2804:7f0:1:1::/64']);
});

test('grafias de IP e validação do clique', () => {
  assert.equal(canonIp('::FFFF:189.1.2.3'), '189.1.2.3');
  assert.equal(canonIp('2804:014C:0000:0000:0000:0000:0000:0001'), '2804:14c::1');
  assert.equal(netOf('2804:14c:1:2:3:4:5:6'), '2804:14c:1:2::/64');
  assert.equal(canonIp('999.1.1.1'), null);
  assert.equal(normalizeClick({ kind: 'gclid', id: 'curto' }), null);
  assert.deepEqual(normalizeClick({ kind: 'GCLID', id: 'Cj0KCQiA_abc-123' }), { kind: 'gclid', id: 'Cj0KCQiA_abc-123' });
});

test('e-mail em português, só quando há novidade', () => {
  assert.equal(blockEmail({ added: [], removed: [], byHand: [] }, []), null);
  const r = decideBlocks({ now: NOW, clicks: [clk({ ip: '81.2.3.4', country: 'PT', city: 'Lisboa', asn: 3243, as_org: 'MEO' })] });
  const m = blockEmail(r.notes, r.warnings.map((w) => w.text));
  assert.match(m.subject, /^Laine · bloqueio de IP: 1 bloqueado/);
  assert.match(m.body, /fora do Brasil/);
});
