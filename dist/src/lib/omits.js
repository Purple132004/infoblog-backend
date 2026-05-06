import { omit } from "./utils.js";
import { user } from '../db/schema.js';
export const userOmits = (data) => omit(data, 'password', 'emailVerificationCode', 'passwordRecoveryCode');
