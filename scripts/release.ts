// pnpm release [--rollback]: the core's release of what is committed here to the copy argus.service runs.
import path from 'node:path';
import { defineApp } from '@organon/core/server/app';
import { release } from '@organon/core/server/release';

const ok = await release(defineApp(path.resolve(import.meta.dirname, '..')));
process.exit(ok ? 0 : 1);
