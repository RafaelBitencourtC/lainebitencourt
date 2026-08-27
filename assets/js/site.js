/* =========================================================================
   site.js — navegação, acordeão e eventos GA4.

   CONTRATO (LAINE_04 §8). Os nomes abaixo são um contrato com a configuração
   do GA4 no Admin. Mudar um lado sem o outro faz os relatórios ficarem vazios
   em silêncio. `local` só pode assumir os valores do conjunto fechado.
   ========================================================================= */
(function () {
  'use strict';

  var LOCAIS = ['hero','barra_fixa_mobile','menu_topo','rodape','bloco_contato','pagina_atuacao','pagina_artigo'];

  function pagina() { return location.pathname; }

  function evento(nome, params) {
    if (params && params.local && LOCAIS.indexOf(params.local) === -1) {
      console.warn('[site.js] valor de `local` fora do conjunto fechado:', params.local);
      return;
    }
    if (typeof window.gtag === 'function') window.gtag('event', nome, params || {});
  }

  /* --- menu ------------------------------------------------------------ */
  var btn = document.querySelector('.navbtn');
  var nav = document.getElementById('nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var aberto = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!aberto));
      nav.setAttribute('data-open', String(!aberto));
      btn.querySelector('.sr-only').textContent = aberto ? 'Abrir menu' : 'Fechar menu';
    });
  }

  /* --- eventos de contato ---------------------------------------------- */
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-contato]');
    if (!a) return;
    var tipo = a.getAttribute('data-contato');
    var local = a.getAttribute('data-local') || 'bloco_contato';
    if (tipo === 'whatsapp') evento('contato_whatsapp', { local: local, pagina: pagina() });
    else if (tipo === 'telefone') evento('contato_telefone', { local: local, pagina: pagina() });
    else if (tipo === 'email') evento('contato_email', { local: local, pagina: pagina() });
  });

  /* --- acordeão do FAQ -------------------------------------------------- */
  Array.prototype.forEach.call(document.querySelectorAll('.faq details'), function (d) {
    d.addEventListener('toggle', function () {
      if (!d.open) return;
      var s = d.querySelector('summary');
      evento('abriu_faq', { pergunta: s ? s.textContent.trim() : '', pagina: pagina() });
    });
  });

  /* --- formulário -------------------------------------------------------
     B-6: enquanto não houver destino definido e sob controle, o envio é
     recusado aqui. Não apontar para o Formspree antigo.
     -------------------------------------------------------------------- */
  var form = document.querySelector('form[data-form="contato"]');
  if (form) {
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
        if (status) { status.hidden = false; status.textContent = 'Preencha os campos obrigatórios antes de enviar.'; }
        invalido.focus();
        evento('formulario_erro', { pagina: pagina(), motivo: 'campos_obrigatorios' });
        return;
      }

      if (!form.getAttribute('action')) {
        if (status) {
          status.hidden = false;
          status.textContent = 'O formulário ainda não está ativo. Use o WhatsApp (62) 99212-0065 enquanto isso.';
        }
        console.warn('[site.js] B-6 aberto: form sem destino. Envio recusado de propósito.');
        evento('formulario_erro', { pagina: pagina(), motivo: 'sem_destino' });
        return;
      }

      // Quando B-6 fechar, o POST real entra aqui e dispara:
      // evento('formulario_envio', { pagina: pagina() });
    });
  }

  /* --- 75% de leitura em artigos ---------------------------------------- */
  if (/^\/artigos\/[^/]+\/$/.test(location.pathname)) {
    var disparado = false;
    window.addEventListener('scroll', function () {
      if (disparado) return;
      var h = document.documentElement;
      var pct = (h.scrollTop + window.innerHeight) / h.scrollHeight;
      if (pct >= 0.75) { disparado = true; evento('leu_artigo', { artigo: pagina() }); }
    }, { passive: true });
  }
})();
