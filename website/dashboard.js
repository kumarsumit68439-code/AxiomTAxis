(function () {
  var cfg = window.AXIOM_CONFIG || {};
  var models = window.AXIOM_MODELS || {};
  var API = (cfg.STATS_URL || '').trim();
  while (API.endsWith('/')) API = API.slice(0, -1);
  // View/Send/Embed/History/Connect/Speak + Audit Log, Ban, Kick, Manage Roles/Channels/Messages, Reactions, Timeout
  var PERMS = '1099783302358';
  var NL = String.fromCharCode(10);
  var $ = function (id) { return document.getElementById(id); };
  var qa = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var esc = function (t) { return String(t).split('&').join('&').split('<').join('<').split('>').join('>'); };

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    document.body.innerHTML = '<div style="padding:40px;font-family:Inter,sans-serif;background:#05060a;color:#f0f2f8;min-height:100vh"><h2>Supabase not configured</h2><p style="color:#8b93b2">Vercel env: SUPABASE_URL + SUPABASE_ANON_KEY, phir redeploy.</p><a href="/login.html" style="color:#f97316">Login</a></div>';
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
    setTimeout(function () { t.remove(); }, 5000);
  }

  function inviteUrl(gid) {
    if (!cfg.CLIENT_ID) return '#';
    var u = 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(cfg.CLIENT_ID) + '&permissions=' + PERMS + '&scope=bot%20applications.commands';
    if (gid) u += '&guild_id=' + gid + '&disable_guild_select=true';
    return u;
  }

  function keepToken(s) { try { if (s && s.provider_token) localStorage.setItem('axiom_dtoken', s.provider_token); } catch (e) {} }
  function token() { keepToken(session); try { return localStorage.getItem('axiom_dtoken') || ''; } catch (e) { return ''; } }
  function clearToken() { try { localStorage.removeItem('axiom_dtoken'); } catch (e) {} }
  function reconnect() {
    return supabase.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: window.location.origin + '/login.html', scopes: 'identify email guilds' } });
  }

  function banner(html) {
    var b = $('banner');
    if (!html) { b.hidden = true; b.innerHTML = ''; return; }
    b.innerHTML = html; b.hidden = false;
    var r = $('reconnectBtn'); if (r) r.onclick = reconnect;
    var rt = $('retryBtn'); if (rt) rt.onclick = function () { if (currentGuild) loadGuild(currentGuild); else loadGuilds(); };
  }

  async function leave() {
    clearToken();
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
    try { await supabase.auth.signOut(); } catch (e) {}
    window.location.replace('/login.html');
  }

  supabase.auth.onAuthStateChange(function (event, s) {
    if (event === 'SIGNED_OUT') { clearToken(); window.location.replace('/login.html'); return; }
    if (s) { session = s; keepToken(s); }
  });

  var css = `.rule{background:var(--card);border:1px solid var(--line);border-radius:16px;margin:14px 0;overflow:hidden}
.rule-h{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line)}
.rule-h b{display:block;font-size:15px}.rule-h small{color:var(--mut);font-size:12.5px}
.rule-b{padding:6px 18px 16px}
.sec-t{margin:30px 0 2px;font-size:18px;font-weight:800}
.sec-d{color:var(--mut);font-size:13px;margin:0 0 6px}
select[multiple]{height:auto;min-height:120px}
.pv{display:flex;gap:16px;align-items:flex-end;margin:14px 0;flex-wrap:wrap}
.pv img{background:#0b0d16;border:1px solid var(--line);object-fit:cover}
.pv .av{width:84px;height:84px;border-radius:50%}
.pv .bn{width:100%;max-width:340px;height:110px;border-radius:12px}
.esc{display:grid;grid-template-columns:130px 1fr 90px 100px;gap:10px;align-items:center;margin:10px 0}
.esc select,.esc input{margin:0}
@media(max-width:700px){.esc{grid-template-columns:1fr 1fr}}`;
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var DEF = {};
  var PD = { invites: 'timeout', links: 'timeout', scam: 'timeout', mentions: 'timeout', spam: 'timeout', words: 'timeout', gif: 'delete', zalgo: 'delete', caps: 'delete', profanity: 'delete' };
  var MD = { invites: 10, links: 15, gif: 5, scam: 60, mentions: 30, spam: 5, words: 15, zalgo: 10, caps: 5, profanity: 5 };
  Object.keys(PD).forEach(function (k) { DEF['automod.' + k + '.punish'] = PD[k]; DEF['automod.' + k + '.minutes'] = MD[k]; });
  DEF['automod.links.whitelist'] = ['youtube.com', 'spotify.com', 'tenor.com', 'giphy.com'];
  DEF['automod.mentions.max'] = 5; DEF['automod.spam.max'] = 5; DEF['automod.caps.threshold'] = 70;
  ['tenor', 'imgur', 'direct'].forEach(function (k) { DEF['automod.gif.' + k] = true; });
  ['severe', 'sexual', 'hate'].forEach(function (k) { DEF['automod.profanity.' + k] = true; });
  DEF['automod.escalation.expireHours'] = 24;
  var STEPS = [['warn', 10, 'min'], ['timeout', 1, 'hour'], ['timeout', 24, 'hour'], ['kick', 7, 'day']];
  STEPS.forEach(function (s, i) { var p = 'automod.escalation.s' + (i + 1) + '.'; DEF[p + 'action'] = s[0]; DEF[p + 'value'] = s[1]; DEF[p + 'unit'] = s[2]; });

  function sw(path, label, cls) { return `<label class='sw ${cls || ''}'><input type='checkbox' data-f='${path}'> ${label}</label>`; }
  function nm(path, label, min, max, ph) { return `<div><label>${label}</label><input type='number' min='${min}' max='${max}' data-f='${path}' placeholder='${ph}'></div>`; }
  function pun(p) {
    return `<div><label>Punishment</label><select data-f='${p}.punish'><option value='delete'>Delete message only</option><option value='timeout'>Delete + mute member (timeout)</option></select></div>` + nm(p + '.minutes', 'Mute duration (minutes)', 1, 40320, '10');
  }
  function ta(path, label, ph) { return `<label>${label}</label><textarea rows='3' data-f='${path}' data-list='1' placeholder='${ph}'></textarea>`; }
  function ms(path, kind, label) { return `<label>${label}</label><select multiple data-f='${path}' data-kind='${kind}'></select>`; }
  function rule(k, title, desc, extra) {
    var p = 'automod.' + k;
    return `<div class='rule'><div class='rule-h'><div><b>${title}</b><small>${desc}</small></div>${sw(p + '.on', 'On', 'sm')}</div><div class='rule-b'><div class='g2'>${pun(p)}</div>${extra || ''}</div></div>`;
  }

  function buildAutomod() {
    var ORD = ['1st', '2nd', '3rd', '4th'];
    var ladder = ORD.map(function (o, i) {
      var p = 'automod.escalation.s' + (i + 1);
      return `<div class='esc'><b>${o} violation</b><select data-f='${p}.action'><option value='warn'>Delete & warn</option><option value='timeout'>Mute member</option><option value='kick'>Kick member</option></select><input type='number' min='1' max='999' data-f='${p}.value' placeholder='10'><select data-f='${p}.unit'><option value='min'>Mins</option><option value='hour'>Hrs</option><option value='day'>Days</option></select></div>`;
    }).join('');
    var el = $('panel-automod');
    if (!el) return;
    el.innerHTML = `<h2>Auto Moderation</h2>
<p class='muted'>Master AutoMod protection. Administrator / Manage Messages wale members exempt hain. Message Content Intent chahiye. Changes ke liye upar Save dabao.</p>
<div class='sec-t'>General Setup</div><p class='sec-d'>Log channel aur bypass roles/channels.</p>
${sw('automod.enabled', 'AutoMod master switch')}
<label>Log channel</label><select data-f='automod.logChannelId' data-kind='text'></select>
${ms('automod.ignoredRoles', 'role', 'Ignored roles (Ctrl/Cmd + click for many)')}
${ms('automod.ignoredChannels', 'any', 'Ignored channels (Ctrl/Cmd + click for many)')}
<div class='sec-t'>Links & Media</div><p class='sec-d'>External URLs, Discord invites aur GIFs.</p>
${rule('invites', 'Anti Discord Invites', 'Stops other server invites (discord.gg, discord.com/invite).', ta('automod.invites.whitelist', 'Whitelisted server invites (one per line)', 'discord.gg/partner'))}
${rule('links', 'Anti Website Links', 'Blocks external website links (https://, www.).', ta('automod.links.whitelist', 'Allowed domains (one per line)', 'youtube.com'))}
${rule('gif', 'Anti GIF Filter', 'Stops GIF flooding from the picker, image hosts and uploads.', sw('automod.gif.tenor', 'Tenor & Giphy (Discord picker)') + sw('automod.gif.imgur', 'Imgur & web GIFs') + sw('automod.gif.direct', 'Direct .gif files') + ms('automod.gif.channels', 'text', 'Allowed GIF channels (Ctrl/Cmd + click for many)'))}
<div class='sec-t'>Chat Safety & Content</div><p class='sec-d'>Scams, mention raids, spam aur abusive words.</p>
${rule('scam', 'Anti Scam & Phishing Shield', 'Catches fake Nitro gifts, Steam scams and IP loggers.', '')}
${rule('mentions', 'Mass Mention Protection', 'Stops @everyone, @here or many pings in one message.', nm('automod.mentions.max', 'Max allowed mentions', 2, 30, '5'))}
${rule('spam', 'Anti Spam & Fast Flood', 'Removes rapid consecutive messages.', nm('automod.spam.max', 'Max messages in 5 seconds', 2, 20, '5'))}
${rule('words', 'Custom Banned Words', 'Blocks words or phrases. Use *word* for wildcards.', ta('automod.words.list', 'Banned words / phrases (one per line)', '*badword*'))}
${rule('zalgo', 'Zalgo & Glitch Text', 'Stops distorted unicode text and invisible zero-width characters.', '')}
${rule('caps', 'Mass Caps Filter', 'Stops long messages written in UPPERCASE.', nm('automod.caps.threshold', 'Caps threshold (% uppercase)', 30, 100, '70'))}
${rule('profanity', 'Profanity & Toxicity Filter', 'Built-in dictionaries. Add more words in Custom Banned Words.', sw('automod.profanity.severe', 'Severe profanity') + sw('automod.profanity.sexual', 'Sexual content') + sw('automod.profanity.hate', 'Toxic phrases (kys etc.)'))}
<div class='sec-t'>Repeat Violations</div><p class='sec-d'>Repeat offenders ko step-by-step stronger punishment.</p>
<div class='rule'><div class='rule-h'><div><b>Progressive Escalation Ladder</b><small>Jab on ho, ye ladder upar ke rules ki punishment ko override karti hai.</small></div>${sw('automod.escalation.on', 'On', 'sm')}</div><div class='rule-b'>${nm('automod.escalation.expireHours', 'Violations expire after (hours)', 1, 720, '24')}${ladder}</div></div>
<div class='btn-row'><button class='btn alt danger' data-act='automod.reset' data-collect='no'>Reset AutoMod</button></div>`;
  }

  function buildProfile() {
    var first = document.querySelector('.nav-item');
    if (!first) return;
    var a = document.createElement('a');
    a.href = '#profile'; a.className = 'nav-item'; a.setAttribute('data-panel', 'profile');
    a.innerHTML = "<span class='ico'>\ud83d\udc64</span> Bot Profile";
    first.parentNode.insertBefore(a, first.nextSibling);
    var p = document.createElement('section');
    p.className = 'panel'; p.id = 'panel-profile';
    p.innerHTML = `<h2>Custom Server Bot Profile</h2>
<p class='muted'>Is server ke liye bot ka avatar, banner, nickname aur bio badlo. Ye sirf isi server me dikhega.</p>
<div class='pv'><img class='av' id='pv-av' alt=''><img class='bn' id='pv-bn' alt=''></div>
<label>Bot banner URL</label><input type='text' data-a='bannerUrl' data-init='profile.bannerUrl' placeholder='https://example.com/banner.png'>
<label>Bot avatar URL</label><input type='text' data-a='avatarUrl' data-init='profile.avatarUrl' placeholder='https://example.com/avatar.png'>
<label>Server nickname</label><input type='text' maxlength='32' data-a='nick' data-init='profile.nick' placeholder='AxiomTAxis'>
<label>Bio</label><textarea rows='3' maxlength='190' data-a='bio' data-init='profile.bio' placeholder='The ultimate Discord bot with AI, moderation, triggers, counting and more.'></textarea>
<div class='btn-row'><button class='btn' data-act='profile.save'>Save profile</button><button class='btn alt danger' data-act='profile.reset' data-collect='no'>Reset</button></div>
<div class='note'>Discord har server me bot profile updates rate-limit karta hai (save ke baad lagbhag 24 ghante cooldown). Direct image URL (PNG, JPG, GIF) use karo. Avatar/banner tabhi dobara upload hota hai jab URL badle.</div>`;
    var content = document.querySelector('.content');
    if (content) content.appendChild(p);
    function pv() { var av = $('pv-av'), bn = $('pv-bn'); if (av) av.src = p.querySelector('[data-a=avatarUrl]').value || ''; if (bn) bn.src = p.querySelector('[data-a=bannerUrl]').value || ''; }
    p.addEventListener('input', pv);
    p.pv = pv;
  }

  try { buildAutomod(); } catch (e) { console.warn('buildAutomod', e); }
  try { buildProfile(); } catch (e) { console.warn('buildProfile', e); }

  var panels = qa('.panel');
  var navItems = qa('.nav-item');
  var topTitle = $('topTitle');

  function showPanel(id) {
    panels = qa('.panel');
    navItems = qa('.nav-item');
    panels.forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + id); });
    navItems.forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-panel') === id); });
    var item = document.querySelector('[data-panel="' + id + '"]');
    if (item && topTitle) topTitle.textContent = item.textContent.trim().replace(/^[^A-Za-z]+/, '') || id;
    var sb = $('sidebar'); if (sb) sb.classList.remove('open');
  }
  navItems.forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); showPanel(a.getAttribute('data-panel')); }); });
  if (location.hash && document.getElementById('panel-' + location.hash.slice(1))) showPanel(location.hash.slice(1));

  var menuBtn = $('menuBtn');
  if (menuBtn) menuBtn.onclick = function () { var sb = $('sidebar'); if (sb) sb.classList.toggle('open'); };
  var logoutBtn = $('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = leave;
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

  async function api(method, path, body) {
    if (!API) throw new Error('STATS_URL set nahi hai. Vercel env me STATS_URL = Railway bot URL daalo aur redeploy karo.');
    var r;
    try {
      r = await fetch(API + path, { method: method, headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    } catch (netErr) {
      throw new Error('Bot API (' + API + ') se connect nahi ho paya. STATS_URL sahi hai? Railway service chal rahi hai?');
    }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || ('API ' + r.status)); e.status = r.status; e.data = j; throw e; }
    return j;
  }

  async function loadGuilds() {
    var select = $('guildSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Loading servers...</option>';
    if (!token()) { select.innerHTML = '<option value="">Reconnect Discord</option>'; banner('Discord server list ke liye ek baar reconnect karo. <button class="btn" id="reconnectBtn">Reconnect Discord</button>'); return; }
    try {
      var r = await api('GET', '/api/me/guilds');
      var list = (r.guilds || []).filter(function (g) { return g.botIn; });
      select.innerHTML = '<option value="">Select server...</option>';
      list.forEach(function (g) { var o = document.createElement('option'); o.value = g.id; o.textContent = g.name || g.id; select.appendChild(o); });
      var inv = document.createElement('option'); inv.value = '__invite__'; inv.textContent = '+ Add bot to another server'; select.appendChild(inv);
      if (!list.length) banner('Bot abhi aapke kisi server me nahi hai. <a class="btn" href="' + inviteUrl('') + '" target="_blank" rel="noopener">Invite bot</a> <button class="btn alt" id="retryBtn">Refresh</button>');
      var saved = ''; try { saved = localStorage.getItem('axiom_guild') || ''; } catch (e) {}
      if (saved && list.some(function (g) { return g.id === saved; })) { select.value = saved; currentGuild = saved; loadGuild(saved); }
    } catch (e) {
      select.innerHTML = '<option value="">Failed to load servers</option>';
      if (e.status === 401) { clearToken(); banner('Discord session expire ho gaya. <button class="btn" id="reconnectBtn">Reconnect Discord</button>'); }
      else banner('Servers load nahi hue: <b>' + esc(e.message) + '</b> <button class="btn alt" id="retryBtn">Retry</button>');
    }
  }

  var provSel = $('ai-provider'), modelSel = $('ai-model');
  function fillModels() {
    if (!modelSel || !provSel) return;
    modelSel.innerHTML = '';
    (models[provSel.value] || []).forEach(function (m) { var o = document.createElement('option'); o.value = m; o.textContent = m; modelSel.appendChild(o); });
  }
  if (provSel && modelSel) {
    Object.keys(models).forEach(function (p) { var o = document.createElement('option'); o.value = p; o.textContent = p; provSel.appendChild(o); });
    provSel.onchange = fillModels;
    if (Object.keys(models).length) { provSel.value = Object.keys(models)[0]; fillModels(); }
  }

  var getp = function (obj, path) { return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj); };
  var chName = function (id) { if (!id || !data) return '-'; var c = (data.channels || []).find(function (x) { return x.id === id; }); return c ? '#' + c.name : id; };
  var roleName = function (id) { if (!id || !data) return '-'; var r = (data.roles || []).find(function (x) { return x.id === id; }); return r ? '@' + r.name : id; };

  function fillSelects() {
    if (!data) return;
    qa('select[data-kind]').forEach(function (sel) {
      var kind = sel.getAttribute('data-kind');
      var keep = sel.multiple ? qa('option', sel).filter(function (o) { return o.selected; }).map(function (o) { return o.value; }) : [sel.value];
      sel.innerHTML = '';
      if (!sel.multiple) { var none = document.createElement('option'); none.value = ''; none.textContent = '- none -'; sel.appendChild(none); }
      var list = kind === 'role' ? (data.roles || []) : (data.channels || []).filter(function (c) {
        if (kind === 'cat') return c.type === 4;
        if (kind === 'any') return c.type !== 4;
        return c.type === 0 || c.type === 5;
      });
      list.forEach(function (it) {
        var o = document.createElement('option'); o.value = it.id;
        var pre = kind === 'role' ? '@' : kind === 'cat' ? '' : (it.type === 2 || it.type === 13) ? '\ud83d\udd0a ' : it.type === 15 ? '\ud83d\udcac ' : '#';
        o.textContent = pre + it.name; sel.appendChild(o);
      });
      if (sel.multiple) qa('option', sel).forEach(function (o) { o.selected = keep.indexOf(o.value) >= 0; });
      else sel.value = keep[0] || '';
    });
  }

  function applyAll() {
    if (!data) return;
    qa('[data-f]').forEach(function (el) {
      var path = el.getAttribute('data-f');
      var v = getp(data.settings, path);
      if ((v === undefined || v === null) && DEF[path] !== undefined) v = DEF[path];
      if (el.multiple) { var arr = v || []; qa('option', el).forEach(function (o) { o.selected = arr.indexOf(o.value) >= 0; }); }
      else if (el.type === 'checkbox') el.checked = !!v;
      else if (el.getAttribute('data-list')) el.value = Array.isArray(v) ? v.join(NL) : (v || '');
      else el.value = v == null ? '' : v;
    });
    qa('[data-init]').forEach(function (el) {
      var v = getp(data.settings, el.getAttribute('data-init'));
      el.value = v == null ? '' : v;
    });
    if (provSel && data.settings && data.settings.ai) {
      if (data.settings.ai.provider) { provSel.value = data.settings.ai.provider; fillModels(); }
      if (data.settings.ai.model && modelSel) modelSel.value = data.settings.ai.model;
    }
  }

  function collect() {
    var patch = {};
    qa('[data-f]').forEach(function (el) {
      var path = el.getAttribute('data-f');
      var parts = path.split('.');
      var cur = patch;
      for (var i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]]) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      var key = parts[parts.length - 1];
      if (el.multiple) cur[key] = qa('option', el).filter(function (o) { return o.selected; }).map(function (o) { return o.value; });
      else if (el.type === 'checkbox') cur[key] = el.checked;
      else if (el.type === 'number') cur[key] = el.value === '' ? null : Number(el.value);
      else if (el.getAttribute('data-list')) cur[key] = el.value.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      else cur[key] = el.value;
    });
    if (patch.memes) patch.memes.locked = false;
    return patch;
  }

  var saveBtn = $('saveBtn');
  if (saveBtn) saveBtn.onclick = async function () {
    if (!currentGuild) return toast('Pehle server select karo', true);
    try {
      await api('PATCH', '/api/guilds/' + currentGuild + '/settings', collect());
      toast('Saved');
      loadGuild(currentGuild);
    } catch (e) { toast(e.message || 'Save failed', true); }
  };

  var guildSelect = $('guildSelect');
  if (guildSelect) guildSelect.onchange = function () {
    var v = guildSelect.value;
    if (v === '__invite__') { window.open(inviteUrl(''), '_blank'); guildSelect.value = currentGuild || ''; return; }
    if (!v) return;
    currentGuild = v;
    try { localStorage.setItem('axiom_guild', v); } catch (e) {}
    loadGuild(v);
  };

  async function loadGuild(id) {
    banner('');
    try {
      data = await api('GET', '/api/guilds/' + id);
      fillSelects();
      applyAll();
      renderLists();
    } catch (e) {
      toast(e.message || 'Load failed', true);
      if (e.status === 401) { clearToken(); banner('Discord session expire. <button class="btn" id="reconnectBtn">Reconnect</button>'); }
    }
  }

  function renderLists() {
    var cl = $('cmd-list');
    if (cl && data && data.settings && data.settings.commands) {
      var cmds = data.settings.commands || {};
      cl.innerHTML = Object.keys(cmds).map(function (n) {
        return '<div class="row"><b>/c ' + esc(n) + '</b> <span>' + esc(cmds[n]) + '</span> <button class="btn alt danger sm" data-act="command.del" data-name="' + esc(n) + '">Del</button></div>';
      }).join('') || '<p class="muted">No custom commands</p>';
    }
    var yl = $('yt-list');
    if (yl && data && data.settings && data.settings.yt) {
      var chs = data.settings.yt.channels || [];
      yl.innerHTML = chs.map(function (c, i) {
        return '<div class="row"><b>' + esc(c.name || c.id) + '</b> <button class="btn alt danger sm" data-act="yt.del" data-i="' + i + '">Del</button></div>';
      }).join('') || '<p class="muted">No YouTube channels</p>';
    }
  }

  document.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn || !currentGuild) return;
    var act = btn.getAttribute('data-act');
    try {
      if (act === 'command.add') {
        var name = document.querySelector('[data-a=name]');
        var reply = document.querySelector('[data-a=reply]');
        if (!name || !reply || !name.value.trim()) return toast('Name required', true);
        await api('POST', '/api/guilds/' + currentGuild + '/commands', { name: name.value.trim(), reply: reply.value });
        toast('Command saved'); loadGuild(currentGuild);
      } else if (act === 'command.del') {
        await api('DELETE', '/api/guilds/' + currentGuild + '/commands/' + encodeURIComponent(btn.getAttribute('data-name')));
        toast('Deleted'); loadGuild(currentGuild);
      } else if (act === 'yt.add') {
        var inp = document.querySelector('[data-a=input]');
        if (!inp || !inp.value.trim()) return toast('Channel required', true);
        await api('POST', '/api/guilds/' + currentGuild + '/yt', { input: inp.value.trim() });
        toast('Added'); loadGuild(currentGuild);
      } else if (act === 'yt.del') {
        await api('DELETE', '/api/guilds/' + currentGuild + '/yt/' + btn.getAttribute('data-i'));
        toast('Removed'); loadGuild(currentGuild);
      } else if (act === 'ticket.panel' || act === 'verification.panel') {
        var body = {};
        qa('[data-a]', btn.closest('.panel')).forEach(function (el) { body[el.getAttribute('data-a')] = el.value; });
        await api('POST', '/api/guilds/' + currentGuild + '/' + act.replace('.', '/'), body);
        toast('Panel posted');
      } else if (act === 'profile.save') {
        var body = {};
        qa('[data-a]', $('panel-profile')).forEach(function (el) { body[el.getAttribute('data-a')] = el.value; });
        await api('POST', '/api/guilds/' + currentGuild + '/profile', body);
        toast('Profile saved');
      } else if (act === 'profile.reset' || act === 'automod.reset') {
        await api('POST', '/api/guilds/' + currentGuild + '/' + act.replace('.', '/'), {});
        toast('Reset'); loadGuild(currentGuild);
      }
    } catch (err) { toast(err.message || 'Action failed', true); }
  });

  async function pollStats() {
    try {
      var s = await api('GET', '/api/stats');
      qa('[data-ov]').forEach(function (el) {
        var k = el.getAttribute('data-ov');
        if (k === 'servers') el.textContent = s.guilds != null ? s.guilds : '-';
        else if (k === 'ping') el.textContent = s.ping != null ? s.ping + 'ms' : '-';
        else if (k === 'uptime') el.textContent = s.uptime || '-';
        else if (k === 'mode') el.textContent = s.mode || '-';
      });
    } catch (e) {}
  }

  supabase.auth.getSession().then(function (r) {
    session = r.data.session;
    if (!session) { window.location.replace('/login.html'); return; }
    keepToken(session);
    showUser(session.user);
    loadGuilds();
    pollStats();
    setInterval(pollStats, 30000);
  });
})();
