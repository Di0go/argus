// The HTTP requests read (server/requests.ts), on tests/fixtures/web.pcap: plain HTTP from two devices, and HTTPS from
// this PC with its keys in web.keys, from the phone without. Checked against web.truth.json, which the fixture's maker
// wrote from the requests it asked, never from what tshark or this code say.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { dissect } from '../server/dissect.ts';
import { interpret } from '../server/interpret.ts';
import { headerBlocks, Requests } from '../server/requests.ts';
import { Tally } from '../server/tally.ts';
import { matches, unreadOf } from '../shared/requests.ts';
import type { HttpRequest } from '../shared/types.ts';
import { ROOT, TSHARK } from './helpers.ts';

const WEB = path.join(ROOT, 'tests/fixtures/web.pcap');
const KEYS = path.join(ROOT, 'tests/fixtures/web.keys');
const truth = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/web.truth.json'), 'utf8'));
const H = truth.hosts;
const withKeys = interpret(await dissect(WEB, { tshark: TSHARK, ownMacs: [H.me.mac], keylog: KEYS }));
const without = interpret(await dissect(WEB, { tshark: TSHARK, ownMacs: [H.me.mac] }));

type Truth = { device: string; method: string; url: string; version: string; tls: boolean; status: number; size?: number; cookie?: boolean; authorization?: boolean; setCookie?: boolean; contentType?: string };
const said = (r: HttpRequest): Truth => ({
  device: r.device!,
  method: r.method,
  url: r.url,
  version: r.version,
  tls: r.tls,
  status: r.response!.status,
  ...(r.response?.size !== undefined ? { size: r.response.size } : {}),
  ...(r.cookie ? { cookie: true } : {}),
  ...(r.authorization ? { authorization: true } : {}),
  ...(r.response?.setCookie ? { setCookie: true } : {}),
  ...(r.response?.headers['content-type'] ? { contentType: r.response.headers['content-type'] } : {}),
});
const byUrl = (a: { url: string }, b: { url: string }) => a.url.localeCompare(b.url);

test('With the keys: every request, plain HTTP and HTTPS (HTTP/2 three at once, HTTP/1.1), each with its answer, as asked', () => {
  assert.deepEqual((withKeys.requests ?? []).map(said).sort(byUrl), [...(truth.requests as Truth[])].sort(byUrl));
});

test('Without the keys: only what went in the clear; the HTTPS is not read at all', () => {
  const plain = (truth.requests as Truth[]).filter((r) => !r.tls);
  assert.deepEqual((without.requests ?? []).map(said).sort(byUrl), [...plain].sort(byUrl));
});

test('The device that asked, the host and address asked, the headers worth reading; the time each answer took', () => {
  const cart = withKeys.requests!.find((r) => r.url.endsWith('/cart?item=42'))!;
  assert.equal(cart.host, H.shop.name);
  assert.equal(cart.ip, H.shop.ip);
  assert.equal(cart.port, 443);
  assert.equal(cart.headers.referer, 'https://shop.example/');
  assert.match(cart.headers['user-agent'] ?? '', /Firefox/);
  assert.ok(cart.response!.time >= cart.time);
  const upload = withKeys.requests!.find((r) => r.method === 'POST' && !r.tls)!;
  assert.equal(upload.device, H.phone.mac);
  assert.equal(upload.headers['content-type'], 'application/json');
  assert.equal(upload.response?.headers.location, '/api/upload/7');
  assert.deepEqual(upload.names, ['host', 'user-agent', 'content-type', 'content-length']);
});

test('Cookies, tokens and set-cookies: that they went by, never what they said; no body is kept', () => {
  const all = JSON.stringify([withKeys.requests, withKeys.conversations, withKeys.devices]);
  assert.doesNotMatch(all, /made-up/);
  assert.doesNotMatch(all, /Bearer/);
  assert.doesNotMatch(all, /pay=1|"photo"|items|"status":"ok"/);
  const checkout = withKeys.requests!.find((r) => r.url.endsWith('/checkout'))!;
  assert.equal(checkout.authorization, true);
  assert.ok(checkout.names.includes('authorization'));
  assert.equal(checkout.headers.authorization, undefined);
});

