// What Claude Code starts over stdio (.mcp.json): the core's bridge to this app's /mcp, starting the server if needed.
import { runBridge } from '@organon/core/server/bridge';
import { app } from './config.ts';

await runBridge(app, { lost: 'Argus stopped before answering (it may have restarted). Ask again.' });
process.exit(0);
