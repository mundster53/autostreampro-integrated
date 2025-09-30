// functions/token-refresher.js
// Minimal stub so Netlify can bundle. Replace with real logic later.
class TokenRefresher {
  constructor(opts = {}) {
    this.opts = opts;
  }
  // common shapes clip-related code might call; all no-ops:
  async getValidToken({ platform, userId, token } = {}) {
    return token || null;
  }
  async refreshIfNeeded({ platform, userId, token } = {}) {
    return token || null;
  }
  async ensure({ platform, userId } = {}) {
    return null;
  }
}
module.exports = TokenRefresher;
