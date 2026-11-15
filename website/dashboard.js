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
  var esc = function (t) { return String(t).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;'); };

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

  // ---------- styles for the new panels ----------
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

  // ---------- defaults shown in the UI ----------
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

  // ---------- small HTML builders ----------
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
      return `<div class='esc'><b>${o} violation</b><select data-f='${p}.action'><option value='warn'>Delete &amp; warn</option><option value='timeout'>Mute member</option><option value='kick'>Kick member</option></select><input type='number' min='1' max='999' data-f='${p}.value' placeholder='10'><select data-f='${p}.unit'><option value='min'>Mins</option><option value='hour'>Hrs</option><option value='day'>Days</option></select></div>`;
    }).join('');
    $('panel-automod').innerHTML = `<h2>Auto Moderation</h2>
<p class='muted'>Master AutoMod protection. Administrator / Manage Messages wale members exempt hain. Message Content Intent chahiye. Changes ke liye upar Save dabao.</p>
<div class='sec-t'>General Setup</div><p class='sec-d'>Log channel aur bypass roles/channels.</p>
${sw('automod.enabled', 'AutoMod master switch')}
<label>Log channel</label><select data-f='automod.logChannelId' data-kind='text'></select>
${ms('automod.ignoredRoles', 'role', 'Ignored roles (Ctrl/Cmd + click for many)')}
${ms('automod.ignoredChannels', 'any', 'Ignored channels (Ctrl/Cmd + click for many)')}
<div class='sec-t'>Links &amp; Media</div><p class='sec-d'>External URLs, Discord invites aur GIFs.</p>
${rule('invites', 'Anti Discord Invites', 'Stops other server invites (discord.gg, discord.com/invite).', ta('automod.invites.whitelist', 'Whitelisted server invites (one per line)', 'discord.gg/partner'))}
${rule('links', 'Anti Website Links', 'Blocks external website links (https://, www.).', ta('automod.links.whitelist', 'Allowed domains (one per line)', 'youtube.com'))}
${rule('gif', 'Anti GIF Filter', 'Stops GIF flooding from the picker, image hosts and uploads.', sw('automod.gif.tenor', 'Tenor &amp; Giphy (Discord picker)') + sw('automod.gif.imgur', 'Imgur &amp; web GIFs') + sw('automod.gif.direct', 'Direct .gif files') + ms('automod.gif.channels', 'text', 'Allowed GIF channels (Ctrl/Cmd + click for many)'))}
<div class='sec-t'>Chat Safety &amp; Content</div><p class='sec-d'>Scams, mention raids, spam aur abusive words.</p>
${rule('scam', 'Anti Scam &amp; Phishing Shield', 'Catches fake Nitro gifts, Steam scams and IP loggers.', '')}
${rule('mentions', 'Mass Mention Protection', 'Stops @everyone, @here or many pings in one message.', nm('automod.mentions.max', 'Max allowed mentions', 2, 30, '5'))}
${rule('spam', 'Anti Spam &amp; Fast Flood', 'Removes rapid consecutive messages.', nm('automod.spam.max', 'Max messages in 5 seconds', 2, 20, '5'))}
${rule('words', 'Custom Banned Words', 'Blocks words or phrases. Use *word* for wildcards.', ta('automod.words.list', 'Banned words / phrases (one per line)', '*badword*'))}
${rule('zalgo', 'Zalgo &amp; Glitch Text', 'Stops distorted unicode text and invisible zero-width characters.', '')}
${rule('caps', 'Mass Caps Filter', 'Stops long messages written in UPPERCASE.', nm('automod.caps.threshold', 'Caps threshold (% uppercase)', 30, 100, '70'))}
${rule('profanity', 'Profanity &amp; Toxicity Filter', 'Built-in dictionaries. Add more words in Custom Banned Words.', sw('automod.profanity.severe', 'Severe profanity') + sw('automod.profanity.sexual', 'Sexual content') + sw('automod.profanity.hate', 'Toxic phrases (kys etc.)'))}
<div class='sec-t'>Repeat Violations</div><p class='sec-d'>Repeat offenders ko step-by-step stronger punishment.</p>
<div class='rule'><div class='rule-h'><div><b>Progressive Escalation Ladder</b><small>Jab on ho, ye ladder upar ke rules ki punishment ko override karti hai.</small></div>${sw('automod.escalation.on', 'On', 'sm')}</div><div class='rule-b'>${nm('automod.escalation.expireHours', 'Violations expire after (hours)', 1, 720, '24')}${ladder}</div></div>
<div class='btn-row'><button class='btn alt danger' data-act='automod.reset' data-collect='no'>Reset AutoMod</button></div>`;
  }

  function buildProfile() {
    var first = document.querySelector('.nav-item');
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
    document.querySelector('.content').appendChild(p);
    function pv() { $('pv-av').src = p.querySelector('[data-a=avatarUrl]').value || ''; $('pv-bn').src = p.querySelector('[data-a=bannerUrl]').value || ''; }
    p.addEventListener('input', pv);
    p.pv = pv;
  }

  buildAutomod();
  buildProfile();

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
  navItems.forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); showPanel(a.getAttribute('data-panel')); }); });
  if (location.hash && document.getElementById('panel-' + location.hash.slice(1))) showPanel(location.hash.slice(1));

  $('menuBtn').onclick = function () { $('sidebar').classList.toggle('open'); };
  $('logoutBtn').onclick = leave;
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
    modelSel.innerHTML = '';
    (models[provSel.value] || []).forEach(function (m) { var o = document.createElement('option'); o.value = m; o.textContent = m; modelSel.appendChild(o); });
  }
  Object.keys(models).forEach(function (p) { var o = document.createElement('option'); o.value = p; o.textContent = p; provSel.appendChild(o); });
  provSel.onchange = fillModels;
  if (Object.keys(models).length) { provSel.value = Object.keys(models)[0]; fillModels(); }

  var getp = function (obj, path) { return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj); };
  var chName = function (id) { if (!id) return '-'; var c = (data.channels || []).find(function (x) { return x.id === id; }); return c ? '#' + c.name : id; };
  var roleName = function (id) { if (!id) return '-'; var r = (data.roles || []).find(function (x) { return x.id === id; }); return r ? '@' + r.name : id; };

  function fillSelects() {
    qa('select[data-kind]').forEach(function (sel) {
      var kind = sel.getAttribute('data-kind');
      var keep = sel.multiple ? qa('option', sel).filter(function (o) { return o.selected; }).map(function (o) { return o.value; }) : [sel.value];
      sel.innerHTML = '';
      if (!sel.multiple) { var none = document.createElement('option'); none.value = ''; none.textContent = '- none -'; sel.appendChild(none); }
      var list = kind === 'role' ? data.roles : data.channels.filter(function (c) {
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
    qa('[data-f]').forEach(function (el) {
      var path = el.getAttribute('data-f');
      var v = getp(data.settings, path);
      if ((v === undefined || v === null) && DEF[path] !== undefined) v = DEF[path];
      if (el.multiple) { var arr = v || []; qa('option', el).forEach(function (o) { o.selected = arr.indexOf(o.value) >= 0; }); return; }
      if (el.type === 'checkbox') { el.checked = !!v; return; }
      if (el.hasAttribute('data-list')) { el.value = (v || []).join(NL); return; }
      if (v === undefined || v === null) { if (el.id === 'ai-provider' || el.id === 'ai-model') return; v = ''; }
      el.value = v;
      if (el.id === 'ai-provider') fillModels();
    });
  }

  function renderLists() {
    var s = data.settings;
    qa('[data-init]').forEach(function (el) { var v = getp(s, el.getAttribute('data-init')); el.value = v == null ? '' : v; });
    var pp = $('panel-profile'); if (pp && pp.pv) pp.pv();
    $('counting-status').innerHTML = 'Channel: <b>' + esc(chName(s.counting.channelId)) + '</b> &middot; Current count: <b>' + (s.counting.count || 0) + '</b>';
    $('level-status').innerHTML = 'Levels: <b>' + (s.levels.enabled ? 'On' : 'Off') + '</b> &middot; Members with XP: <b>' + (s.levels.members || 0) + '</b>';
    var t = s.ticket || {};
    $('ticket-status').innerHTML = t.enabled ? 'Status: <b>ON</b> &middot; Panel: <b>' + esc(chName(t.panelChannelId)) + '</b> &middot; Category: <b>' + esc(chName(t.categoryId)) + '</b> &middot; Support role: <b>' + esc(roleName(t.supportRoleId)) + '</b>' : 'Status: <b>OFF</b>';
    var v = s.verification || {};
    $('verification-status').innerHTML = v.roleId ? 'Status: <b>ON</b> &middot; Panel: <b>' + esc(chName(v.channelId)) + '</b> &middot; Role: <b>' + esc(roleName(v.roleId)) + '</b>' : 'Status: <b>OFF</b>';

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
    banner('Server data load ho raha hai...');
    try { localStorage.setItem('axiom_guild', gid); } catch (e) {}
    try {
      data = await api('GET', '/api/guilds/' + gid);
      fillSelects(); applyAll(); renderLists();
      banner('');
    } catch (e) {
      data = null;
      if (e.data && e.data.botMissing) banner('Bot is server me nahi hai. <a class="btn" href="' + inviteUrl(gid) + '" target="_blank" rel="noopener">Invite bot here</a> <button class="btn alt" id="retryBtn">Retry</button>');
      else if (e.status === 401) { clearToken(); banner('Discord session expire ho gaya. <button class="btn" id="reconnectBtn">Reconnect Discord</button>'); }
      else banner('Server data load nahi hua: <b>' + esc(e.message) + '</b> <button class="btn alt" id="retryBtn">Retry</button>');
    }
  }

  $('guildSelect').onchange = function () {
    var v = $('guildSelect').value;
    if (v === '__invite__') { window.open(inviteUrl(''), '_blank'); $('guildSelect').value = currentGuild; return; }
    currentGuild = v;
    if (currentGuild) loadGuild(currentGuild); else { data = null; banner(''); }
  };

  function ready() {
    if (!currentGuild) { toast('Pehle server select karo.', true); return false; }
    if (!data) { toast('Server data abhi load nahi hua. Upar ka error dekho aur Retry dabao.', true); return false; }
    return true;
  }

  function setp(obj, path, val) {
    var p = path.split('.'), o = obj;
    for (var i = 0; i < p.length - 1; i++) { o[p[i]] = o[p[i]] || {}; o = o[p[i]]; }
    o[p[p.length - 1]] = val;
  }

  function collect() {
    var patch = {};
    qa('[data-f]').forEach(function (el) {
      var v;
      if (el.multiple) v = qa('option', el).filter(function (o) { return o.selected; }).map(function (o) { return o.value; });
      else if (el.type === 'checkbox') v = el.checked;
      else if (el.hasAttribute('data-list')) v = el.value.split(NL).join(',').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      else if (el.type === 'number') v = el.value === '' ? '' : Number(el.value);
      else v = el.value;
      setp(patch, el.getAttribute('data-f'), v);
    });
    return patch;
  }

  $('saveBtn').onclick = async function () {
    if (!ready()) return;
    var b = $('saveBtn'); b.disabled = true;
    try { await api('PUT', '/api/guilds/' + currentGuild + '/settings', { patch: collect() }); toast('Saved.'); await loadGuild(currentGuild); }
    catch (e) { toast(e.message, true); }
    b.disabled = false;
  };

  document.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    if (!ready()) return;
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
