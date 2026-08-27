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
  /* usado so para diagnostico do parallax; NAO gate a revelacao */
  var scrollNativo = CSS && CSS.supports && CSS.supports('animation-timeline: view()');

  function pagina(){ return location.pathname; }
  function evento(nome, params){
    if (params && params.local && LOCAIS.indexOf(params.local) === -1){
      console.warn('[site.js] `local` fora do conjunto fechado:', params.local); return;
    }
    if (typeof window.gtag === 'function') window.gtag('event', nome, params || {});
  }

  /* --- revelação -------------------------------------------------------
     SEMPRE por IntersectionObserver. Nao existe mais caminho de CSS
     scroll-driven para revelacao: se este bloco nao rodar, o conteudo fica
     invisivel. Foi exatamente o que aconteceu em 27/08/2026 — o JS saia
     cedo quando o navegador suportava animation-timeline, mas o CSS
     correspondente ja tinha sido removido, e o herei inteiro ficou em
     opacity:0. Nao reintroduzir nenhuma condicao de saida aqui.
  ------------------------------------------------------------------------ */
  (function () {
    var alvos = document.querySelectorAll('[data-reveal]');
    if (!alvos.length) return;
    if (calmo || !('IntersectionObserver' in window)){
      Array.prototype.forEach.call(alvos, function(el){ el.classList.add('in'); });
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
    }, { threshold: 0 });
    Array.prototype.forEach.call(alvos, function(el){ obs.observe(el); });

    /* Rede de seguranca. O rootMargin negativo que existia aqui encolhia a
       raiz em 10% na base, entao qualquer elemento nos ultimos 10% do
       documento nunca chegava a "entrar" — nem rolando ate o fim — e ficava
       em opacity:0 para sempre. Aconteceu com o ultimo link de cada pagina.
       Agora o threshold e 0 e, alem disso, tudo que continuar escondido
       depois de 3s aparece de qualquer jeito: animacao nao vista e um
       detalhe, texto nao lido nao e. */
    setTimeout(function () {
      Array.prototype.forEach.call(alvos, function (el) {
        if (!el.classList.contains('in')) el.classList.add('in');
      });
    }, 3000);
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
