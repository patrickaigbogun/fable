import { readdir, mkdir } from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'

type RouteSegment =
	| { kind: 'static'; value: string }
	| { kind: 'param'; name: string }
	| { kind: 'catchAll'; name: string }

type RouteRecord = {
	file: string
	path: string
	segments: RouteSegment[]
	importPath: string
}

type LayoutRecord = {
	name: string
	file: string
	importPath: string
}

function toPosix(p: string) {
	return p.split(path.sep).join('/')
}

function isIgnoredRouteFile(relPosix: string) {
	const parts = relPosix.split('/')
	return parts.some((p) => p.startsWith('_'))
}

function parseSegment(seg: string): RouteSegment {
	if (seg.startsWith('[...') && seg.endsWith(']')) {
		return { kind: 'catchAll', name: seg.slice(4, -1) }
	}
	if (seg.startsWith('[') && seg.endsWith(']')) {
		return { kind: 'param', name: seg.slice(1, -1) }
	}
	return { kind: 'static', value: seg }
}

function fileToRoute(relPosixNoExt: string) {
	// Nuxt-like: folder/index => /folder, and root index => /
	let p = relPosixNoExt
	if (p === 'index') p = ''
	if (p.endsWith('/index')) p = p.slice(0, -'/index'.length)

	const urlPath = '/' + p
	const segs = p === '' ? [] : p.split('/').filter(Boolean)
	const segments = segs.map(parseSegment)

	return { path: urlPath === '/' ? '/' : urlPath.replace(/\/+$/g, ''), segments }
}

async function walk(dirAbs: string): Promise<string[]> {
	const out: string[] = []
	const entries = await readdir(dirAbs, { withFileTypes: true })
	for (const e of entries) {
		const abs = path.join(dirAbs, e.name)
		if (e.isDirectory()) {
			out.push(...(await walk(abs)))
			continue
		}
		out.push(abs)
	}
	return out
}

async function walkIfExists(dirAbs: string): Promise<string[]> {
	try {
		return await walk(dirAbs)
	} catch {
		return []
	}
}

function fileToLayoutName(relPosixNoExt: string) {
	let n = relPosixNoExt
	if (n.endsWith('/index')) n = n.slice(0, -'/index'.length)
	return n
}

export async function generateLayouts(opts?: {
	layoutsDir?: string
	outTs?: string
}) {
	const layoutsDirAbs = path.resolve(opts?.layoutsDir ?? './web/layouts')
	const outTsAbs = path.resolve(opts?.outTs ?? './core/router/.generated/layouts.ts')

	const filesAbs = (await walkIfExists(layoutsDirAbs)).filter((f) => f.endsWith('.tsx'))

	const layouts: LayoutRecord[] = []
	for (const abs of filesAbs) {
		const rel = toPosix(path.relative(layoutsDirAbs, abs))
		if (isIgnoredRouteFile(rel)) continue

		const relNoExt = rel.replace(/\.tsx$/i, '')
		const name = fileToLayoutName(relNoExt)
		if (!name) continue

		const importPath = toPosix(path.relative(path.dirname(outTsAbs), abs))
		const importPathNormalized = importPath.startsWith('.') ? importPath : './' + importPath

		layouts.push({ name, file: rel, importPath: importPathNormalized })
	}

	layouts.sort((a, b) => a.name.localeCompare(b.name))

	await mkdir(path.dirname(outTsAbs), { recursive: true })

	const ts = `/* eslint-disable */
// AUTO-GENERATED. DO NOT EDIT.
// Source: ${toPosix(path.relative(process.cwd(), layoutsDirAbs))}
// Generated at: ${new Date().toISOString()}

import type { LayoutModule } from '../types'

export const layouts: Record<string, () => Promise<LayoutModule>> = {
${layouts
		.map((l) => `  ${JSON.stringify(l.name)}: () => import(${JSON.stringify(l.importPath)}),`)
		.join('\n')}
}
`

	await Bun.write(outTsAbs, ts)
}

