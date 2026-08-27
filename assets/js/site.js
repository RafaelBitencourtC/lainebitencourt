/* =========================================================================
   site.js — v3
   Duas responsabilidades: comportamento (menu, formulário) e a rede de
   segurança do movimento. Onde o navegador suporta animação ligada ao
   scroll, o CSS já resolve no compositor e este arquivo NÃO toca em nada
   — nenhum listener de scroll, nenhum trabalho por quadro. É o que mantém
   a rolagem fluida num Android modesto.

   CONTRATO GA4 (LAINE_04 §8): os nomes de evento e o conjunto fechado de
   `local` são um acordo com a configuração do GA4 Admin. Mudar um lado sem
   o outro esvazia os relatórios em silêncio.
   ========================================================================= */
(function () {
  'use strict';

  var LOCAIS = ['hero','barra_fixa_mobile','menu_topo','rodape','bloco_contato','pagina_atuacao','pagina_artigo'];
  var calmo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var scrollNativo = CSS && CSS.supports && CSS.supports('animation-timeline: view()');

  function pagina(){ return location.pathname; }
  function evento(nome, params){
    if (params && params.local && LOCAIS.indexOf(params.local) === -1){
      console.warn('[site.js] `local` fora do conjunto fechado:', params.local); return;
    }
    if (typeof window.gtag === 'function') window.gtag('event', nome, params || {});
  }

  /* --- revelação: só entra se o navegador NÃO tiver scroll-driven CSS --- */
  (function () {
    var alvos = document.querySelectorAll('[data-reveal]');
    if (!alvos.length) return;
    if (calmo || scrollNativo || !('IntersectionObserver' in window)){
      if (!scrollNativo) Array.prototype.forEach.call(alvos, function(el){ el.classList.add('in'); });
      return;
    }
    var obs = new IntersectionObserver(function (es){
      es.forEach(function (e){
        if (!e.isIntersecting) return;
        var irmaos = e.target.parentElement ? e.target.parentElement.querySelectorAll(':scope > [data-reveal]') : [];
        var i = Array.prototype.indexOf.call(irmaos, e.target);
        e.target.style.setProperty('--d', (i > 0 ? Math.min(i,5) * 80 : 0) + 'ms');
        e.target.classList.add('in');
        obs.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.06 });
    Array.prototype.forEach.call(alvos, function(el){ obs.observe(el); });
  })();

  /* --- cabeçalho ganha peso ao sair do topo (sem listener de scroll) ---- */
  (function () {
    var hd = document.querySelector('.hd');
    if (!hd || !('IntersectionObserver' in window)) return;
    var sentinela = document.createElement('div');
    sentinela.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;';
    document.body.prepend(sentinela);
    new IntersectionObserver(function (es){
      hd.classList.toggle('stuck', !es[0].isIntersecting);
    }, { threshold: 0 }).observe(sentinela);
  })();

  /* --- a barra fixa recolhe quando o contato da página aparece ---------- */
  (function () {
    var bar = document.querySelector('.bar');
    var alvo = document.querySelector('[data-contact-block]');
    if (!bar || !alvo || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (es){
      bar.classList.toggle('tuck', es[0].isIntersecting);
    }, { threshold: 0.3 }).observe(alvo);
  })();

  /* --- menu ------------------------------------------------------------- */
  (function () {
    var btn = document.querySelector('.navbtn'), nav = document.getElementById('nav');
    if (!btn || !nav) return;
    btn.addEventListener('click', function () {
      var aberto = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!aberto));
      nav.setAttribute('data-open', String(!aberto));
      var r = btn.querySelector('.sr-only'); if (r) r.textContent = aberto ? 'Abrir menu' : 'Fechar menu';
    });
  })();

  /* --- eventos de contato ----------------------------------------------- */
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-contato]'); if (!a) return;
    var tipo = a.getAttribute('data-contato'), local = a.getAttribute('data-local') || 'bloco_contato';
    if (tipo === 'whatsapp') evento('contato_whatsapp', { local: local, pagina: pagina() });
    else if (tipo === 'telefone') evento('contato_telefone', { local: local, pagina: pagina() });
    else if (tipo === 'email') evento('contato_email', { local: local, pagina: pagina() });
  });

  /* --- acordeão --------------------------------------------------------- */
  Array.prototype.forEach.call(document.querySelectorAll('details'), function (d) {
    d.addEventListener('toggle', function () {
      if (!d.open) return;
      var s = d.querySelector('summary');
      evento('abriu_faq', { pergunta: s ? s.textContent.trim() : '', pagina: pagina() });
    });
  });

  /* --- formulário: B-6 aberto, envio recusado de propósito -------------- */
  (function () {
    var form = document.querySelector('form[data-form="contato"]'); if (!form) return;
    var status = form.querySelector('[data-form-status]');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var invalido = null;
      Array.prototype.forEach.call(form.querySelectorAll('[required]'), function (c) {
        var vazio = (c.type === 'checkbox') ? !c.checked : !c.value.trim();
        c.setAttribute('aria-invalid', vazio ? 'true' : 'false');
        if (vazio && !invalido) invalido = c;
      });
      if (invalido) {
        if (status){ status.hidden = false; status.textContent = 'Preencha os campos obrigatórios antes de enviar.'; }
        invalido.focus(); evento('formulario_erro', { pagina: pagina(), motivo: 'campos_obrigatorios' }); return;
      }
      if (!form.getAttribute('action')) {
        if (status){ status.hidden = false; status.textContent = 'O formulário ainda não está ativo. Use o WhatsApp (62) 99212-0065 enquanto isso.'; }
        console.warn('[site.js] B-6 aberto: form sem destino. Envio recusado de propósito.');
        evento('formulario_erro', { pagina: pagina(), motivo: 'sem_destino' }); return;
      }
      // Quando B-6 fechar: POST real + evento('formulario_envio', { pagina: pagina() });
    });
  })();
})();
