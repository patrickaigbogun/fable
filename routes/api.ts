import  { Elysia } from 'elysia';

export const apiRouter = new Elysia()

    .group("/api/v1", (app) => app
	.get("/ping", () => ({status: 'pong'}))
	//.use(auth)
	
    );
