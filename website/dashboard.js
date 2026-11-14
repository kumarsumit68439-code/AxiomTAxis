(function () {
  var cfg = window.AXIOM_CONFIG || {};
  var models = window.AXIOM_MODELS || {};
  var API = String(cfg.STATS_URL || '').trim();
  while (API.endsWith('/')) API = API.slice(0, -1);

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    document.body.innerHTML = '<div style="padding:40px;font-family:Inter,sans-serif;background:#05060a;color:#f0f2f8;min-height:100vh"><h2>Supabase not configured</h2><p style="color:#8b93b2">Vercel env: SUPABASE_URL + SUPABASE_ANON_KEY. Supabase me Discord provider ON karo.</p><a href="/?site" style="color:#f97316">← Website</a></div>';
    return;
  }

  var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var session = null;
  var currentGuild = '';
  var data = null;

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function toast(msg, bad) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, 3800);
  }

  /* ---------- auth (session persists; login page only after logout) ---------- */
  function goLogin() { window.location.replace('/login.html'); }

  async function logout() {
    try { localStorage.removeItem('axiom_dtoken'); } catch (e) {}
    try { await supabase.auth.signOut(); } catch (e) {}
    goLogin();
  }

  async function requireAuth() {
    var res = await supabase.auth.getSession();
    if (res.error || !res.data.session) { goLogin(); return null; }
    session = res.data.session;
    return session;
  }

  supabase.auth.onAuthStateChange(function (event, s) {
    if (event === 'SIGNED_OUT') goLogin();
    else if (s) session = s;
  });

  function dtoken() {
    var t = session && session.provider_token;
    if (t) { try { localStorage.setItem('axiom_dtoken', t); } catch (e) {} return t; }
    try { return localStorage.getItem('axiom_dtoken') || ''; } catch (e) { return ''; }
  }

  async function api(method, path, body) {
    if (!API) throw new Error('STATS_URL is not set in Vercel env (public Railway domain of the bot).');
    var r;
    try {
      r = await fetch(API + path, {
        method: method,
        headers: { Authorization: 'Bearer ' + dtoken(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new Error('Cannot reach the bot API. Check STATS_URL and that Railway has a public domain.');
    }
    var j = {};
    try { j = await r.json(); } catch (e) {}
    if (r.status === 401) { await logout(); throw new Error('Session expired, login again.'); }
    if (!r.ok) { var err = new Error(j.error || ('API ' + r.status)); err.status = r.status; err.data = j; throw err; }
    return j;
  }

  /* ---------- navigation ---------- */
  var panels = $$('.panel');
  var navItems = $$('.nav-item');
  var topTitle = $('#topTitle');

  function showPanel(id) {
    panels.forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + id); });
    navItems.forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-panel') === id); });
    var item = document.querySelector('[data-panel="' + id + '"]');
    if (item && topTitle) topTitle.textContent = item.textContent.trim().replace(/^[^\w]+/, '') || id;
    $('#sidebar').classList.remove('open');
  }
  navItems.forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); showPanel(a.getAttribute('data-panel')); });
  });
  var menuBtn = $('#menuBtn');
  if (menuBtn) menuBtn.onclick = function () { $('#sidebar').classList.toggle('open'); };
  $('#logoutBtn').onclick = logout;

  function showUser(user) {
    var el = $('#userChip');
    if (!el || !user) return;
    var meta = user.user_metadata || {};
    var name = meta.full_name || meta.name || meta.preferred_username || user.email || 'User';
    el.innerHTML = '';
    if (meta.avatar_url) { var im = document.createElement('img'); im.src = meta.avatar_url; im.alt = ''; el.appendChild(im); }
    var sp = document.createElement('span'); sp.textContent = String(name); el.appendChild(sp);
  }

  /* ---------- invite ---------- */
  function inviteUrl(gid) {
    var id = String(cfg.CLIENT_ID || '').trim();
    if (!id) return '#';
    var u = 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(id) + '&permissions=8&scope=bot%20applications.commands';
    if (gid) u += '&guild_id=' + encodeURIComponent(gid) + '&disable_guild_select=true';
    return u;
  }
  $('#inviteTop').href = inviteUrl();

  /* ---------- servers ---------- */
  function renderGuilds(list) {
    var box = $('#myGuilds');
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<p class="muted">Koi server nahi mila jahan aapke paas Manage Server permission ho.</p>'; return; }
    list.forEach(function (g) {
      var card = document.createElement('div'); card.className = 'gcard';
      var ico;
      if (g.icon) { ico = document.createElement('img'); ico.src = 'https://cdn.discordapp.com/icons/' + g.id + '/' + g.icon + '.png?size=64'; ico.alt = ''; }
      else { ico = document.createElement('div'); ico.className = 'gi'; ico.textContent = (g.name || '?').charAt(0).toUpperCase(); }
      var nm = document.createElement('div'); nm.className = 'gn'; nm.textContent = g.name;
      var btn;
      if (g.botIn) {
        btn = document.createElement('button'); btn.className = 'btn-ghost'; btn.textContent = 'Manage';
        btn.onclick = function () { $('#guildSelect').value = g.id; selectGuild(g.id); showPanel('ai'); };
      } else {
        btn = document.createElement('a'); btn.className = 'btn-ghost'; btn.textContent = 'Invite bot';
        btn.href = inviteUrl(g.id); btn.target = '_blank'; btn.rel = 'noopener';
      }
      card.appendChild(ico); card.appendChild(nm); card.appendChild(btn); box.appendChild(card);
    });
  }

  async function loadMyGuilds() {
    var box = $('#myGuilds');
    box.innerHTML = '<p class="muted">Loading your servers…</p>';
    var sel = $('#guildSelect');
    try {
      var r = await api('GET', '/api/me/guilds');
      renderGuilds(r.guilds);
      sel.innerHTML = '<option value="">Select server…</option>';
      r.guilds.filter(function (g) { return g.botIn; }).forEach(function (g) {
        sel.add(new Option(g.name, g.id));
      });
    } catch (e) {
      box.innerHTML = '';
      var p = document.createElement('p'); p.className = 'muted'; p.textContent = e.message; box.appendChild(p);
    }
  }

  /* ---------- form binding ---------- */
  var provSel = $('#ai-provider');
  var modelSel = $('#ai-model');
  function fillModels() {
    modelSel.innerHTML = '';
    (models[provSel.value] || []).forEach(function (m) { modelSel.add(new Option(m, m)); });
  }
  Object.keys(models).forEach(function (p) { provSel.add(new Option(p, p)); });
  provSel.onchange = fillModels;
  if (provSel.options.length) { provSel.selectedIndex = 0; fillModels(); }

  function get(obj, path) {
    var cur = obj;
    path.split('.').forEach(function (k) { cur = cur == null ? undefined : cur[k]; });
    return cur;
  }
  function chName(id) {
    if (!data || !id) return '-';
    var c = data.channels.find(function (x) { return x.id === id; });
    return c ? (c.type === 4 ? c.name : '#' + c.name) : id;
  }
  function roleName(id) {
    if (!data || !id) return '-';
    var r = data.roles.find(function (x) { return x.id === id; });
    return r ? '@' + r.name : id;
  }

  function fillSelects() {
    $$('select[data-kind]').forEach(function (sel) {
      var items;
      if (sel.dataset.kind === 'text') items = data.channels.filter(function (c) { return c.type !== 4; }).map(function (c) { return [c.id, '#' + c.name]; });
      else if (sel.dataset.kind === 'cat') items = data.channels.filter(function (c) { return c.type === 4; }).map(function (c) { return [c.id, c.name]; });
      else items = data.roles.map(function (r) { return [r.id, '@' + r.name]; });
      sel.innerHTML = '';
      sel.add(new Option('— none —', ''));
      items.forEach(function (i) { sel.add(new Option(i[1], i[0])); });
    });
  }

  function applyAll() {
    $$('[data-f]').forEach(function (el) {
      var v = get(data.settings, el.dataset.f);
      if (el.type === 'checkbox') { el.checked = !!v; return; }
      if (el.hasAttribute('data-list')) { el.value = (v || []).join(String.fromCharCode(10)); return; }
      if ((v === undefined || v === null) && el.tagName === 'SELECT' && !el.dataset.kind) return;
      el.value = (v === undefined || v === null) ? '' : v;
      if (el.id === 'ai-provider') fillModels();
    });
    $$('[data-a]').forEach(function (el) { if (el.tagName === 'SELECT') el.value = ''; else if (el.type !== 'checkbox') el.value = ''; });
  }

  function splitList(text) {
    return text.split(String.fromCharCode(10)).join(',').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function collect() {
    var patch = {};
    $$('[data-f]').forEach(function (el) {
      var p = el.dataset.f.split('.');
      var v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.hasAttribute('data-list')) v = splitList(el.value);
      else if (el.type === 'number') v = el.value === '' ? '' : Number(el.value);
      else v = el.value;
      (patch[p[0]] = patch[p[0]] || {})[p[1]] = v;
    });
    return patch;
  }

  function row(left, btnText, onClick) {
    var d = document.createElement('div'); d.className = 'item';
    var s = document.createElement('span'); s.appendChild(left);
    var b = document.createElement('button'); b.className = 'btn danger'; b.textContent = btnText; b.onclick = onClick;
    d.appendChild(s); d.appendChild(b);
    return d;
  }

  function renderLists() {
    var st = data.settings;
    var cmds = Object.keys(st.commands || {});
    var cl = $('#cmd-list'); cl.innerHTML = '';
    if (!cmds.length) cl.innerHTML = '<p class="muted">Abhi koi command nahi.</p>';
    cmds.forEach(function (n) {
      var frag = document.createElement('span');
      var code = document.createElement('code'); code.textContent = '/c ' + n;
      var txt = document.createElement('small'); txt.textContent = ' ' + String(st.commands[n]).slice(0, 80);
      frag.appendChild(code); frag.appendChild(txt);
      cl.appendChild(row(frag, 'Delete', function () { runAction('command.delete', { name: n }); }));
    });

    var yl = $('#yt-list'); yl.innerHTML = '';
    ((st.yt && st.yt.items) || []).forEach(function (it) {
      var frag = document.createElement('span'); frag.textContent = it.name || it.id;
      yl.appendChild(row(frag, 'Remove', function () { runAction('yt.remove', { id: it.id }); }));
    });

    var t = st.ticket || {};
    $('#ticket-status').textContent = t.enabled ? 'Status: ON | Panel: ' + chName(t.panelChannelId) + ' | Category: ' + chName(t.categoryId) + ' | Support: ' + roleName(t.supportRoleId) : 'Status: OFF';
    var v = st.verification || {};
    $('#verification-status').textContent = v.roleId ? 'Status: ON | Channel: ' + chName(v.channelId) + ' | Role: ' + roleName(v.roleId) : 'Status: OFF';
    $('#counting-status').textContent = 'Current count: ' + ((st.counting && st.counting.count) || 0);
    $('#level-status').textContent = 'Members with XP: ' + ((st.levels && st.levels.members) || 0);
  }

  function setBanner(el) {
    var b = $('#banner');
    b.innerHTML = '';
    if (!el) { b.hidden = true; return; }
    b.appendChild(el); b.hidden = false;
  }

  async function loadGuild(gid) {
    setBanner(null);
    try {
      data = await api('GET', '/api/guilds/' + gid);
      fillSelects(); applyAll(); renderLists();
    } catch (e) {
      data = null;
      if (e.data && e.data.botMissing) {
        var w = document.createElement('span');
        w.appendChild(document.createTextNode('Bot is server me nahi hai. '));
        var a = document.createElement('a'); a.href = inviteUrl(gid); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Invite bot';
        w.appendChild(a); setBanner(w);
      } else toast(e.message, true);
    }
  }

  function selectGuild(gid) {
    currentGuild = gid;
    if (gid) loadGuild(gid); else { data = null; setBanner(null); }
  }
  $('#guildSelect').onchange = function () { selectGuild(this.value); };

  /* ---------- save + actions ---------- */
  $('#saveBtn').onclick = async function () {
    if (!currentGuild || !data) { toast('Pehle server select karo.', true); return; }
    var btn = this; btn.disabled = true;
    try {
      await api('PUT', '/api/guilds/' + currentGuild + '/settings', { patch: collect() });
      toast('Saved.');
      await loadGuild(currentGuild);
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  };

  async function runAction(action, extra, panel) {
    if (!currentGuild || !data) { toast('Pehle server select karo.', true); return; }
    var payload = Object.assign({ action: action }, extra || {});
    if (panel) {
      panel.querySelectorAll('[data-a]').forEach(function (el) {
        payload[el.dataset.a] = el.type === 'checkbox' ? el.checked : el.value;
      });
    }
    try {
      var r = await api('POST', '/api/guilds/' + currentGuild + '/actions', payload);
      toast(r.message || 'Done.');
      await loadGuild(currentGuild);
    } catch (e) { toast(e.message, true); }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    var collectForm = b.getAttribute('data-collect') !== 'no';
    b.disabled = true;
    runAction(b.getAttribute('data-act'), {}, collectForm ? b.closest('.panel') : null).then(function () { b.disabled = false; });
  });

  /* ---------- live stats ---------- */
  function set(sel, v) { $$(sel).forEach(function (el) { el.textContent = v; }); }
  function pollStats() {
    if (!API) return;
    fetch(API + '/stats', { cache: 'no-store' })
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
    loadMyGuilds();
    pollStats();
    setInterval(pollStats, 30000);
  });
})();
