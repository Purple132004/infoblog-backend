import { reset, seed } from "drizzle-seed"
import db from "./index.js"
import * as schema from './schema.js'
import bcrypt from 'bcrypt'

async function init() {
    await reset(db, schema);

    const password = await bcrypt.hash('Password!', 10)
    await seed(db, schema, { count: 20 }).refine(f => ({
        posts: {
            columns: {
                title: f.loremIpsum(),
                description: f.loremIpsum({ sentencesCount: 20 }),
            }
        },
        user: {
            with: {
                posts: 10
            },
            columns: {
                email: f.email(),
                firstName: f.firstName(),
                lastName: f.lastName(),
                password: f.default({ defaultValue: password })
            }
        }
    }))
}
init()