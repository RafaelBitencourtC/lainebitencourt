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
    if (calmo || !('IntersectionObserver' in window)) return;   /* fica tudo visivel */

    /* Esconde SO o que esta abaixo da dobra agora. O que ja esta na tela
       nunca e escondido. */
    function foraDaDobra(el) {
      return el.getBoundingClientRect().top > window.innerHeight * 0.92;
    }

    var pend = [];
    Array.prototype.forEach.call(alvos, function (el) {
      if (foraDaDobra(el)) { el.classList.add('pend'); pend.push(el); }
    });
    if (!pend.length) return;

    /* O navegador restaura a rolagem DEPOIS que este script roda. Num reload
       em meio de pagina mediamos a dobra com a rolagem ainda em zero, marcavamos
       como "abaixo da dobra" um elemento que o leitor ja tinha diante dos olhos,
       e ele sumia. Reconferimos antes da primeira pintura, no quadro seguinte
       e no load: o que ja esta na tela perde .pend antes de qualquer pintura. */
    function reconferir() {
      for (var i = pend.length - 1; i >= 0; i--) {
        if (!foraDaDobra(pend[i])) { pend[i].classList.remove('pend'); pend.splice(i, 1); }
      }
    }

    /* So depois de esconder e reconferir e que a transicao e armada — ver o
       comentario no site.css. Antes disso, esconder e corrigir sao instantaneos. */
    requestAnimationFrame(function () {
      reconferir();
      requestAnimationFrame(function () {
        reconferir();
        document.documentElement.classList.add('armado');
      });
    });
    window.addEventListener('load', reconferir);

    /* Rede de seguranca continua: o IntersectionObserver falha de vez em
       quando (observado — 1 em 5 cargas no desktop deixava um h2 escondido
       ate o timeout). Uma verificacao na rolagem, limitada a um quadro, cobre
       qualquer elemento que o observer tenha deixado passar. Barato: so roda
       enquanto ainda existe algo pendente, e se desliga sozinho. */
    var agendado = false;
    function naRolagem() {
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(function () {
        agendado = false;
        for (var i = pend.length - 1; i >= 0; i--) {
          if (!foraDaDobra(pend[i])) { revelar(pend[i]); pend.splice(i, 1); }
        }
        if (!pend.length) window.removeEventListener('scroll', naRolagem);
      });
    }
    window.addEventListener('scroll', naRolagem, { passive: true });

    function revelar(el) {
      var irmaos = el.parentElement
        ? el.parentElement.querySelectorAll(':scope > [data-reveal].pend') : [];
      var i = Array.prototype.indexOf.call(irmaos, el);
      el.style.setProperty('--d', (i > 0 ? Math.min(i, 5) * 80 : 0) + 'ms');
      el.classList.remove('pend');
      if (obs) obs.unobserve(el);
    }

    var obs = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var k = pend.indexOf(e.target);
        if (k > -1) pend.splice(k, 1);
        revelar(e.target);
      });
    }, { threshold: 0 });
    pend.forEach(function (el) { obs.observe(el); });

    /* Rede de seguranca: passados 3s, o que ainda estiver pendente aparece.
       Animacao nao vista e um detalhe; texto nao lido nao e. */
    setTimeout(function () {
      pend.forEach(function (el) { el.classList.remove('pend'); });
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
