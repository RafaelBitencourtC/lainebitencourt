/* =========================================================================
   site.js
   Escrito contra a marcação REAL deste repositório, verificada em
   27/08/2026 — não contra um sistema de classes de outra pasta.

   O que existe aqui e este arquivo usa:
     .navbtn + #nav + .nav[data-open]   -> menu (7 páginas)
     a[data-contato] + [data-local]     -> eventos GA4 (50 ocorrências, 8 páginas)
   O que NÃO existe neste repositório, e por isso não é tratado:
     [data-reveal], .hd.stuck, .bar.tuck  -> não há CSS correspondente
     <form>, <details>                    -> não há nenhum em nenhuma página
   Se alguma dessas coisas entrar no HTML, o bloco correspondente volta.

   CONTRATO GA4 (LAINE_04 §8): os nomes de evento e o conjunto fechado de
   `local` são um acordo com a configuração do GA4 Admin. Mudar um lado sem
   o outro esvazia os relatórios em silêncio.
   ========================================================================= */
(function () {
  'use strict';

  var LOCAIS = ['hero','barra_fixa_mobile','menu_topo','rodape','bloco_contato','pagina_atuacao','pagina_artigo'];

  function evento(nome, params) {
    if (params && params.local && LOCAIS.indexOf(params.local) === -1) {
      console.warn('[site.js] `local` fora do conjunto fechado:', params.local);
      return;
    }
    if (typeof window.gtag === 'function') window.gtag('event', nome, params || {});
  }

  /* --- menu ------------------------------------------------------------- */
  var btn = document.querySelector('.navbtn');
  var nav = document.getElementById('nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var aberto = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!aberto));
      nav.setAttribute('data-open', String(!aberto));
      var rotulo = btn.querySelector('.sr-only');
      if (rotulo) rotulo.textContent = aberto ? 'Abrir menu' : 'Fechar menu';
    });
    /* Escape fecha, e o foco volta para o botão. */
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (btn.getAttribute('aria-expanded') !== 'true') return;
      btn.setAttribute('aria-expanded', 'false');
      nav.setAttribute('data-open', 'false');
      btn.focus();
    });
  }

  /* --- eventos de contato ------------------------------------------------
     Enhanced measurement do GA4 não cobre tel: de forma documentada, então
     os cliques são disparados explicitamente. Ver LAINE_04 §8.
  ------------------------------------------------------------------------ */
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-contato]');
    if (!a) return;
    var tipo = a.getAttribute('data-contato');
    var local = a.getAttribute('data-local') || 'bloco_contato';
    var pagina = location.pathname;
    if (tipo === 'whatsapp')      evento('contato_whatsapp', { local: local, pagina: pagina });
    else if (tipo === 'telefone') evento('contato_telefone', { local: local, pagina: pagina });
    else if (tipo === 'email')    evento('contato_email',    { local: local, pagina: pagina });
  });
})();
