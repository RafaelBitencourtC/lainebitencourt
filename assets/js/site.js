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
  /* link_location (16/11/2026): agrupamento grosso de `local`, pedido para
     comparar qual botão converte. `local` continua sendo enviado e continua
     sendo o contrato fino. Todo valor de LOCAIS precisa ter par aqui. */
  var LINK_LOCATION = {
    barra_fixa_mobile: 'flutuante',
    menu_topo: 'cabecalho',
    rodape: 'rodape',
    hero: 'corpo', bloco_contato: 'corpo', pagina_atuacao: 'corpo', pagina_artigo: 'corpo'
  };
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
     NAO EXISTE MAIS AQUI. A revelacao e 100% CSS (animation-timeline:view),
     ver o bloco "Movimento" no site.css. Este arquivo nao mexe, e nao pode
     voltar a mexer, na visibilidade de [data-reveal]: quatro incidentes em
     producao vieram exatamente disso. Se o texto precisa aparecer, ele ja
     esta visivel; o JS nao participa.
  ------------------------------------------------------------------------ */

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

  /* --- clique de anúncio (16/11/2026, "ClickCease nosso") ----------------
     Visita que chega com gclid/gbraid/wbraid vira 1 linha no registro de
     cliques (worker/cliques.js), uma vez por clique por sessão. Um toque em
     WhatsApp/telefone/e-mail dessa visita marca a linha, para o bloqueio
     automático de IP nunca tomar quem fez contato por robô. Nada disso vai
     para o GA4; o id do clique fica só no sessionStorage desta aba.
     Base legal: legítimo interesse (prevenção a fraude), na Política de
     Privacidade "Proteção contra cliques inválidos". */
  var cliqueAnuncio = (function () {
    var GUARDA = 'lb_click', ENVIADOS = 'lb_click_sent', achado = null, guardado = null;
    try { guardado = JSON.parse(sessionStorage.getItem(GUARDA) || 'null'); } catch (e) { guardado = null; }
    try {
      var q = new URLSearchParams(location.search);
      ['gclid','gbraid','wbraid'].forEach(function (k) {
        var v = (q.get(k) || '').trim();
        if (!achado && /^[A-Za-z0-9_-]{10,200}$/.test(v)) achado = { kind: k, id: v };
      });
      if (achado) {
        var env = ''; try { env = sessionStorage.getItem(ENVIADOS) || ''; } catch (e) {}
        if (env.indexOf('|' + achado.id + '|') === -1) {   // recarregar a mesma página não é clique novo
          if (env.length > 4000) env = '';
          try { sessionStorage.setItem(ENVIADOS, (env || '|') + achado.id + '|'); } catch (e) {}
          beacon({ click: achado, page: location.pathname, campaign: (q.get('utm_campaign') || '').replace(/[<>]/g, '').trim().slice(0, 60) });
        }
        try { sessionStorage.setItem(GUARDA, JSON.stringify(achado)); } catch (e) {}
      }
    } catch (e) { /* sem URLSearchParams: sem registro */ }
    return achado || (guardado && guardado.kind && guardado.id ? guardado : null);
  })();
  function beacon(obj) {
    var corpo = JSON.stringify(obj);
    try { if (navigator.sendBeacon && navigator.sendBeacon('/api/click', new Blob([corpo], { type: 'application/json' }))) return; } catch (e) {}
    try { fetch('/api/click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo, keepalive: true }).catch(function () {}); } catch (e) {}
  }

  /* --- eventos de contato ----------------------------------------------- */
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-contato]'); if (!a) return;
    if (cliqueAnuncio) beacon({ click: cliqueAnuncio, page: location.pathname, event: 'contato' });
    var tipo = a.getAttribute('data-contato'), local = a.getAttribute('data-local') || 'bloco_contato';
    /* Sem preventDefault e sem redirect: o link abre na hora; o gtag.js envia
       por sendBeacon, que sobrevive à troca de página. */
    var p = { local: local, link_location: LINK_LOCATION[local] || 'corpo', pagina: pagina() };
    if (tipo === 'whatsapp') evento('contato_whatsapp', p);
    else if (tipo === 'telefone') evento('contato_telefone', p);
    else if (tipo === 'email') evento('contato_email', p);
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
