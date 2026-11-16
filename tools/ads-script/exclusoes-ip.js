/**
 * Laine Bitencourt · bloqueio automático de IP (16/11/2026; contrato em docs/2026-11-16-bloqueio-automatico-ip.md)
 * Porte do script que a A1 roda desde 26/10/2026.
 *
 * Onde mora: Google Ads da Laine → Ferramentas → Ações em massa → Scripts → "+" → colar este arquivo inteiro.
 *   1. Trocar COLE_A_CHAVE_AQUI pela BLOCKLIST_KEY (o mesmo valor do segredo no Cloudflare, Worker "lainebitencourt").
 *   2. Trocar COLE_O_EMAIL_AQUI pelo e-mail que recebe os avisos.
 *   3. Autorizar → Visualizar/Preview (não muda nada; o log mostra o que faria) → Salvar.
 *   4. Frequência: de hora em hora.
 * Este arquivo no repositório fica SEMPRE com COLE_A_CHAVE_AQUI: a chave nunca entra no git.
 *
 * A cada hora: lê as exclusões de IP da CONTA (valem para todas as campanhas), manda a lista para o site, recebe quais
 * IPs pôr e quais tirar, aplica, e manda e-mail só quando algo mudou ou há aviso. As regras moram no site
 * (worker/cliques.js → decideBlocks), não aqui. Só tira IP que o próprio site pôs: as exclusões digitadas à mão ficam
 * intocadas, e um IP do site que alguém tirou à mão não volta sozinho.
 */
var ENDPOINT = 'https://lainebitencourt.com.br/api/blocklist';
var KEY = 'COLE_A_CHAVE_AQUI';
var EMAIL = 'COLE_O_EMAIL_AQUI';

function main() {
  if (KEY === 'COLE_A_CHAVE_AQUI' || KEY.length < 32) {
    throw new Error('Falta a chave: troque COLE_A_CHAVE_AQUI pela BLOCKLIST_KEY do Cloudflare.');
  }
  var preview = AdsApp.getExecutionInfo().isPreview();
  var current = readExclusions();

  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + KEY },
    payload: JSON.stringify({ current: Object.keys(current), preview: preview }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    // Rodada com falha aparece como "Falhou" no histórico do script; nada é posto nem tirado.
    throw new Error('lainebitencourt.com.br/api/blocklist respondeu ' + code + ': ' + String(res.getContentText()).slice(0, 200));
  }
  var plan = JSON.parse(res.getContentText());

  // Primeiro as remoções, para uma lista cheia ter espaço para as novas.
  var ops = [], labels = [];
  (plan.remove || []).forEach(function (ip) {
    if (!current[ip]) return;
    ops.push({ customerNegativeCriterionOperation: { remove: current[ip] } });
    labels.push('tirar ' + ip);
  });
  (plan.add || []).forEach(function (ip) {
    ops.push({ customerNegativeCriterionOperation: { create: { ipBlock: { ipAddress: ip } } } });
    labels.push('pôr ' + ip);
  });
  var errors = [];
  if (ops.length) {
    var results = AdsApp.mutateAll(ops, { partialFailure: true });
    for (var i = 0; i < results.length; i++) {
      if (!results[i].isSuccessful()) errors.push(labels[i] + ': ' + results[i].getErrorMessages().join('; '));
    }
  }

  Logger.log((preview ? '[preview, nada mudou] ' : '') + 'exclusões de IP na conta: ' + Object.keys(current).length +
    ' · pôr: ' + (plan.add || []).length + ' · tirar: ' + (plan.remove || []).length + ' · recusados: ' + errors.length);
  if (plan.email) Logger.log(plan.email.subject + '\n' + plan.email.body);
  if (errors.length) Logger.log('Recusados pelo Google:\n- ' + errors.join('\n- '));
  if (preview) return;

  if ((plan.email || errors.length) && EMAIL.indexOf('@') > 0) {
    var subject = plan.email ? plan.email.subject : 'Laine · bloqueio de IP: o Google recusou uma mudança';
    var body = (plan.email ? plan.email.body : '') +
      (errors.length ? '\n\nO Google recusou (o site tenta de novo na próxima hora, até 3 vezes):\n- ' + errors.join('\n- ') : '');
    MailApp.sendEmail(EMAIL, subject, body);
  }
}

// Endereço IP (como o Google lista) → resource name, para toda exclusão de IP no nível da conta. Outros tipos de
// exclusão da conta (canais, rótulos de conteúdo…) vêm sem ipBlock e são ignorados.
function readExclusions() {
  var out = {};
  var rows = AdsApp.search('SELECT customer_negative_criterion.resource_name, customer_negative_criterion.ip_block.ip_address ' +
    'FROM customer_negative_criterion');
  while (rows.hasNext()) {
    var c = rows.next().customerNegativeCriterion;
    if (c && c.ipBlock && c.ipBlock.ipAddress) out[c.ipBlock.ipAddress] = c.resourceName;
  }
  return out;
}
