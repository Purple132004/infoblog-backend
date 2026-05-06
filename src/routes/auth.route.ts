import { zValidator } from "@hono/zod-validator"
import bcrypt from "bcrypt"
import { eq } from "drizzle-orm"
import { createInsertSchema } from "drizzle-orm/zod"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import z from "zod"
import db from "../db/index.js"
import { user } from "../db/schema.js"
import { emailSend } from "../lib/email.js"
import { userOmits } from "../lib/omits.js"
import { generateJwt, generateRandomCode } from "../lib/utils.js"
import {
  authMiddleware,
  type AuthContext,
} from "../middleware/auth.middleware.js"

const authRoute = new Hono<AuthContext>().basePath("auth")

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})
authRoute.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json")

  const user = await db.query.user.findFirst({
    where: { email },
    // columns: { password: false }
  })
  if (!user) {
    throw new HTTPException(401, { message: "Email o password non validi!" })
  }

  if (!user.emailVerifiedAt) {
    throw new HTTPException(401, {
      message: "Devi verificare la mail",
      cause: "EMAIL_NOT_VERIFIED",
    })
  }

  const validPassword = await bcrypt.compare(password, user.password)
  if (!validPassword) {
    throw new HTTPException(401, { message: "Email o password non validi!" })
  }

  const token = generateJwt(user.email)

  // const { password: psw, ...userNoPsw } = user;
  return c.json({
    token,
    user: userOmits(user),
  })
})

authRoute.get("/me", authMiddleware(), async (c) => {
  const user = c.get("authUser")
  return c.json(userOmits(user))
})

const registerSchema = createInsertSchema(user, {
  email: z.email(),
  password: z
    .string()
    .min(8)
    .regex(/[a-z]/g, { error: "Devi inserire almeno una minuscola" })
    .regex(/[A-Z]/g, { error: "Devi inserire almeno una Maiuscola" })
    .regex(/[0-9]/g, { error: "Devi inserire almeno un numero" })
    .regex(/[!$&=?]/g, { error: "Devi inserire almeno un simbolo tra !$&=?" })
    .transform((value) => bcrypt.hashSync(value, 10)),
})
  .extend({
    passwordConfirmation: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    if (!bcrypt.compareSync(data.passwordConfirmation, data.password)) {
      ctx.addIssue({
        key: "passwordConfirmation",
        code: "custom",
        path: ["password", "passwordConfirmation"],
        message: "Le 2 password non corrispondono!",
      })
    }
  })
authRoute.post("/register", zValidator("json", registerSchema), async (c) => {
  const data = c.req.valid("json")

  const code = generateRandomCode()
  emailSend({
    email: data.email,
    subject: "Completa la registrazione",
    text: `Inserisci il codice verifica ${code}`,
  })
  console.log(code)

  const queryResult = await db
    .insert(user)
    .values({
      ...data,
      emailVerificationCode: bcrypt.hashSync(code, 10),
      emailCodeAt: new Date(),
    })
    .returning()

  return c.json({
    message: "Utente registrato",
    user: userOmits(queryResult[0]),
  })
})

const emailVerifySchema = z.object({
  email: z.email(),
  code: z.string().min(1),
})
authRoute.post(
  "/email-verify",
  zValidator("json", emailVerifySchema),
  async (c) => {
    const { email, code } = c.req.valid("json")

    const userDb = await db.query.user.findFirst({
      where: { email },
    })

    if (
      !userDb ||
      (userDb.emailVerificationCode &&
        !bcrypt.compareSync(code, userDb.emailVerificationCode))
    ) {
      throw new HTTPException(400, {
        message: "Verifica della mail non valida!",
      })
    }

    if (userDb.emailVerifiedAt) {
      throw new HTTPException(400, { message: "Email già verificata" })
    }

    if (!userDb.emailCodeAt) {
      throw new HTTPException(400, { message: "Codice scaduto" })
    }
    const createdAt = userDb.emailCodeAt.valueOf()
    const now = new Date().valueOf()
    const diff = Math.floor((now - createdAt) / 1000 / 60)
    if (diff > 10) {
      throw new HTTPException(400, { message: "Codice scaduto" })
    }

    const queryResult = await db
      .update(user)
      .set({
        emailVerifiedAt: new Date(),
        emailVerificationCode: null,
        emailCodeAt: null,
      })
      .where(eq(user.id, userDb.id))

    const token = generateJwt(userDb.email)

    return c.json({
      message: "Email verificata",
      token,
      user: userOmits(userDb),
    })
  },
)

