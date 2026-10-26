// pnpm geo: downloads iptoasn.com's table of networks (Public Domain, PDDL v1.0) into ~/.cache/argus (ARGUS_GEO_FILE
// elsewhere), for "where the data goes": the network (AS) a host's address belongs to and the country it is
// registered in (server/geo.ts). One copy serves every instance; run it again now and then (it changes weekly).

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GEO_URL, Geo, geoFile } from '../server/geo.ts';

const file = geoFile();
mkdirSync(path.dirname(file), { recursive: true });
const res = await fetch(GEO_URL);
if (!res.ok) throw new Error(`${GEO_URL}: ${res.status}`);
const tmp = `${file}.part`;
writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
renameSync(tmp, file);
const geo = Geo.load(file);
console.log(`${file}: ${geo.size} networks; 8.8.8.8 is ${JSON.stringify(geo.where('8.8.8.8'))}`);
