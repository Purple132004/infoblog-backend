import { defineRelations } from "drizzle-orm";
import * as schema from "./schema.js";
const relations = defineRelations(schema, (r) => ({
    posts: {
        user: r.one.user({
            from: r.posts.userId,
            to: r.user.id,
        }),
        categories: r.many.categories({
            from: r.posts.id.through(r.postsToCategories.postId),
            to: r.categories.id.through(r.postsToCategories.categoryId),
        }),
    },
    user: {
        posts: r.many.posts(),
    },
    categories: {
        posts: r.many.posts(),
    },
}));
export default relations;
