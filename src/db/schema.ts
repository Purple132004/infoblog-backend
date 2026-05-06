import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  pgEnum
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum('role', ['admin', 'user']);

export const user = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().unique().notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  password: text().notNull(),
  emailVerificationCode: text("email_verification_code"),
  emailVerifiedAt: timestamp("email_verified_at"),
  emailCodeAt: timestamp("email_code_at"),
  passwordRecoveryCode: text("password_recovery_code"),
  passwordRecoveryAt: timestamp("password_recovery_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  role: userRoleEnum().notNull().default('user'),
});

export const posts = pgTable("posts", {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull(),
  description: text().notNull(),
  featuredImage: text(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().unique().notNull(),
  name: text().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const postsToCategories = pgTable(
  "posts_to_categories",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.postId] })],
);