// pnpm app [status|start|restart|stop] [--build]: the core's control of this app's server.
import { controlCli } from '@organon/core/server/control';
import { app } from './config.ts';

await controlCli(app);
