(function () {
  var cfg = window.AXIOM_CONFIG || {};
  var models = window.AXIOM_MODELS || {};
  var API = (cfg.STATS_URL || '').trim();
  while (API.endsWith('/')) API = API.slice(0, -1);
  // View/Send/Embed/History/Connect/Speak + Audit Log, Ban, Kick, Manage Roles/Channels/Messages, Reactions, Timeout
  var PERMS = '1099783302358';
  var $ = function (id) { return document.getElementById(id); };
  var qa = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    document.body.innerHTML = '<div style="padding:40px;font-family:Inter,sans-serif;background:#05060a;color:#f0f2f8;min-height:100vh"><h2>Supabase not configured</h2><p style="color:#8b93b2">Vercel env: SUPABASE_URL + SUPABASE_ANON_KEY, phir redeploy.</p><a href="/" style="color:#f97316">Back</a></div>';
    return;
  }

  var supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var session = null, currentGuild = '', data = null;

  function toast(msg, bad) {
    var t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  function inviteUrl(gid) {
    if (!cfg.CLIENT_ID) return '#';
    var u = 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(cfg.CLIENT_ID) + '&permissions=' + PERMS + '&scope=bot%20applications.commands';
    if (gid) u += '&guild_id=' + gid + '&disable_guild_select=true';
    return u;
  }

  // Discord OAuth token is only given right after login; keep it so refresh never forces a re-login.
  function keepToken(s) { try { if (s && s.provider_token) localStorage.setItem('axiom_dtoken', s.provider_token); } catch (e) {} }
  function token() { keepToken(session); try { return localStorage.getItem('axiom_dtoken') || ''; } catch (e) { return ''; } }
  function clearToken() { try { localStorage.removeItem('axiom_dtoken'); } catch (e) {} }

  function reconnect() {
    return supabase.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: window.location.origin + '/dashboard.html', scopes: 'identify email guilds' } });
  }

  function banner(html) {
    var b = $('banner');
    if (!html) { b.hidden = true; b.innerHTML = ''; return; }
    b.innerHTML = html; b.hidden = false;
    var r = $('reconnectBtn');
    if (r) r.onclick = reconnect;
  }

  supabase.auth.onAuthStateChange(function (event, s) {
    if (event === 'SIGNED_OUT') { clearToken(); window.location.replace('/login.html'); return; }
    if (s) { session = s; keepToken(s); }
  });

  var panels = qa('.panel');
  var navItems = qa('.nav-item');
  var topTitle = $('topTitle');

  function showPanel(id) {
    panels.forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + id); });
    navItems.forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-panel') === id); });
    var item = document.querySelector('[data-panel="' + id + '"]');
    if (item && topTitle) topTitle.textContent = item.textContent.trim().replace(/^[^A-Za-z]+/, '') || id;
    $('sidebar').classList.remove('open');
  }
  navItems.forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); showPanel(a.getAttribute('data-panel')); });
  });
  if (location.hash && document.getElementById('panel-' + location.hash.slice(1))) showPanel(location.hash.slice(1));

  $('menuBtn').onclick = function () { $('sidebar').classList.toggle('open'); };
  $('logoutBtn').onclick = async function () { clearToken(); await supabase.auth.signOut(); window.location.replace('/login.html'); };
  ['inviteTop', 'inviteBtn'].forEach(function (id) { if ($(id)) $(id).href = inviteUrl(''); });

  function showUser(user) {
    var el = $('userChip');
    if (!el || !user) return;
    var meta = user.user_metadata || {};
    var name = meta.full_name || meta.name || meta.preferred_username || user.email || 'User';
    el.innerHTML = '';
    if (meta.avatar_url) { var im = document.createElement('img'); im.src = meta.avatar_url; im.alt = ''; el.appendChild(im); }
    var sp = document.createElement('span'); sp.textContent = String(name); el.appendChild(sp);
  }

  async function loadGuilds() {
    var select = $('guildSelect');
    select.innerHTML = '<option value="">Loading servers...</option>';
    var t = token();
    if (!t) { select.innerHTML = '<option value="">Reconnect Discord</option>'; banner('Discord server list ke liye ek baar reconnect karo. <button class="btn" id="reconnectBtn">Reconnect Discord</button>'); return; }
    try {
      var res = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: 'Bearer ' + t } });
      if (res.status === 401) { clearToken(); select.innerHTML = '<option value="">Reconnect Discord</option>'; banner('Discord session expire ho gaya. <button class="btn" id="reconnectBtn">Reconnect Discord</button>'); return; }
      if (!res.ok) throw new Error('API ' + res.status);
      var guilds = await res.json();
      var canManage = function (g) { var p = 0; try { p = Number(BigInt(g.permissions || '0') & 0x28n); } catch (e) {} return !!g.owner || p !== 0; };
      guilds = guilds.filter(canManage).sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
      select.innerHTML = '<option value="">Select server...</option>';
      guilds.forEach(function (g) {
        var o = document.createElement('option'); o.value = g.id; o.textContent = g.name || g.id; select.appendChild(o);
      });
      if (!guilds.length) banner('Koi server nahi mila jahan aapke paas Manage Server permission ho.');
      var saved = ''; try { saved = localStorage.getItem('axiom_guild') || ''; } catch (e) {}
      if (saved && guilds.some(function (g) { return g.id === saved; })) { select.value = saved; currentGuild = saved; loadGuild(saved); }
    } catch (e) {
      console.error(e);
      select.innerHTML = '<option value="">Failed to load servers</option>';
    }
  }

  var provSel = $('ai-provider'), modelSel = $('ai-model');
  function fillModels() {
    modelSel.innerHTML = '';
    (models[provSel.value] || []).forEach(function (m) { var o = document.createElement('option'); o.value = m; o.textContent = m; modelSel.appendChild(o); });
  }
  Object.keys(models).forEach(function (p) { var o = document.createElement('option'); o.value = p; o.textContent = p; provSel.appendChild(o); });
  provSel.onchange = fillModels;
  if (Object.keys(models).length) { provSel.value = Object.keys(models)[0]; fillModels(); }

  async function api(method, path, body) {
    if (!API) throw new Error('STATS_URL set nahi hai (Vercel env me Railway URL daalo).');
    var r = await fetch(API + path, {
      method: method,
      headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || ('API ' + r.status)); e.status = r.status; e.data = j; throw e; }
    return j;
  }

  var getp = function (obj, path) { return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj); };
  var chName = function (id) { if (!id) return '-'; var c = (data.channels || []).find(function (x) { return x.id === id; }); return c ? '#' + c.name : id; };
  var roleName = function (id) { if (!id) return '-'; var r = (data.roles || []).find(function (x) { return x.id === id; }); return r ? '@' + r.name : id; };

  function fillSelects() {
    qa('select[data-kind]').forEach(function (sel) {
      var keep = sel.value, kind = sel.getAttribute('data-kind');
      sel.innerHTML = '';
      var none = document.createElement('option'); none.value = ''; none.textContent = '- none -'; sel.appendChild(none);
      var list = kind === 'role' ? data.roles : data.channels.filter(function (c) { return kind === 'cat' ? c.type === 4 : c.type !== 4; });
      list.forEach(function (it) {
        var o = document.createElement('option'); o.value = it.id;
        o.textContent = (kind === 'role' ? '@' : kind === 'cat' ? '' : '#') + it.name; sel.appendChild(o);
      });
      sel.value = keep;
    });
  }

  function applyAll() {
    qa('[data-f]').forEach(function (el) {
      var v = getp(data.settings, el.getAttribute('data-f'));
      if (el.type === 'checkbox') { el.checked = !!v; return; }
      if (el.hasAttribute('data-list')) { el.value = (v || []).join(String.fromCharCode(10)); return; }
      if (v === undefined || v === null) { if (el.id === 'ai-provider' || el.id === 'ai-model') return; v = ''; }
      el.value = v;
      if (el.id === 'ai-provider') fillModels();
    });
  }

  function renderLists() {
    var s = data.settings;
    $('counting-status').innerHTML = 'Channel: <b>' + chName(s.counting.channelId).replace(/</g, '') + '</b> &middot; Current count: <b>' + (s.counting.count || 0) + '</b>';
    $('level-status').innerHTML = 'Levels: <b>' + (s.levels.enabled ? 'On' : 'Off') + '</b> &middot; Members with XP: <b>' + (s.levels.members || 0) + '</b>';
    var t = s.ticket || {};
    $('ticket-status').innerHTML = t.enabled ? 'Status: <b>ON</b> &middot; Panel: <b>' + chName(t.panelChannelId).replace(/</g, '') + '</b> &middot; Category: <b>' + chName(t.categoryId).replace(/</g, '') + '</b> &middot; Support role: <b>' + roleName(t.supportRoleId).replace(/</g, '') + '</b>' : 'Status: <b>OFF</b>';
    var v = s.verification || {};
    $('verification-status').innerHTML = v.roleId ? 'Status: <b>ON</b> &middot; Panel: <b>' + chName(v.channelId).replace(/</g, '') + '</b> &middot; Role: <b>' + roleName(v.roleId).replace(/</g, '') + '</b>' : 'Status: <b>OFF</b>';

    var cl = $('cmd-list'); cl.innerHTML = '';
    var names = Object.keys(s.commands || {});
    if (!names.length) cl.innerHTML = '<div class="hint">Abhi koi command nahi.</div>';
    names.forEach(function (n) {
      var row = document.createElement('div'); row.className = 'li';
      var sp = document.createElement('span'); sp.textContent = '/c ' + n + ' - ' + s.commands[n];
      var b = document.createElement('button'); b.className = 'btn alt danger'; b.textContent = 'Delete';
      b.setAttribute('data-act', 'command.delete'); b.setAttribute('data-name', n); b.setAttribute('data-collect', 'no');
      row.appendChild(sp); row.appendChild(b); cl.appendChild(row);
    });

    var yl = $('yt-list'); yl.innerHTML = '';
    var items = (s.yt && s.yt.items) || [];
    if (!items.length) yl.innerHTML = '<div class="hint">Koi YouTube channel add nahi.</div>';
    items.forEach(function (it) {
      var row = document.createElement('div'); row.className = 'li';
      var sp = document.createElement('span'); sp.textContent = it.name || it.id;
      var b = document.createElement('button'); b.className = 'btn alt danger'; b.textContent = 'Remove';
      b.setAttribute('data-act', 'yt.remove'); b.setAttribute('data-id', it.id); b.setAttribute('data-collect', 'no');
      row.appendChild(sp); row.appendChild(b); yl.appendChild(row);
    });
  }

  async function loadGuild(gid) {
    banner('');
    try { localStorage.setItem('axiom_guild', gid); } catch (e) {}
    try {
      data = await api('GET', '/api/guilds/' + gid);
      fillSelects(); applyAll(); renderLists();
    } catch (e) {
      data = null;
      if (e.data && e.data.botMissing) banner('Bot is server me nahi hai. <a class="btn" href="' + inviteUrl(gid) + '" target="_blank" rel="noopener">Invite bot here</a>');
      else if (e.status === 401) { clearToken(); banner('Discord session expire ho gaya. <button class="btn" id="reconnectBtn">Reconnect Discord</button>'); }
      else toast(e.message, true);
    }
  }

  $('guildSelect').onchange = function () {
    currentGuild = $('guildSelect').value;
    if (currentGuild) loadGuild(currentGuild); else { data = null; banner(''); }
  };

  function collect() {
    var patch = {};
    qa('[data-f]').forEach(function (el) {
      var p = el.getAttribute('data-f').split('.'), v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.hasAttribute('data-list')) v = el.value.split(String.fromCharCode(10)).join(',').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      else if (el.type === 'number') v = el.value === '' ? '' : Number(el.value);
      else v = el.value;
      (patch[p[0]] = patch[p[0]] || {})[p[1]] = v;
    });
    return patch;
  }

  $('saveBtn').onclick = async function () {
    if (!currentGuild || !data) { toast('Pehle server select karo.', true); return; }
    var b = $('saveBtn'); b.disabled = true;
    try { await api('PUT', '/api/guilds/' + currentGuild + '/settings', { patch: collect() }); toast('Saved.'); await loadGuild(currentGuild); }
    catch (e) { toast(e.message, true); }
    b.disabled = false;
  };

  document.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    if (!currentGuild || !data) { toast('Pehle server select karo.', true); return; }
    var payload = { action: b.getAttribute('data-act') };
    if (b.getAttribute('data-name')) payload.name = b.getAttribute('data-name');
    if (b.getAttribute('data-id')) payload.id = b.getAttribute('data-id');
    if (b.getAttribute('data-collect') !== 'no') {
      var panel = b.closest('.panel');
      qa('[data-a]', panel).forEach(function (el) { payload[el.getAttribute('data-a')] = el.value; });
    }
    b.disabled = true;
    try {
      var r = await api('POST', '/api/guilds/' + currentGuild + '/actions', payload);
      toast(r.message || 'Done');
      await loadGuild(currentGuild);
    } catch (err) { toast(err.message, true); }
    b.disabled = false;
  });

  function set(sel, v) { qa(sel).forEach(function (el) { el.textContent = v; }); }
  function pollStats() {
    if (!API) return;
    fetch(API + '/stats', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.online) return;
      set('[data-ov="servers"]', d.servers);
      set('[data-ov="mode"]', d.mode || '-');
      set('[data-ov="ping"]', d.ping + 'ms');
      set('[data-ov="ping2"]', d.ping + 'ms');
      var s = d.uptime || 0, h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      var up = h ? h + 'h ' + m + 'm' : m + 'm';
      set('[data-ov="uptime"]', up); set('[data-ov="uptime2"]', up);
    }).catch(function () {});
  }

  supabase.auth.getSession().then(function (r) {
    if (!r.data || !r.data.session) { window.location.replace('/login.html'); return; }
    session = r.data.session;
    keepToken(session);
    showUser(session.user);
    loadGuilds();
    pollStats();
    setInterval(pollStats, 30000);
  });
})();