test('HTTPS read with its keys is not "in the clear", and its Authorization is no password in the clear', () => {
  const talk = (ip: string, v = withKeys) => v.conversations.find((c) => c.b === `remote:${ip}`)!;
  assert.equal(talk(H.shop.ip).read, true);
  assert.equal(talk(H.shop.ip).clear, undefined);
  assert.equal(talk(H.api.ip).clear, undefined);
  assert.equal(talk(H.news.ip).clear?.proto, 'HTTP');
  assert.equal(talk(H.mail.ip).read, undefined);
  assert.equal(talk(H.shop.ip, without).read, undefined);
});

test('What could not be read is said: the encrypted conversations with no request read, by device', () => {
  assert.deepEqual(
    unreadOf(withKeys.conversations).map((u) => [u.device, u.conversations]),
    [[truth.unread.device, 1]],
  );
  const none = unreadOf(without.conversations);
  assert.deepEqual(none.map((u) => [u.device, u.conversations]).sort(), [[H.me.mac, 2], [H.phone.mac, 1]].sort());
});

test('Filtered by device, by domain (and the hosts under it), by method, by network', () => {
  const list = withKeys.requests!;
  assert.equal(list.filter((r) => matches(r, { device: H.phone.mac })).length, 1);
  assert.equal(list.filter((r) => matches(r, { host: 'example' })).length, list.length);
  assert.equal(list.filter((r) => matches(r, { host: 'shop.example' })).length, 3);
  assert.equal(list.filter((r) => matches(r, { method: 'post' })).length, 2);
  const net = list[0]!.network;
  assert.ok(net, 'each request is placed on the network of its stay');
  assert.equal(list.filter((r) => matches(r, { networks: new Set([net!]) })).length, list.length);
  assert.equal(list.filter((r) => matches(r, { networks: new Set(['net:elsewhere']) })).length, 0);
});

test("HTTP/2's header list cut into its blocks: by its pseudo-headers, trailers with the block before", () => {
  const n = [':method', ':path', 'user-agent', ':method', ':path', ':status', 'content-type', 'grpc-status'];
  const v = ['GET', '/', 'x', 'GET', '/b', '200', 'text/plain', '0'];
  assert.deepEqual(
    headerBlocks(n, v)?.map((b) => b.map(([k]) => k)),
    [[':method', ':path', 'user-agent'], [':method', ':path'], [':status', 'content-type', 'grpc-status']],
  );
  assert.equal(headerBlocks(['a'], []), undefined);
});

test('Bounded: the newest are kept past the ceiling; a frame whose blocks and HEADERS frames disagree is passed over', () => {
  const q = new Requests(3);
  const frame = (i: number) => (f: string) =>
    ({ 'http.request.method': ['GET'], 'http.request.full_uri': [`http://a.example/${i}`], 'http.host': ['a.example'], 'frame.number': [String(i)] })[f] ?? [];
  for (let i = 1; i <= 5; i++) q.add(frame(i), { time: i, iface: 'eth0', layers: ['eth', 'ip', 'tcp', 'http'] });
  assert.deepEqual(q.all().map((r) => r.url), ['http://a.example/3', 'http://a.example/4', 'http://a.example/5']);
  assert.equal(q.changed().length, 3);
  assert.equal(q.changed().length, 0);
  const odd = (f: string) => ({ 'http2.type': ['1', '1'], 'http2.streamid': ['1', '3'], 'http2.header.name': [':method', ':path'], 'http2.header.value': ['GET', '/'] })[f] ?? [];
  q.add(odd, { time: 9, iface: 'eth0', layers: ['eth', 'ip', 'tcp', 'tls', 'http2'] });
  assert.equal(q.all().length, 3);
  assert.ok(!q.all().some((r) => r.time === 9));
});

test('Kept with the session: a restart reads the requests back', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fieldArgs } = await import('../server/tally.ts');
  const t = new Tally({ ownMacs: [H.me.mac] });
  t.addText(execFileSync(TSHARK, ['-r', WEB, ...fieldArgs(KEYS)], { encoding: 'utf8' }));
  const back = Tally.load(JSON.parse(JSON.stringify(t.save())), { ownMacs: [H.me.mac] });
  assert.equal(back.view().requests?.length, truth.requests.length);
  assert.deepEqual(back.view().requests?.map((r) => r.url), t.view().requests?.map((r) => r.url));
});
