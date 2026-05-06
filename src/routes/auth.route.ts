import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z, { email } from "zod";
import db from "../db/index.js";
import { HTTPException } from "hono/http-exception";
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { generateJwt, generateRandomCode, omit } from "../lib/utils.js";
import { createInsertSchema } from "drizzle-orm/zod";
import { user } from "../db/schema.js";
import { userOmits } from "../lib/omits.js";
import { eq } from "drizzle-orm";
import { emailSend } from "../lib/email.js";

const authRoute = new Hono().basePath('auth');

const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
});
authRoute.post('/login', zValidator('json', loginSchema), async c => {
    const { email, password } = c.req.valid('json');

    const user = await db.query.user.findFirst({
        where: { email },
        // columns: { password: false }
    });
    if (!user) {
        throw new HTTPException(401, { message: 'Email o password non validi!' })
    }

    if (!user.emailVerifiedAt) {
        throw new HTTPException(401, { message: 'Devi verificare la mail',cause:"EMAIL_NOT_VERIFIED", });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        throw new HTTPException(401, { message: 'Email o password non validi!' })
    }

    const token = generateJwt(user.email);

    /* const token = jwt.sign(
        { email: user.email },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '1d' }
    ) */

    // const { password: psw, ...userNoPsw } = user;
    return c.json({
        token,
        user: userOmits(user),
    })
})


const registerSchema = createInsertSchema(user, {
    email: z.email(),
    password: z.string()
        .min(8)
        .regex(/[a-z]/g, { error: 'Devi inserire almeno una minuscola' })
        .regex(/[A-Z]/g, { error: 'Devi inserire almeno una Maiuscola' })
        .regex(/[0-9]/g, { error: 'Devi inserire almeno un numero' })
        .regex(/[!$&=?]/g, { error: 'Devi inserire almeno un simbolo tra !$&=?' })
        .transform(value => bcrypt.hashSync(value, 10))
}).extend({
    passwordConfirmation: z.string().min(1),
}).superRefine((data, ctx) => {
    if (!bcrypt.compareSync(data.passwordConfirmation, data.password)) {
        ctx.addIssue({
            key: 'passwordConfirmation',
            code: 'custom',
            path: ['password', 'passwordConfirmation'],
            message: 'Le 2 password non corrispondono!'
        })
    }
});
authRoute.post('/register', zValidator('json', registerSchema), async c => {
    const data = c.req.valid('json');

    const code = generateRandomCode();
    // mando il codice per email
    emailSend({
        email: data.email,
        subject: 'completa la registrazione',
        text:`inserisci il codice verifica ${code}`,
    })
    console.log(code);

    const queryResult = await db.insert(user).values({
        ...data,
        emailVerificationCode: bcrypt.hashSync(code, 10),
        emailCodeAt: new Date(),
    }).returning();

    return c.json({
        message: 'Utente registrato',
        user: userOmits(queryResult[0]),
    })
});

const emailVerifySchema = z.object({
    email: z.email(),
    code: z.string().min(1),
});
authRoute.post('/email-verify', zValidator('json', emailVerifySchema), async c => {
    const { email, code } = c.req.valid('json');

    const userDb = await db.query.user.findFirst({
        where: { email }
    });

    if (!userDb || (userDb.emailVerificationCode && !bcrypt.compareSync(code, userDb.emailVerificationCode))) {
        throw new HTTPException(400, { message: 'Verifica della mail non valida!' })
    }

    if (userDb.emailVerifiedAt){
        throw new HTTPException(400, { message: 'email già verificata'});
    }

    if (!userDb.emailCodeAt) {
        throw new HTTPException(400, { message: 'Codice scaduto' });
    }
    const createdAt = userDb.emailCodeAt.valueOf();
    const now = new Date().valueOf();
    const diff = Math.floor((now - createdAt) / 1000 / 60)
    if (diff > 10) {
        throw new HTTPException(400, { message: 'Codice scaduto' });
    }

    const queryResult = await db.update(user).set({
        emailVerifiedAt: new Date(),
        emailVerificationCode: null,
        emailCodeAt: null,
    }).where(eq(user.id, userDb.id));

    const token = generateJwt(userDb.email);

    return c.json({
        message:'email verificata',
        token,
        user: userOmits(userDb),
    })

    
});