const resendEmailVerifySchema = z.object({
  email: z.email(),
})
authRoute.post(
  "/resend-email-verify",
  zValidator("json", resendEmailVerifySchema),
  async (c) => {
    const { email } = c.req.valid("json")

    const userDb = await db.query.user.findFirst({
      where: { email },
    })

    if (!userDb) {
      throw new HTTPException(400, { message: "Dati non validi" })
    }

    if (userDb.emailVerifiedAt) {
      throw new HTTPException(400, { message: "Dati non validi" })
    }

    const code = generateRandomCode()
    emailSend({
      email: userDb.email,
      subject: "Completa la registrazione",
      text: `Inserisci il codice verifica ${code}`,
    })
    console.log(code)

    await db
      .update(user)
      .set({
        emailVerificationCode: bcrypt.hashSync(code, 10),
        emailCodeAt: new Date(),
      })
      .where(eq(user.id, userDb.id))

    return c.json({ message: "Codice verifica inviato" })
  },
)

const sendPasswordRecoverySchema = z.object({
  email: z.email(),
})
authRoute.post(
  "/send-password-recovery",
  zValidator("json", sendPasswordRecoverySchema),
  async (c) => {
    const { email } = c.req.valid("json")

    const userDb = await db.query.user.findFirst({
      where: { email },
    })

    if (!userDb || !user.emailVerifiedAt) {
      throw new HTTPException(400, { message: "Dati non validi" })
    }

    const code = generateRandomCode()
    await emailSend({
      email,
      subject: "Richiesta recupero password",
      text: `Ecco il tuo codice di recupero per la password: ${code}`,
    })
    console.log(code)

    await db
      .update(user)
      .set({
        passwordRecoveryCode: bcrypt.hashSync(code, 10),
        passwordRecoveryAt: new Date(),
      })
      .where(eq(user.id, userDb.id))

    return c.json({ message: "Codice recupero password mandato " })
  },
)

const passwordRecoverySchema = z
  .object({
    email: z.email(),
    code: z.string().min(1),
    password: z
      .string()
      .min(8)
      .regex(/[a-z]/g, { error: "Devi inserire almeno una minuscola" })
      .regex(/[A-Z]/g, { error: "Devi inserire almeno una Maiuscola" })
      .regex(/[0-9]/g, { error: "Devi inserire almeno un numero" })
      .regex(/[!$&=?]/g, { error: "Devi inserire almeno un simbolo tra !$&=?" })
      .transform((value) => bcrypt.hashSync(value, 10)),
    passwordConfirmation: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    if (!bcrypt.compareSync(data.passwordConfirmation, data.password)) {
      ctx.addIssue({
        key: "passwordConfirmation",
        code: "custom",
        path: ["password", "passwordConfirmation"],
        message: "Le 2 password non corrispondono!",
      })
    }
  })
authRoute.post(
  "password-recovery",
  zValidator("json", passwordRecoverySchema),
  async (c) => {
    const { email, code, password } = c.req.valid("json")

    const userDb = await db.query.user.findFirst({
      where: { email },
    })

    if (
      !userDb ||
      (userDb.passwordRecoveryCode &&
        !bcrypt.compareSync(code, userDb.passwordRecoveryCode))
    ) {
      throw new HTTPException(400, { message: "Dati non validi" })
    }

    if (!userDb.passwordRecoveryAt) {
      throw new HTTPException(400, { message: "Codice recupero scaduto" })
    }
    const createdAt = userDb.passwordRecoveryAt.valueOf()
    const now = new Date().valueOf()
    const diff = Math.floor((now - createdAt) / 1000 / 60)
    if (diff > 10) {
      throw new HTTPException(400, { message: "Codice recupero scaduto" })
    }

    await db
      .update(user)
      .set({
        password,
        passwordRecoveryCode: null,
        passwordRecoveryAt: null,
      })
      .where(eq(user.id, userDb.id))

    return c.json({ message: "Password modificata" })
  },
)

export default authRoute