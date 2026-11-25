import type { FastifyInstance } from 'fastify';
import { API_ROUTES, type ApiName } from '@meetless/api';
import { agentGuideGet } from '../accounts/guide';
import { ApiError, defineRoute, type ApiDeps, type Handler } from './frame';
import { ACCOUNT_HANDLERS } from './routes-accounts';
import { TOKEN_HANDLERS } from './routes-tokens';
import { INPUT_HANDLERS } from './routes-inputs';
import { OFFICE_HANDLERS } from './routes-office';
import { READ_HANDLERS } from './routes-read';
import { WRITE_HANDLERS } from './routes-write';

export {
  API_STATUS,
  ApiError,
  authenticateRequest,
  clientHeader,
  clientOf,
  defineRoute,
  errorResponse,
  NUMERIC_QUERY,
  requireUserPrincipal,
  type ApiDeps,
  type Handler,
  type RouteCtx,
} from './frame';

/** `me`: the caller as the state knows them, and whether dev auth is on. */
const me: Handler<'me'> = async ({ p, deps }) => {
  const u = Object.prototype.hasOwnProperty.call(deps.service.current.users, p.userId) ? deps.service.current.users[p.userId]! : null;
  // A token whose user was never registered cannot act as anyone.
  if (!u) throw new ApiError('UNAUTHENTICATED');
  return { user: { id: u.id, displayName: u.displayName, locale: u.locale }, devAuth: deps.cfg.devAuth };
};

/**
 * The handler of each API route. A route without one answers NOT_IMPLEMENTED.
 * Later tasks add their handlers here (e.g. spread a `Partial<...>` map from their module).
 */
export const HANDLERS: Partial<{ [K in ApiName]: Handler<K> }> = {
  me,
  'agent.guide': agentGuideGet,
  ...ACCOUNT_HANDLERS,
  ...TOKEN_HANDLERS,
  ...INPUT_HANDLERS,
  ...OFFICE_HANDLERS,
  ...READ_HANDLERS,
  ...WRITE_HANDLERS,
};

const notImplemented = async (): Promise<never> => {
  throw new ApiError('NOT_IMPLEMENTED');
};

function register<K extends ApiName>(app: FastifyInstance, deps: ApiDeps, name: K): void {
  defineRoute(app, deps, name, (HANDLERS[name] as Handler<K> | undefined) ?? notImplemented);
}

/** Registers every `API_ROUTES` entry on `app`. */
export function registerApiRoutes(app: FastifyInstance, deps: ApiDeps): void {
  for (const name of Object.keys(API_ROUTES) as ApiName[]) register(app, deps, name);
}
