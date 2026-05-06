import z from "zod";
import qs from "qs";
function getRelationsFor(fullRelations, entityName) {
    const entity = fullRelations[entityName];
    if (!entity)
        return {};
    return (entity.relations ?? entity);
}
export function withSchema(fullRelations, entityName) {
    const rels = getRelationsFor(fullRelations, entityName);
    const relationKeys = Object.keys(rels);
    if (relationKeys.length === 0) {
        return z.record(z.never(), z.never()).optional();
    }
    const relationValueSchema = (key) => z
        .union([
        z.enum(["true", "false"]).transform((val) => val === "true"),
        z
            .object({
            with: z.lazy(() => withSchema(fullRelations, key)),
        })
            .strict(),
    ])
        .optional();
    return z
        .object(Object.fromEntries(relationKeys.map((key) => [key, relationValueSchema(key)])))
        .strict()
        .optional();
}
export function querySchema(schema) {
    return z.preprocess((val) => qs.parse(val), schema);
}
