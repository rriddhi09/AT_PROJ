import { User } from '../models/User.js';
import { verifyAccessToken } from '../utils/tokens.js';

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ message: 'Authentication required.' });
    const payload = verifyAccessToken(header.slice(7));
    const user = await User.findOne({ _id: payload.sub, deletedAt: null });
    if (!user) return res.status(401).json({ message: 'Account is unavailable.' });
    req.user = user;
    next();
  } catch { return res.status(401).json({ message: 'Invalid or expired access token.' }); }
}
