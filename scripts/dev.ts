// pnpm dev: the core's dev instance (server on 4940, Vite on 5203, data in .dev/). The first time, the fixture
// recording (tests/fixtures/lan.pcap) is brought in as a capture, so the pages have something to show before any
// real capture; Claude Code reaches this instance through the argus-dev MCP server (.mcp.json).
import path from 'node:path';
import { runDev } from '@organon/core/server/dev';

const ROOT = path.resolve(import.meta.dirname, '..');
process.env.ARGUS_SEED_PCAP ??= path.join(ROOT, 'tests/fixtures/lan.pcap');
runDev(ROOT, { banner: '  captures   .dev/data/captures (the fixture first)\n' });
