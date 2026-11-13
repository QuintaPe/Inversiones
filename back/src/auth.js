// Inicio de sesión con Google: el front obtiene un ID token con Google Identity
// Services, aquí se verifica y se cambia por una cookie de sesión propia (JWT).
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';

export const COOKIE = 'session';
const MAX_AGE_S = 30 * 24 * 3600;

export class AuthError extends Error {}

/** Devuelve una función que valida el ID token de Google y extrae el perfil. */
export function googleVerifier(clientId) {
  const client = new OAuth2Client(clientId);
  return async (credential) => {
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new AuthError('El token de Google no es válido o ha caducado.');
    }
    if (!payload?.sub || !payload.email || payload.email_verified === false) {
      throw new AuthError('La cuenta de Google no tiene un correo verificado.');
    }
    return { id: payload.sub, email: payload.email, name: payload.name, picture: payload.picture };
  };
}

export function sessions(secret) {
  return {
    /** v: versión de sesión del usuario (users.session_v) con la que se emite. */
    issue(res, req, userId, v = 0) {
      const token = jwt.sign({ sub: userId, v }, secret, { algorithm: 'HS256', expiresIn: MAX_AGE_S });
      res.cookie(COOKIE, token, {
        httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE_S * 1000, path: '/',
      });
    },
    clear(res) {
      res.clearCookie(COOKIE, { path: '/' });
    },
    /** { id, v } de la cookie, o null. Las cookies anteriores a las versiones cuentan como v = 0. */
    read(req) {
      const token = req.cookies?.[COOKIE];
      if (!token) return null;
      try {
        const p = jwt.verify(token, secret, { algorithms: ['HS256'] });
        return p.sub ? { id: p.sub, v: p.v ?? 0 } : null;
      } catch {
        return null;
      }
    },
    /**
     * Usuario de la sesión (sin datos internos), o null si no hay cookie válida, la cuenta ya
     * no existe o la sesión se cerró desde otro dispositivo.
     */
    async user(req, db) {
      const s = this.read(req);
      const u = s && (await db.getUser(s.id));
      if (!u || (u.session_v ?? 0) !== s.v) return null;
      const { session_v: _v, ...profile } = u;
      return profile;
    },
  };
}
