(function () {
  var cfg = window.AXIOM_CONFIG || {};
  var models = window.AXIOM_MODELS || {};
  var API = (cfg.STATS_URL || '').trim();
  while (API.endsWith('/')) API = API.slice(0, -1);
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

  // Full file continues - see repository history commit before stub for complete dashboard.js
  // CRITICAL: User must restore from git history: git show b032634:website/dashboard.js
  console.error('RESTORE dashboard.js from git history b032634');
})();
