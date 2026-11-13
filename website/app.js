(function () {
  var cfg = window.AXIOM_CONFIG || {};
  var id = (cfg.CLIENT_ID || '').trim();
  var PERMS = '3230720'; // View Channels, Send Messages, Embed Links, Read History, Connect, Speak
  var invite = id ? 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(id) + '&permissions=' + PERMS + '&scope=bot%20applications.commands' : '#';
  var qa = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  qa('a[data-invite]').forEach(function (a) {
    a.href = invite;
    if (!id) a.addEventListener('click', function (e) { e.preventDefault(); alert('Set DISCORD_CLIENT_ID in Netlify environment variables and redeploy.'); });
  });

  var support = (cfg.SUPPORT_URL || '').trim();
  if (support) qa('.support-link').forEach(function (el) { el.hidden = false; if (el.tagName === 'A' && el.classList.contains('btn')) el.href = support; else if (el.tagName === 'A' && !el.classList.contains('btn')) el.href = support; el.setAttribute('target', '_blank'); });

  var burger = document.getElementById('burger'), links = document.getElementById('links');
  burger.onclick = function () { links.classList.toggle('open'); };
  qa('#links a').forEach(function (a) { a.addEventListener('click', function () { links.classList.remove('open'); }); });

  var models = window.AXIOM_MODELS || {}, box = document.getElementById('providers');
  Object.keys(models).forEach(function (p) {
    var s = document.createElement('span'); s.textContent = p + ' (' + models[p].length + ')'; box.appendChild(s);
  });

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: .12 });
    qa('.reveal').forEach(function (el) { io.observe(el); });
  } else qa('.reveal').forEach(function (el) { el.classList.add('in'); });

  function fmtUp(s) {
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm';
  }
  function set(sel, v) { qa(sel).forEach(function (el) { el.textContent = v; }); }
  function state(sel, text, cls) { qa(sel).forEach(function (el) { el.textContent = text; el.className = cls || ''; }); }
  function pill(text, cls) { set('[data-pill]', text); qa('[data-dot]').forEach(function (d) { d.className = 'dot ' + (cls || ''); }); }

  function render(d) {
    if (d.online) {
      pill('Online', 'on');
      set('[data-stat="servers"]', d.servers.toLocaleString());
      set('[data-stat="users"]', d.users.toLocaleString());
      set('[data-stat="ping"]', d.ping + 'ms');
      set('[data-stat="uptime"]', fmtUp(d.uptime));
      state('[data-s="gateway"]', 'Operational', 'ok');
      state('[data-s="api"]', 'Operational', 'ok');
      state('[data-s="mode"]', d.mode === 'full' ? 'Full (AI chat and welcome on)' : 'Basic (privileged intents off)', '');
      set('[data-s="servers"]', String(d.servers));
      set('[data-s="ping"]', d.ping + 'ms');
      set('[data-s="uptime"]', fmtUp(d.uptime));
      if (d.avatar) qa('img[data-avatar]').forEach(function (img) { img.src = d.avatar; img.hidden = false; if (img.nextElementSibling) img.nextElementSibling.hidden = true; });
    } else {
      pill('Starting', '');
      state('[data-s="gateway"]', 'Connecting', '');
      state('[data-s="api"]', 'Operational', 'ok');
    }
  }
  function fail() {
    pill(cfg.STATS_URL ? 'Offline' : 'Stats not connected', cfg.STATS_URL ? 'off' : '');
    state('[data-s="gateway"]', cfg.STATS_URL ? 'Unreachable' : 'Not connected', cfg.STATS_URL ? 'bad' : '');
    state('[data-s="api"]', cfg.STATS_URL ? 'Unreachable' : 'Not configured', cfg.STATS_URL ? 'bad' : '');
  }
  function poll() {
    if (!cfg.STATS_URL) return fail();
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, 7000);
    fetch(cfg.STATS_URL + '/stats', { signal: c.signal, cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(render).catch(fail).finally(function () { clearTimeout(t); });
  }
  poll(); setInterval(poll, 30000);
})();
