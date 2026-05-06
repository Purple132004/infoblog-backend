import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
export function roleMiddleware(role) {
    return createMiddleware(async (c, next) => {
        const authUser = c.get('authUser');
        if (!authUser) {
            console.error('authMiddleware mancante');
        }
        if (authUser.role !== role) {
            throw new HTTPException(401, { message: 'Accesso non autorizzato' });
        }
        await next();
    });
}
