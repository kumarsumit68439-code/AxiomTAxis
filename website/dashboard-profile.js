(function () {
  // Extra features: sidebar Exit button + direct avatar/banner upload on the Bot Profile page.
  var exitBtn = document.getElementById('exitBtn');
  if (exitBtn) {
    exitBtn.onclick = function () {
      var lo = document.getElementById('logoutBtn');
      if (lo) lo.click(); else window.location.replace('/login.html');
    };
  }

  var p = document.getElementById('panel-profile');
  if (!p || typeof p.pv !== 'function') return;

  var MAX = 8 * 1024 * 1024;
  var TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  var KEYS = ['bannerUrl', 'avatarUrl'];
  var pend = {};
  var rows = {};
  var origPv = p.pv;

  var st = document.createElement('style');
  st.textContent = '.up-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0 0}' +
    '.up-name{color:var(--mut);font-size:12.5px;word-break:break-all}' +
    '.up-name.bad{color:#ef4444}';
  document.head.appendChild(st);

  function urlField(key) { return p.querySelector("input[type=text][data-a='" + key + "']"); }
  function hiddenField(key) { return p.querySelector("input[type=hidden][data-a='" + key + "']"); }

  function drop(key) {
    delete pend[key];
    var h = hiddenField(key); if (h) h.remove();
    var r = rows[key];
    if (r) { r.file.value = ''; r.name.textContent = ''; r.name.className = 'up-name'; r.clear.hidden = true; }
  }

  function clearOne(key) { drop(key); origPv(); }

  function setError(key, msg) {
    var r = rows[key];
    r.name.textContent = msg; r.name.className = 'up-name bad'; r.file.value = '';
  }

  function onFile(key, file) {
    if (!file) return;
    if (TYPES.indexOf(file.type) < 0) { setError(key, 'Sirf PNG, JPG, GIF ya WEBP image chuno.'); return; }
    if (file.size > MAX) { setError(key, 'Image 8MB se badi hai.'); return; }
    var fr = new FileReader();
    fr.onerror = function () { setError(key, 'File read nahi hui, dobara try karo.'); };
    fr.onload = function () {
      var data = String(fr.result || '');
      pend[key] = data;
      var h = hiddenField(key);
      if (!h) { h = document.createElement('input'); h.type = 'hidden'; h.setAttribute('data-a', key); p.appendChild(h); }
      h.value = data;
      var r = rows[key];
      r.name.textContent = 'Upload ready: ' + file.name + ' (Save profile dabao)';
      r.name.className = 'up-name';
      r.clear.hidden = false;
      var img = document.getElementById(key === 'avatarUrl' ? 'pv-av' : 'pv-bn');
      if (img) img.src = data;
    };
    fr.readAsDataURL(file);
  }

  KEYS.forEach(function (key) {
    var field = urlField(key);
    if (!field) return;
    var row = document.createElement('div');
    row.className = 'up-row';
    var pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'btn-ghost';
    pick.textContent = '\u2b06 ' + (key === 'avatarUrl' ? 'Avatar' : 'Banner') + ' device se upload karo';
    var file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/png,image/jpeg,image/gif,image/webp'; file.hidden = true;
    var name = document.createElement('span'); name.className = 'up-name';
    var clear = document.createElement('button');
    clear.type = 'button'; clear.className = 'btn-ghost'; clear.textContent = '\u2715'; clear.hidden = true;
    pick.onclick = function () { file.click(); };
    file.onchange = function () { onFile(key, file.files && file.files[0]); };
    clear.onclick = function () { clearOne(key); };
    row.appendChild(pick); row.appendChild(file); row.appendChild(name); row.appendChild(clear);
    field.insertAdjacentElement('afterend', row);
    rows[key] = { file: file, name: name, clear: clear };
  });

  // Typing a URL cancels a pending upload for that field.
  p.addEventListener('input', function (e) {
    var t = e.target;
    var k = t && t.getAttribute && t.getAttribute('data-a');
    if (k && pend[k] && t.type === 'text') clearOne(k);
  });

  // Dashboard reloads server data after save / reset / server switch: drop any pending uploads then.
  p.pv = function () { KEYS.forEach(drop); origPv(); };

  var hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Upload ya URL, dono me se koi ek use karo. Upload max 8MB (PNG, JPG, GIF, WEBP).';
  var note = p.querySelector('.note');
  if (note) note.insertAdjacentElement('beforebegin', hint);
})();
