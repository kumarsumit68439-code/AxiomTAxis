(function () {
  var cfg = window.AXIOM_CONFIG || {};
  var models = window.AXIOM_MODELS || {};
  var settingsKey = 'axiom_dashboard_settings';
  var currentGuild = '';

  var panels = document.querySelectorAll('.panel');
  var navItems = document.querySelectorAll('.nav-item');
  var topTitle = document.getElementById('topTitle');

  function showPanel(id) {
    panels.forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + id); });
    navItems.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-panel') === id);
    });
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

  document.getElementById('menuBtn').onclick = function () {
    document.getElementById('sidebar').classList.toggle('open');
  };

  var provSel = document.getElementById('ai-provider');
  var modelSel = document.getElementById('ai-model');
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
  if (Object.keys(models).length) {
    provSel.value = Object.keys(models)[0];
    fillModels();
  }

  function loadDraft(gid) {
    try {
      var all = JSON.parse(localStorage.getItem(settingsKey) || '{}');
      return all[gid] || {};
    } catch { return {}; }
  }
  function saveDraft(gid, data) {
    try {
      var all = JSON.parse(localStorage.getItem(settingsKey) || '{}');
      all[gid] = data;
      localStorage.setItem(settingsKey, JSON.stringify(all));
    } catch (e) { console.error(e); }
  }

  function applyToForm(d) {
    if (d.ai) {
      if (d.ai.provider && models[d.ai.provider]) {
        provSel.value = d.ai.provider;
        fillModels();
      }
      if (d.ai.model) modelSel.value = d.ai.model;
      if (d.ai.system) document.getElementById('ai-prompt').value = d.ai.system;
    }
    if (d.welcome && d.welcome.message) document.getElementById('welcome-msg').value = d.welcome.message;
    if (d.leave && d.leave.message) document.getElementById('leave-msg').value = d.leave.message;
  }

  function collectFromForm() {
    return {
      ai: {
        provider: provSel.value,
        model: modelSel.value,
        system: document.getElementById('ai-prompt').value.trim() || undefined
      },
      welcome: { message: document.getElementById('welcome-msg').value.trim() || undefined },
      leave: { message: document.getElementById('leave-msg').value.trim() || undefined }
    };
  }

  var guildSelect = document.getElementById('guildSelect');
  var custom = document.createElement('option');
  custom.value = '__custom__';
  custom.textContent = 'Enter guild ID…';
  guildSelect.appendChild(custom);

  guildSelect.onchange = function () {
    if (guildSelect.value === '__custom__') {
      var id = prompt('Discord Server (Guild) ID:');
      if (!id) { guildSelect.value = currentGuild || ''; return; }
      var opt = document.createElement('option');
      opt.value = id.trim();
      opt.textContent = 'Guild ' + id.trim();
      guildSelect.insertBefore(opt, custom);
      guildSelect.value = id.trim();
    }
    currentGuild = guildSelect.value;
    if (currentGuild) applyToForm(loadDraft(currentGuild));
  };

  document.getElementById('saveBtn').onclick = function () {
    if (!currentGuild) {
      alert('Pehle server select / guild ID enter karo.\n\nLive bot write ke liye Discord OAuth + API function next step hai. Abhi draft local save hota hai.');
      return;
    }
    saveDraft(currentGuild, collectFromForm());
    alert('Draft saved for guild ' + currentGuild + '.\n\nBot Supabase/Railway se settings padhta hai — website se live save ke liye OAuth connect karna hoga.');
  };

  function set(sel, v) {
    document.querySelectorAll(sel).forEach(function (el) { el.textContent = v; });
  }
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
        var s = d.uptime || 0;
        var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        var up = h ? h + 'h ' + m + 'm' : m + 'm';
        set('[data-ov="uptime"]', up);
        set('[data-ov="uptime2"]', up);
      })
      .catch(function () {});
  }
  pollStats();
  setInterval(pollStats, 30000);
})();
