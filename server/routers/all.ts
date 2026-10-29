// The models of router Argus reads (server/routers.ts), in the order their pages are tried. The next one goes here:
// an adapter of its own beside this file, and a fake of it in the tests (tests/fake-router.ts).

import type { RouterAdapter } from '../routers.ts';
import { alticeFiberGateway } from './altice-fgw.ts';

export const ADAPTERS: RouterAdapter[] = [alticeFiberGateway];
