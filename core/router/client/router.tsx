import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

import type { Metadata, Params, Route, RouteContext, RouteSegment } from '../types'

type RouterState = RouteContext & {
	navigate: (to: string) => void
}

const RouterContext = createContext<RouterState | null>(null)

function normalizePathname(p: string) {
	if (!p) return '/'
	if (p !== '/' && p.endsWith('/')) return p.slice(0, -1)
	return p
}

function splitPathname(pathname: string) {
	const p = normalizePathname(pathname)
	if (p === '/') return []
	return p.split('/').filter(Boolean)
}

function matchRoute(segments: RouteSegment[], pathname: string): Params | null {
	const parts = splitPathname(pathname)
	const params: Params = {}

	let i = 0
	for (const seg of segments) {
		if (seg.kind === 'static') {
			if (parts[i] !== seg.value) return null
			i++
			continue
		}

		if (seg.kind === 'param') {
			if (i >= parts.length) return null
			params[seg.name] = decodeURIComponent(parts[i]!)
			i++
			continue
		}

		// catchAll
		params[seg.name] = parts.slice(i).map((x) => decodeURIComponent(x))
		i = parts.length
		break
	}

	if (i !== parts.length) return null
	return params
}

function applyMetadata(meta?: Metadata) {
	if (!meta) return
	if (typeof meta.title === 'string') document.title = meta.title

	if (typeof meta.description === 'string') {
		let tag = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
		if (!tag) {
			tag = document.createElement('meta')
			tag.name = 'description'
			document.head.appendChild(tag)
		}
		tag.content = meta.description
	}
}

export function useParams<T extends Params = Params>() {
	const ctx = useContext(RouterContext)
	if (!ctx) throw new Error('useParams must be used within <FileRouter />')
	return ctx.params as T
}

export function useQuery() {
	const ctx = useContext(RouterContext)
	if (!ctx) throw new Error('useQuery must be used within <FileRouter />')
	return ctx.query
}

export function useNavigate() {
	const ctx = useContext(RouterContext)
	if (!ctx) throw new Error('useNavigate must be used within <FileRouter />')
	return ctx.navigate
}

export function Link(
	props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }
) {
	const navigate = useNavigate()
	const { to, onClick, ...rest } = props

	return (
		<a
			{...rest}
			href={to}
			onClick={(e) => {
				onClick?.(e)
				if (e.defaultPrevented) return
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
				e.preventDefault()
				navigate(to)
			}}
		/>
	)
}

export function FileRouter(props: { routes: Route[]; notFound?: React.ReactNode }) {
	const [loc, setLoc] = useState(() => ({
		pathname: normalizePathname(window.location.pathname),
		search: window.location.search ?? '',
	}))

	useEffect(() => {
		const onPop = () =>
			setLoc({
				pathname: normalizePathname(window.location.pathname),
				search: window.location.search ?? '',
			})
		window.addEventListener('popstate', onPop)
		return () => window.removeEventListener('popstate', onPop)
	}, [])

	const navigate = (to: string) => {
		const url = new URL(to, window.location.origin)
		window.history.pushState({}, '', url)
		window.dispatchEvent(new PopStateEvent('popstate'))
	}

	const ctxBase: Omit<RouteContext, 'params'> = useMemo(
		() => ({
			pathname: loc.pathname,
			search: loc.search,
			query: new URLSearchParams(loc.search),
		}),
		[loc.pathname, loc.search]
	)

	const match = useMemo(() => {
		for (const r of props.routes) {
			const params = matchRoute(r.segments, loc.pathname)
			if (params) return { route: r, params }
		}
		return null
	}, [loc.pathname, props.routes])

	if (!match) return props.notFound ?? <div>404</div>

	const Page = useMemo(
		() =>
			React.lazy(async () => {
				const mod: any = await match.route.importPage()
				applyMetadata(mod.metadata)
				return mod
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[match.route.file]
	)

	return (
		<RouterContext.Provider
			value={{
				...ctxBase,
				params: match.params,
				navigate,
			}}
		>
			<React.Suspense fallback={<div>Loading...</div>}>
				<Page />
			</React.Suspense>
		</RouterContext.Provider>
	)
}
