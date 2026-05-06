import { Hono } from "hono"
import db from "../db/index.js"
import { HTTPException } from "hono/http-exception"
import { zValidator } from "@hono/zod-validator"
import { createInsertSchema, createUpdateSchema } from "drizzle-orm/zod"
import { categories, posts, postsToCategories } from "../db/schema.js"
import { and, count, DrizzleQueryError, eq, ilike } from "drizzle-orm"
import { DatabaseError } from "pg"
import z from "zod"
import { querySchema, withSchema } from "../lib/validation.js"
import relations from "../db/relations.js"
import { join } from "node:path"
import { writeFile, rm, readFile } from "node:fs/promises"
import { existsSync, mkdirSync } from "node:fs"
import { fileTypeFromBuffer } from "file-type"
import {
  authMiddleware,
  type AuthContext,
} from "../middleware/auth.middleware.js"

const postRoute = new Hono<AuthContext>().basePath("posts")

const listSchema = querySchema(
  z
    .object({
      userId: z.string().optional(),
      page: z
        .string()
        .optional()
        .transform((val) => (val ? +val : undefined)),
      perPage: z
        .string()
        .optional()
        .transform((val) => (val ? +val : undefined)),
      with: withSchema(relations, "posts"),
      category: z.string().optional(),
      search: z.string().optional(),
    })
    .strict(),
)
postRoute.get("/", zValidator("query", listSchema), async (c) => {
  try {
    const {
      userId,
      page,
      perPage,
      with: withQuery,
      category,
      search,
    } = c.req.valid("query")

    const postsRes = await db.query.posts.findMany({
      where: {
        userId,
        ...(category ? { categories: { slug: { eq: category } } } : {}),
        ...(search ? { title: { ilike: `%${search}%` } } : {}),
      },
      limit: perPage || (page ? 10 : undefined),
      offset: page ? (page - 1) * (perPage || 10) : undefined,
      orderBy: {
        createdAt: "desc",
      },
      with: withQuery,
    })

    const [{ count: countPost }] = await db
      .select({ count: count() })
      .from(posts)
      .innerJoin(postsToCategories, eq(posts.id, postsToCategories.postId))
      .innerJoin(categories, eq(postsToCategories.categoryId, categories.id))
      .where(
        and(
          userId ? eq(posts.userId, userId) : undefined,
          category ? eq(categories.slug, category) : undefined,
          search ? ilike(posts.title, `%${search}%`) : undefined,
        ),
      )
    const totalPages = Math.ceil(countPost / (perPage || 10))

    return c.json({
      items: postsRes,
      totalItems: countPost,
      page,
      perPage,
      totalPages,
      hasNextPage: page ? page < totalPages : false,
      hasPrevPage: page ? page > 1 : false,
    })
  } catch (error) {
    return c.json({ message: "Errore del server" }, 500)
  }
})

const findSchema = querySchema(
  z
    .object({
      with: withSchema(relations, "posts"),
    })
    .strict(),
)
postRoute.get("/:id", zValidator("query", findSchema), async (c) => {
  try {
    const { id } = c.req.param()
    const { with: withQuery } = c.req.valid("query")

    const post = await db.query.posts.findFirst({
      where: { id },
      with: withQuery,
    })
    if (!post) {
      throw new HTTPException(404, { message: "Post non trovato" })
    }
    return c.json(post)
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status)
    }
    console.log(error)

    // if ( error instanceof TransformError) {}
    return c.json({ message: "Errore del server" }, 500)
  }
})

postRoute.post(
  "/",
  authMiddleware(),
  zValidator(
    "json",
    createInsertSchema(posts).omit({ featuredImage: true }).extend({
      categoryIds: z.string().array().optional(),
    }),
  ),
  zValidator("query", findSchema),
  async (c) => {
    try {
      const { categoryIds, ...data } = c.req.valid("json")
      const { with: withQuery } = c.req.valid("query")

      const newPost = await db.transaction(async (tx) => {
        const newPost = await tx.insert(posts).values(data).returning()

        if (categoryIds?.length) {
          await tx.insert(postsToCategories).values(
            categoryIds.map((categoryId) => ({
              categoryId,
              postId: newPost[0].id,
            })),
          )
        }

        return newPost[0]
      })

      const queryResult = await db.query.posts.findFirst({
        where: { id: newPost.id },
        with: withQuery,
      })

      return c.json(queryResult)
    } catch (error) {
      if (error instanceof DrizzleQueryError) {
        if (error.cause instanceof DatabaseError) {
          return c.json({ message: error.cause?.detail }, 400)
        }
      }
      return c.json({ message: "Errore del server" }, 500)
    }
  },
)

