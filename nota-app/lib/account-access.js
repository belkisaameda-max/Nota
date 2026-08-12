'use strict';
const { ApiError } = require('./errors');
function activeAccount(db, { allowRestricted = false } = {}) {
  return (req, _res, next) => {
    const row = db.prepare('SELECT account_status FROM users WHERE id=?').get(Number(req.user.sub));
    const status = row?.account_status || 'active';
    if (status === 'closed' || status === 'suspended' || (!allowRestricted && status === 'restricted')) return next(new ApiError(403, 'ACCOUNT_RESTRICTED', 'This account cannot perform this action.'));
    req.accountStatus = status;
    next();
  };
}
module.exports = { activeAccount };
