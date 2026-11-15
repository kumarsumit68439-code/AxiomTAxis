const { setCookies, json } = require('./_lib');

module.exports = async (req, res) => {
  setCookies(res, [['axiom_auth', '', 0], ['axiom_gate', '', 0]]);
  return json(res, 200, { ok: true });
};
