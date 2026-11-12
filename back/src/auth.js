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
    issue(res, req, userId) {
      const token = jwt.sign({ sub: userId }, secret, { algorithm: 'HS256', expiresIn: MAX_AGE_S });
      res.cookie(COOKIE, token, {
        httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE_S * 1000, path: '/',
      });
    },
    clear(res) {
      res.clearCookie(COOKIE, { path: '/' });
    },
    /** Id del usuario de la cookie, o null. */
    read(req) {
      const token = req.cookies?.[COOKIE];
      if (!token) return null;
      try {
        return jwt.verify(token, secret, { algorithms: ['HS256'] }).sub ?? null;
      } catch {
        return null;
      }
    },
  };
}
