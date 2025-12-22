export type RouteSegment =
	| { kind: 'static'; value: string }
	| { kind: 'param'; name: string }
	| { kind: 'catchAll'; name: string }

export type Params = Record<string, string | string[]>

export type Metadata = {
	title?: string
	description?: string
}

export type RouteContext = {
	pathname: string
	search: string
	params: Params
	query: URLSearchParams
}

export type PageModule = {
	default: (props: any) => any
	metadata?: Metadata
}

export type Route = {
	file: string
	path: string
	segments: RouteSegment[]
	importPage: () => Promise<PageModule>
}
