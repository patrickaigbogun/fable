//app.ts
import { Elysia } from 'elysia'
import { Logestic } from 'logestic'
import path from 'node:path'

import { apiRouter } from './routes/api'
import { clientRouter, devReloadRouter } from './routes/client'

const isProd = process.env.NODE_ENV === 'production'

const app = new Elysia()
  .use(Logestic.preset('fancy'))
  // In dev, avoid aggressive caching so adding/editing pages updates immediately.
  .get('/assets/*', ({ request, set }) => {
    const url = new URL(request.url)
    const rel = url.pathname.replace(/^\/assets\//, '')
    const normalized = path.posix.normalize('/' + rel).slice(1)
    if (!normalized || normalized.startsWith('..') || normalized.includes('..')) {
      set.status = 400
      return 'Bad asset path'
    }

    const filePath = path.join('web/public/assets', normalized)
    const file = Bun.file(filePath)
    set.headers['cache-control'] = isProd
      ? 'public, max-age=31536000, immutable'
      : 'no-store'
    return file
  })
  .use(apiRouter)
  .use(devReloadRouter)
  .use(clientRouter)
  .listen(7990)

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)