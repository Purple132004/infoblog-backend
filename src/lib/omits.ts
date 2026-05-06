import { omit } from "./utils.js";
import { user } from '../db/schema.js'

export const userOmits = (data: Partial<typeof user.$inferSelect>) => omit(data, 'password', 'emailVerificationCode', 'passwordRecoveryCode');