const resendEmailVerifySchema = z.object({
    email: z.email(),
})

authRoute.post('/resend-email-verify',zValidator('json',resendEmailVerifySchema),async c => {
    const { email } = c.req.valid('json');

    const userDb = await db.query.user.findFirst({
        where: {email}
    }); 
    
    if(!userDb ) {
        throw new HTTPException(400, {message: 'dati non validi'});
    }

    if (userDb.emailVerifiedAt){
        throw new HTTPException(400, {message: 'dati non validi'});
    }

    const code = generateRandomCode();
    //invia email//
    emailSend({
        email: userDb.email,
        subject: 'completa la registrazione',
        text:`inserisci il codice verifica ${code}`,
    })
    console.log(code);

    await db.update(user).set({
        emailVerificationCode: bcrypt.hashSync(code, 10),
        emailCodeAt: new Date(),
    }).where(eq(user.id, userDb.id));
    
    return c.json ({message:'codice verifica inviato'});
})

const sendPasswordRecoverySchema = z.object({
    email: z.email(),
})

authRoute.post('/send-password-recovery',zValidator('json', sendPasswordRecoverySchema), async c=> {
    const { email } = c.req.valid('json');

    const userDb = await db.query.user.findFirst({
        where: { email },
    });

    if (!userDb || !user.emailVerifiedAt) {
        throw new HTTPException(400 , { message: 'Dati non validi'});
    }

    const code = generateRandomCode();
    await emailSend({
        email,
        subject: 'Richiesta recupera password',
        text:`ecco il tuo codice per recuperare la password: ${code}`,
    });
    console.log(code);
    
    await db.update(user).set({
        passwordRecoveryCode: bcrypt.hashSync(code, 10),
        passwordRecoveryAt: new Date(),
    }).where(eq(user.id, userDb.id));

    return c.json({ message: 'codice recupero password inviato'});
});

const passwordRecoverySchema = z.object({
    email:z.email(),
  code: z.string().min(1),
  password: z.string()
    .min(8)
    .regex(/[a-z]/g, { error: 'Devi inserire almeno una minuscola' })
    .regex(/[A-Z]/g, { error: 'Devi inserire almeno una Maiuscola' })
    .regex(/[0-9]/g, { error: 'Devi inserire almeno un numero' })
    .regex(/[!$&=?]/g, { error: 'Devi inserire almeno un simbolo tra !$&=?' })
    .transform(value => bcrypt.hashSync(value, 10)),
  passwordConfirmation: z.string().min(1),
}).superRefine((data, ctx) => {
  if (!bcrypt.compareSync(data.passwordConfirmation, data.password)) {
    ctx.addIssue({
      key: 'passwordConfirmation',
      code: 'custom',
      path: ['password', 'passwordConfirmation'],
      message: 'Le 2 password non corrispondono!'
    });
  }
});

authRoute.post('password-recovery',zValidator('json',passwordRecoverySchema), async c => {
    const {email,code,password} = c.req.valid('json');

    const userDb = await db.query.user.findFirst({
        where: {email},
    });

    if (!userDb || (userDb.passwordRecoveryCode && !bcrypt.compareSync(code, userDb.passwordRecoveryCode))){
        throw new HTTPException (400, {message: 'dati non validi'});
    }

    if (!userDb.passwordRecoveryAt){
        throw new HTTPException(400,{message:'codice di recupero scaduto'});
    }

    const createdAt = userDb.passwordRecoveryAt.valueOf();
    const now = new Date().valueOf();
    const diff = Math.floor((now - createdAt) / 100 / 60 );
        if (diff > 10 ) {
            throw new HTTPException(400, { message: 'codice di recupero scaduto'});
        }

    await db.update(user).set({
        password: bcrypt.hashSync(password, 10),
        passwordRecoveryCode: null,
        passwordRecoveryAt:null,
    }).where(eq(user.id,userDb.id));

    return c.json({message:'password modificata'});
})


export default authRoute;