postRoute.patch(
  "/:id",
  authMiddleware(),
  zValidator(
    "json",
    createUpdateSchema(posts).omit({ featuredImage: true }).extend({
      categoryIds: z.string().array().optional(),
    }),
  ),
  zValidator("query", findSchema),
  async (c) => {
    try {
      const { id } = c.req.param()
      const { categoryIds, ...data } = c.req.valid("json")
      const { with: withQuery } = c.req.valid("query")

      await db.transaction(async (tx) => {
        if (Object.keys(data).length) {
          const queryResult = await tx
            .update(posts)
            .set(data)
            .where(eq(posts.id, id))
            .returning()
          if (!queryResult.length) {
            throw new HTTPException(404, { message: "Post non trovato" })
          }
        }

        if (categoryIds) {
          // elimino le categorie del post selezionato
          await tx
            .delete(postsToCategories)
            .where(eq(postsToCategories.postId, id))
          // e poi ricreo solo quelle passate
          if (categoryIds.length) {
            await tx.insert(postsToCategories).values(
              categoryIds.map((categoryId) => ({
                categoryId,
                postId: id,
              })),
            )
          }
        }
      })

      const queryResult = await db.query.posts.findFirst({
        where: { id },
        with: withQuery,
      })

      return c.json(queryResult)
    } catch (error) {
      console.log(error)
      if (error instanceof HTTPException) {
        return c.json({ message: error.message }, error.status)
      }
      return c.json({ message: "Errore del server" }, 500)
    }
  },
)

postRoute.delete("/:id", authMiddleware(), async (c) => {
  try {
    const { id } = c.req.param()

    const deletedPosts = await db
      .delete(posts)
      .where(eq(posts.id, id))
      .returning({ id: posts.id })
    if (!deletedPosts.length) {
      throw new HTTPException(404, { message: "Post non trovato" })
    }

    return c.json(deletedPosts[0])
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status)
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

const uploadImageSchema = z.object({
  file: z
    .file()
    .mime(["image/jpeg", "image/png"])
    .max(10 * 1024 * 1024),
})
postRoute.post(
  "/:id/featured-image",
  authMiddleware(),
  zValidator("form", uploadImageSchema),
  async (c) => {
    try {
      const { file } = c.req.valid("form")
      const { id } = c.req.param()

      const queryResult = await db.query.posts.findFirst({
        where: { id },
      })
      if (!queryResult) {
        throw new HTTPException(404, { message: "Articolo non trovato" })
      }

      if (queryResult.featuredImage && existsSync(queryResult.featuredImage)) {
        await rm(queryResult.featuredImage)
      }

      const UPLOAD_DIR = join(process.cwd(), "uploads")
      if (!existsSync(UPLOAD_DIR)) {
        mkdirSync(UPLOAD_DIR, { recursive: true })
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      const filename = `${Date.now()}_${file.name}`
      const filepath = join(UPLOAD_DIR, filename)

      await writeFile(filepath, buffer)

      await db
        .update(posts)
        .set({ featuredImage: filepath })
        .where(eq(posts.id, id))

      return c.json({ message: "file ricevuto" })
    } catch (error) {
      if (error instanceof HTTPException) {
        return c.json({ message: error.message }, error.status)
      }
      return c.json({ message: "Errore del server" }, 500)
    }
  },
)

postRoute.get("/:id/featured-image", async (c) => {
  try {
    const { id } = c.req.param()

    const queryResult = await db.query.posts.findFirst({
      where: { id },
    })
    if (!queryResult) {
      throw new HTTPException(404, { message: "Articolo non trovato" })
    }

    if (!queryResult.featuredImage || !existsSync(queryResult.featuredImage)) {
      throw new HTTPException(404, {
        message: "Immagine articolo non trovata",
      })
    }

    const buffer = await readFile(queryResult.featuredImage)
    const detect = await fileTypeFromBuffer(buffer)

    return new Response(buffer, {
      headers: {
        "Content-Type": detect?.mime || "application/octet-stream",
      },
    })
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status)
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

postRoute.delete("/:id/featured-image", authMiddleware(), async (c) => {
  try {
    const { id } = c.req.param()

    const queryResult = await db.query.posts.findFirst({
      where: { id },
    })
    if (!queryResult) {
      throw new HTTPException(404, { message: "Articolo non trovato" })
    }

    await db.update(posts).set({ featuredImage: null }).where(eq(posts.id, id))

    if (queryResult.featuredImage && existsSync(queryResult.featuredImage)) {
      await rm(queryResult.featuredImage)
    }

    return c.json({ message: "Immagine eliminata" })
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status)
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

export default postRoute