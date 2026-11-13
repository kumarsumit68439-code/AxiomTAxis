(function () {
  var $ = function (s) { return document.querySelector(s); };
  var cfg = window.AXIOM_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    document.body.insertAdjacentHTML('afterbegin', '<p style="color:#ff5c6c;padding:12px">Supabase config missing: set SUPABASE_URL and SUPABASE_ANON_KEY in Netlify env and redeploy.</p>');
    return;
  }
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var user = null, timer = null;

  function view(name) {
    ['landing', 'auth', 'dash'].forEach(function (id) { $('#' + id).hidden = id !== name; });
    $('#logout').hidden = name !== 'dash';
    $('#who').textContent = user ? user.email : '';
  }

  $('#cta').onclick = function () { view(user ? 'dash' : 'auth'); };
  $('#logout').onclick = function () { sb.auth.signOut(); };

  function authAction(kind) {
    var email = $('#email').value.trim(), password = $('#pass').value;
    $('#authmsg').textContent = '';
    var p = kind === 'signup' ? sb.auth.signUp({ email: email, password: password }) : sb.auth.signInWithPassword({ email: email, password: password });
    p.then(function (r) {
      if (r.error) $('#authmsg').textContent = r.error.message;
      else if (kind === 'signup' && !r.data.session) $('#authmsg').textContent = 'Email confirm karo, phir login karo.';
    });
  }
  $('#login').onclick = function () { authAction('login'); };
  $('#signup').onclick = function () { authAction('signup'); };

  sb.auth.onAuthStateChange(function (_e, session) {
    user = session ? session.user : null;
    clearInterval(timer);
    if (user) { view('dash'); loadBots(); timer = setInterval(loadBots, 10000); }
    else view('landing');
  });
  sb.auth.getSession().then(function (r) { if (!r.data.session) view('landing'); });

  var form = $('#botform');
  var provSel = form.provider, modelSel = form.model;
  Object.keys(window.AXIOM_MODELS).forEach(function (p) { provSel.add(new Option(p, p)); });
  function fillModels() {
    modelSel.innerHTML = '';
    (window.AXIOM_MODELS[provSel.value] || []).forEach(function (m) { modelSel.add(new Option(m, m)); });
  }
  provSel.onchange = fillModels; fillModels();

  function showType() {
    document.querySelectorAll('[data-type]').forEach(function (el) { el.hidden = el.getAttribute('data-type') !== form.type.value; });
  }
  form.type.onchange = showType; showType();

  function parseCmds(text) {
    return text.split('\n').map(function (l) {
      var i = l.indexOf('|'); if (i < 1) return null;
      var name = l.slice(0, i).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
      var reply = l.slice(i + 1).trim().slice(0, 1800);
      return name && reply ? { name: name, reply: reply } : null;
    }).filter(Boolean).slice(0, 50);
  }

  form.onsubmit = function (e) {
    e.preventDefault();
    var t = form.type.value, config = {};
    if (t === 'simple') config.commands = parseCmds(form.commands.value);
    if (t === 'welcome') { config.channelId = form.wchannel.value.trim(); config.message = form.wmsg.value; }
    if (t === 'ai') {
      config.channelId = form.achannel.value.trim(); config.provider = provSel.value;
      config.model = modelSel.value; config.system = form.sys.value;
    }
    $('#formmsg').textContent = '';
    sb.from('bots').insert({ name: form.name.value.trim(), type: t, token: form.token.value.trim(), config: config, enabled: true, status: 'starting' })
      .then(function (r) {
        if (r.error) { $('#formmsg').textContent = r.error.message; return; }
        form.token.value = ''; form.name.value = ''; loadBots();
      });
  };

  function loadBots() {
    sb.from('bots').select('id,name,type,enabled,status,status_detail,created_at').order('created_at', { ascending: false }).then(function (r) {
      var box = $('#bots'); box.innerHTML = '';
      if (r.error) { box.textContent = r.error.message; return; }
      if (!r.data.length) { box.innerHTML = '<small>Abhi koi bot nahi.</small>'; return; }
      r.data.forEach(function (b) {
        var card = document.createElement('div'); card.className = 'card bot'; card.style.marginBottom = '10px';
        var left = document.createElement('div');
        var title = document.createElement('b'); title.textContent = b.name + ' ';
        var badge = document.createElement('span'); badge.className = 'badge ' + b.status; badge.textContent = b.enabled ? b.status : 'stopped';
        var sub = document.createElement('div'); var s = document.createElement('small');
        s.textContent = b.type + (b.status_detail ? ' - ' + b.status_detail : ''); sub.appendChild(s);
        left.appendChild(title); left.appendChild(badge); left.appendChild(sub);
        var right = document.createElement('div'); right.className = 'row';
        var tog = document.createElement('button'); tog.className = 'sec'; tog.textContent = b.enabled ? 'Stop' : 'Start';
        tog.onclick = function () { sb.from('bots').update({ enabled: !b.enabled, status: b.enabled ? 'offline' : 'starting' }).eq('id', b.id).then(loadBots); };
        var del = document.createElement('button'); del.className = 'bad'; del.textContent = 'Delete';
        del.onclick = function () { if (confirm('Delete ' + b.name + '?')) sb.from('bots').delete().eq('id', b.id).then(loadBots); };
        right.appendChild(tog); right.appendChild(del);
        card.appendChild(left); card.appendChild(right); box.appendChild(card);
      });
    });
  }
})();
