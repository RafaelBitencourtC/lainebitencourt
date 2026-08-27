/* =========================================================================
   consent.js — LGPD + Google Consent Mode v2
   CARREGA PRIMEIRO, ANTES DO gtag.js. Não mover para o fim do <head>.

   Base: Guia Orientativo "Cookies e Proteção de Dados Pessoais" (ANPD).
   Os sinais de publicidade entram porque D-5 (LAINE_08_GOOGLE_ADS.md) prevê
   Google Ads no futuro — mas TODOS começam em "denied" e só mudam com aceite
   explícito. "Aceitar" e "Recusar" têm o mesmo peso visual: o Guia veda dark
   patterns. Não alterar essa simetria.

   BLOQUEADOR B-5: não existe ID de medição GA4. Enquanto MEDICAO_ID for null,
   nada é carregado e nada é enviado. Isso é intencional.
   ========================================================================= */
(function () {
  'use strict';
  var MEDICAO_ID = null;             // <-- B-5: trocar por 'G-XXXXXXXXXX'
  var CHAVE = 'lb_consent_v1';
  var VALIDADE_DIAS = 365;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  function ler() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE));
      if (!v || !v.em) return null;
      if ((Date.now() - v.em) / 86400000 > VALIDADE_DIAS) return null;
      return v;
    } catch (e) { return null; }
  }
  function gravar(aceito) {
    try { localStorage.setItem(CHAVE, JSON.stringify({ aceito: aceito, em: Date.now() })); } catch (e) {}
  }
  function carregarGA() {
    if (!MEDICAO_ID) { return; }          // B-5
    if (document.getElementById('ga-src')) return;
    var s = document.createElement('script');
    s.id = 'ga-src'; s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEDICAO_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', MEDICAO_ID, { anonymize_ip: true });
  }
  function aplicar(aceito) {
    gtag('consent', 'update', {
      ad_storage: aceito ? 'granted' : 'denied',
      ad_user_data: aceito ? 'granted' : 'denied',
      ad_personalization: aceito ? 'granted' : 'denied',
      analytics_storage: aceito ? 'granted' : 'denied'
    });
    if (aceito) carregarGA();
  }

  var salvo = ler();
  if (salvo) { aplicar(salvo.aceito); return; }

  document.addEventListener('DOMContentLoaded', function () {
    var el = document.createElement('div');
    el.className = 'cc';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Aviso sobre cookies');
    el.innerHTML =
      '<div class="wrap cc__in">' +
        '<p style="font-size:15.5px;line-height:1.6;color:var(--ink-2);max-width:70ch;">' +
          'Este site usa cookies de medição de audiência para entender como as páginas são encontradas. ' +
          'Você pode recusar sem perder nenhuma funcionalidade. ' +
          '<a href="/politica-de-privacidade/">Política de Privacidade</a>.' +
        '</p>' +
        '<div class="cc__btns">' +
          '<button class="btn btn--p" type="button" data-cc="sim">Aceitar</button>' +
          '<button class="btn btn--s" type="button" data-cc="nao">Recusar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cc]');
      if (!b) return;
      var aceito = b.getAttribute('data-cc') === 'sim';
      gravar(aceito); aplicar(aceito); el.remove();
    });
  });

  /* Retirada do consentimento — exigida pela LGPD (art. 8º, §5º).
     A Política de Privacidade chama esta função. */
  window.lbRedefinirConsentimento = function () {
    try { localStorage.removeItem(CHAVE); } catch (e) {}
    location.reload();
  };
})();
