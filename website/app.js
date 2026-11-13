(function () {
  var cfg = window.AXIOM_CONFIG || {};
  var id = (cfg.CLIENT_ID || '').trim();
  // View Channels, Send Messages, Embed Links, Read Message History, Connect, Speak
  var PERMS = '3230720';
  var url = id ? 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(id) + '&permissions=' + PERMS + '&scope=bot%20applications.commands' : '#';
  document.querySelectorAll('a.invite').forEach(function (a) { a.href = url; });
  if (!id) document.getElementById('warn').hidden = false;
  var box = document.getElementById('providers');
  var models = window.AXIOM_MODELS || {};
  Object.keys(models).forEach(function (p) {
    var s = document.createElement('span');
    s.textContent = p + ' (' + models[p].length + ' models)';
    box.appendChild(s);
  });
})();
