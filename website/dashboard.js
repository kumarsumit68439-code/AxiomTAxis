(function () {
  var cfg = window.AXIOM_CONFIG || {};
  var models = window.AXIOM_MODELS || {};

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    document.body.innerHTML = '<div style="padding:40px;font-family:Inter,sans-serif;background:#05060a;color:#f0f2f8;min-height:100vh"><h2>Supabase not configured</h2><p style="color:#8b93b2">Netlify env: SUPABASE_URL + SUPABASE_ANON_KEY. Supabase me Discord provider ON karo.</p><a href="/" style="color:#f97316">← Website</a></div>';
    return;
  }

  var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var session = null;
  var currentGuild = '';

  async function requireAuth() {
    var { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      window.location.replace('/login.html');
      return null;
    }
    session = data.session;
    return session;
  }

  supabase.auth.onAuthStateChange(function (event, s) {
    if (event === 'SIGNED_OUT' || !s) window.location.replace('/login.html');
    else session = s;
  });

  var panels = document.querySelectorAll('.panel');
  var navItems = document.querySelectorAll('.nav-item');
  var topTitle = document.getElementById('topTitle');

  function showPanel(id) {
    panels.forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + id); });
    navItems.forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-panel') === id); });
    var item = document.querySelector('[data-panel="' + id + '"]');
    if (item && topTitle) topTitle.textContent = item.textContent.trim().replace(/^[^\w]+/, '') || id;
    document.getElementById('sidebar').classList.remove('open');
  }

  navItems.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      showPanel(a.getAttribute('data-panel'));
    });
  });

  var menuBtn = document.getElementById('menuBtn');
  if (menuBtn) menuBtn.onclick = function () { document.getElementById('sidebar').classList.toggle('open'); };

  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = async function () {
    await supabase.auth.signOut();
    window.location.replace('/login.html');
  };

  function showUser(user) {
    var el = document.getElementById('userChip');
    if (!el || !user) return;
    var meta = user.user_metadata || {};
    var name = meta.full_name || meta.name || meta.preferred_username || user.email || 'User';
    var avatar = meta.avatar_url || '';
    el.innerHTML = (avatar ? '<img src="' + avatar + '" alt="">' : '') + '<span>' + String(name).replace(/</g, '') + '</span>';
  }

  async function loadGuilds() {
    var select = document.getElementById('guildSelect');
    select.innerHTML = '<option value="">Loading servers…</option>';
    var token = session.provider_token;
    if (!token) {
      var ref = await supabase.auth.refreshSession();
      if (ref.data && ref.data.session) session = ref.data.session;
      token = session.provider_token;
    }
    if (!token) {
      select.innerHTML = '<option value="">Re-login required (guilds scope)</option>';
      return;
    }
    try {
      var res = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!res.ok) throw new Error('API ' + res.status);
      var guilds = await res.json();
      guilds = (guilds || []).slice().sort(function (a, b) {
        return (a.name || '').localeCompare(b.name || '');
      });
      select.innerHTML = '<option value="">Select server…</option>';
      guilds.forEach(function (g) {
        var opt = document.createElement('option');
        opt.value = g.id;
        var perm = parseInt(g.permissions || '0', 10);
        var can = (perm & 0x20) === 0x20 || (perm & 0x8) === 0x8 || g.owner;
        opt.textContent = (can ? '⚙ ' : '') + (g.name || g.id);
        select.appendChild(opt);
      });
    } catch (e) {
      console.error(e);
      select.innerHTML = '<option value="">Failed to load — re-login</option>';
    }
  }

  var provSel = document.getElementById('ai-provider');
  var modelSel = document.getElementById('ai-model');
  if (provSel) {
    Object.keys(models).forEach(function (p) {
      var o = document.createElement('option');
      o.value = p; o.textContent = p;
      provSel.appendChild(o);
    });
    function fillModels() {
      modelSel.innerHTML = '';
      (models[provSel.value] || []).forEach(function (m) {
        var o = document.createElement('option');
        o.value = m; o.textContent = m;
        modelSel.appendChild(o);
      });
    }
    provSel.onchange = fillModels;
    if (Object.keys(models).length) { provSel.value = Object.keys(models)[0]; fillModels(); }
  }

  function collectFromForm() {
    return {
      ai: {
        provider: provSel && provSel.value,
        model: modelSel && modelSel.value,
        system: document.getElementById('ai-prompt') && document.getElementById('ai-prompt').value.trim() || undefined
      },
      welcome: { message: document.getElementById('welcome-msg') && document.getElementById('welcome-msg').value.trim() || undefined },
      leave: { message: document.getElementById('leave-msg') && document.getElementById('leave-msg').value.trim() || undefined }
    };
  }

  function applyToForm(d) {
    if (!d) return;
    if (d.ai && provSel) {
      if (d.ai.provider && models[d.ai.provider]) { provSel.value = d.ai.provider; provSel.dispatchEvent(new Event('change')); }
      if (d.ai.model && modelSel) modelSel.value = d.ai.model;
      if (d.ai.system && document.getElementById('ai-prompt')) document.getElementById('ai-prompt').value = d.ai.system;
    }
    if (d.welcome && d.welcome.message && document.getElementById('welcome-msg')) document.getElementById('welcome-msg').value = d.welcome.message;
    if (d.leave && d.leave.message && document.getElementById('leave-msg')) document.getElementById('leave-msg').value = d.leave.message;
  }

  async function loadSettings(gid) {
    try {
      var { data, error } = await supabase.from('guild_settings').select('data').eq('guild_id', gid).maybeSingle();
      if (!error && data && data.data) { applyToForm(data.data); return; }
    } catch (e) {}
    try {
      var all = JSON.parse(localStorage.getItem('axiom_dash_' + (session.user && session.user.id)) || '{}');
      applyToForm(all[gid]);
    } catch (e) {}
  }

  async function saveSettings(gid, patch) {
    var key = 'axiom_dash_' + (session.user && session.user.id);
    var all = {};
    try { all = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
    var prev = all[gid] || {};
    var merged = {
      ai: Object.assign({}, prev.ai || {}, patch.ai || {}),
      welcome: Object.assign({}, prev.welcome || {}, patch.welcome || {}),
      leave: Object.assign({}, prev.leave || {}, patch.leave || {})
    };
    all[gid] = merged;
    localStorage.setItem(key, JSON.stringify(all));
    try {
      var { data: existing } = await supabase.from('guild_settings').select('data').eq('guild_id', gid).maybeSingle();
      var base = (existing && existing.data) || {};
      var next = Object.assign({}, base, {
        ai: Object.assign({}, base.ai || {}, merged.ai),
        welcome: Object.assign({}, base.welcome || {}, merged.welcome),
        leave: Object.assign({}, base.leave || {}, merged.leave)
      });
      await supabase.from('guild_settings').upsert({ guild_id: gid, data: next, updated_at: new Date().toISOString() });
    } catch (e) { console.warn('Supabase write skipped', e); }
  }

  var guildSelect = document.getElementById('guildSelect');
  if (guildSelect) guildSelect.onchange = function () {
    currentGuild = guildSelect.value;
    if (currentGuild) loadSettings(currentGuild);
  };

  var saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.onclick = async function () {
    if (!currentGuild) { alert('Pehle server select karo.'); return; }
    saveBtn.disabled = true;
    await saveSettings(currentGuild, collectFromForm());
    saveBtn.disabled = false;
    alert('Saved.');
  };

  function set(sel, v) { document.querySelectorAll(sel).forEach(function (el) { el.textContent = v; }); }
  function pollStats() {
    if (!cfg.STATS_URL) return;
    fetch(cfg.STATS_URL.replace(/\/+$/, '') + '/stats', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.online) return;
        set('[data-ov="servers"]', d.servers);
        set('[data-ov="mode"]', d.mode || '—');
        set('[data-ov="ping"]', d.ping + 'ms');
        set('[data-ov="ping2"]', d.ping + 'ms');
        var s = d.uptime || 0, h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        var up = h ? h + 'h ' + m + 'm' : m + 'm';
        set('[data-ov="uptime"]', up);
        set('[data-ov="uptime2"]', up);
      }).catch(function () {});
  }

  requireAuth().then(function (s) {
    if (!s) return;
    showUser(s.user);
    loadGuilds();
    pollStats();
    setInterval(pollStats, 30000);
  });
})();
