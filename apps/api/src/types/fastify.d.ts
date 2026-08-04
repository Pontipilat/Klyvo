import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; kind: 'access' | 'refresh'; nonce?: string };
    user: { sub: string; email: string; kind: 'access' | 'refresh' };
  }
}
