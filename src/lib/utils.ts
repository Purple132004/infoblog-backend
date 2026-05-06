import jwt from "jsonwebtoken"

export function omit<T extends object, K extends keyof T>(
  obj: T,
  ...keys: K[]
): Omit<T, K> {
  const omitSet = new Set(keys)
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !omitSet.has(key as K)),
  ) as Omit<T, K>
}

export function generateRandomCode() {
  const random = Math.floor((Math.random() + 1) * 100000)
  return random.toString()
}

export function generateJwt(email: string) {
  const token = jwt.sign({ email }, process.env.JWT_SECRET || "secret", {
    expiresIn: "1y",
  })
  return token
}