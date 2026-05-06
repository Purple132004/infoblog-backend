import jwt from "jsonwebtoken";
export function omit(obj, ...keys) {
    const omitSet = new Set(keys);
    return Object.fromEntries(Object.entries(obj).filter(([key]) => !omitSet.has(key)));
}
export function generateRandomCode() {
    const random = Math.floor((Math.random() + 1) * 100000);
    return random.toString();
}
export function generateJwt(email) {
    const token = jwt.sign({ email }, process.env.JWT_SECRET || "secret", {
        expiresIn: "1y",
    });
    return token;
}
