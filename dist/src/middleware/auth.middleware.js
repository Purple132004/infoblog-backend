import { HTTPException } from "hono/http-exception";
import jwt, {} from "jsonwebtoken";
import db from "../db/index.js";
export function authMiddleware() {
    return async (c, next) => {
        let bearerToken = c.req.header('Authorization');
        bearerToken = bearerToken?.replace('Bearer ', '');
        if (!bearerToken) {
            throw new HTTPException(401, { message: 'Token mancante o non valido' });
        }
        try {
            const payload = jwt.verify(bearerToken, process.env.JWT_SECRET);
            const user = await db.query.user.findFirst({
                where: { email: payload.email }
            });
            if (!user) {
                throw new Error();
            }
            c.set('authUser', user);
            await next();
        }
        catch (error) {
            throw new HTTPException(401, { message: 'Token mancante o non valido' });
        }
    };
}
