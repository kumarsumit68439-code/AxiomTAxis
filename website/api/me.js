const { verify, cookies, json } = require('./_lib');

module.exports = async (req, res) => {
  const ok = !!verify(cookies(req).axiom_auth, 'auth');
  return json(res, ok ? 200 : 401, { ok });
};
