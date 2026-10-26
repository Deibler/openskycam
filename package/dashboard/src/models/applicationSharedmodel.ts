/** Generated from wrangler.jsonc; the development viewer is absent in production. */
export interface Env extends Omit<WorkerBindings, 'DEV_VIEWER_EMAIL'> {
  /** Local development only (.dev.vars): the viewer to assume on localhost, where Access doesn't exist. */
  DEV_VIEWER_EMAIL?: string;
  /** Secret: bearer token the footage store (external/store) requires. */
  STORE_TOKEN: string;
}

/** Everything a route handler needs: the bindings and who is signed in. */
export interface App {
  env: Env;
  viewer: Viewer;
}

export interface Viewer {
  email: string;
}

import type { ApiPrincipal } from './credentialSharedmodel';
export interface MachineApp {
  env: Env;
  principal: ApiPrincipal;
}