export async function generateFsRoutes(opts?: {
	pagesDir?: string
	outTs?: string
	outJson?: string
}) {
	const pagesDirAbs = path.resolve(opts?.pagesDir ?? './web/pages')
	const outTsAbs = path.resolve(opts?.outTs ?? './core/router/.generated/routes.ts')
	const outJsonAbs = path.resolve(opts?.outJson ?? './core/router/.generated/manifest.json')

	const filesAbs = (await walk(pagesDirAbs)).filter((f) => f.endsWith('.tsx'))

	const routes: RouteRecord[] = []
	for (const abs of filesAbs) {
		const rel = toPosix(path.relative(pagesDirAbs, abs))
		if (isIgnoredRouteFile(rel)) continue

		const relNoExt = rel.replace(/\.tsx$/i, '')
		const { path: routePath, segments } = fileToRoute(relNoExt)

		// `core/router/.generated/routes.ts` -> `web/pages/<rel>`
		const importPath = toPosix(path.relative(path.dirname(outTsAbs), abs))
		const importPathNormalized = importPath.startsWith('.') ? importPath : './' + importPath

		routes.push({ file: rel, path: routePath, segments, importPath: importPathNormalized })
	}

	routes.sort((a, b) => a.path.localeCompare(b.path))

	await mkdir(path.dirname(outTsAbs), { recursive: true })

	const ts = `/* eslint-disable */
// AUTO-GENERATED. DO NOT EDIT.
// Source: ${toPosix(path.relative(process.cwd(), pagesDirAbs))}
// Generated at: ${new Date().toISOString()}

import type { Route } from '../types'

export const routes: Route[] = [
${routes
		.map(
			(r) => `  {
    file: ${JSON.stringify(r.file)},
    path: ${JSON.stringify(r.path)},
    segments: ${JSON.stringify(r.segments)},
    importPage: () => import(${JSON.stringify(r.importPath)}),
  }`
		)
		.join(',\n')}
]
`

	const json = JSON.stringify(
		{
			source: toPosix(path.relative(process.cwd(), pagesDirAbs)),
			generatedAt: new Date().toISOString(),
			routes: routes.map(({ file, path, segments }) => ({ file, path, segments })),
		},
		null,
		2
	)

	await Bun.write(outTsAbs, ts)
	await Bun.write(outJsonAbs, json)
}

async function watchPagesAndRegenerate() {
	let scheduled: ReturnType<typeof setTimeout> | undefined
	let running = false
	let needsRerun = false
	const watchers = new Map<string, ReturnType<typeof watch>>()
	const pagesRoot = path.resolve('./web/pages')
	const layoutsRoot = path.resolve('./web/layouts')

	const ensureWatched = async () => {
		const seen = new Set<string>()

		const walkDirs = async (dirAbs: string) => {
			seen.add(dirAbs)
			if (!watchers.has(dirAbs)) {
				const w = watch(dirAbs, (_event, filename) => {
					// On Linux, fs.watch is not reliably recursive; we watch all dirs.
					if (typeof filename === 'string') {
						if (!filename.endsWith('.tsx')) {
							// Still rescan dirs on structural changes (new folders/files)
							// but debounce so it stays cheap.
							schedule(true)
							return
						}
					}
					schedule()
				})
				watchers.set(dirAbs, w)
			}

			const entries = await readdir(dirAbs, { withFileTypes: true })
			for (const e of entries) {
				if (!e.isDirectory()) continue
				if (e.name.startsWith('.')) continue
				await walkDirs(path.join(dirAbs, e.name))
			}
		}

		for (const root of [pagesRoot, layoutsRoot]) {
			try {
				await walkDirs(root)
			} catch {
				// ignore missing roots (e.g. no layouts dir yet)
			}
		}

		for (const [dir, w] of watchers) {
			if (seen.has(dir)) continue
			w.close()
			watchers.delete(dir)
		}
	}

	const schedule = (rescanDirs = false) => {
		if (scheduled) clearTimeout(scheduled)
		scheduled = setTimeout(async () => {
			scheduled = undefined
			if (running) {
				needsRerun = true
				return
			}
			running = true
			try {
				if (rescanDirs) await ensureWatched()
				await generateFsRoutes()
				await generateLayouts()
				// eslint-disable-next-line no-console
				console.log('[router] regenerated routes/layouts')
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('[router] route generation failed', err)
			} finally {
				running = false
				if (needsRerun) {
					needsRerun = false
					schedule(rescanDirs)
				}
			}
		}, 120)
	}

	await ensureWatched()
	await generateFsRoutes()
	await generateLayouts()
	// eslint-disable-next-line no-console
	console.log('[router] watching web/pages and web/layouts for changes')

	const shutdown = () => {
		for (const w of watchers.values()) w.close()
		process.exit(0)
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}

if (import.meta.main) {
	const args = new Set(process.argv.slice(2))
	if (args.has('--watch')) {
		await watchPagesAndRegenerate()
	} else {
		await generateFsRoutes()
		await generateLayouts()
	}
}
