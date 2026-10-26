// What a device probably is, from what it says of itself (its name, its model) and its maker: for its icon and a
// word. A guess, said as one: the facts are on its page.

import type { Device } from './types.ts';

export type DeviceKind = 'router' | 'this' | 'phone' | 'computer' | 'tv' | 'speaker' | 'board' | 'printer' | 'console' | 'camera' | 'watch' | 'tablet' | 'container' | 'other';

const RULES: [RegExp, DeviceKind][] = [
  [/iphone|android|galaxy|pixel|redmi|xiaomi|oneplus|oppo|huawei|motorola|nokia|smartphone|phone/i, 'phone'],
  [/ipad|tablet|kindle/i, 'tablet'],
  [/watch/i, 'watch'],
  [/chromecast|cast|meo ?box|appletv|apple tv|roku|fire ?tv|\btv\b|bravia|webos|android tv|shield|uhd|qled|oled|crystal|smart ?tv/i, 'tv'],
  [/sonos|echo|alexa|homepod|nest audio|google home|nest mini|speaker/i, 'speaker'],
  [/raspberry|esp32|espressif|arduino|tasmota|shelly|tuya/i, 'board'],
  [/printer|hp ?inc|epson|canon|brother|laserjet|deskjet/i, 'printer'],
  [/playstation|ps[345]|xbox|nintendo|switch|steam ?deck/i, 'console'],
  [/camera|ring|arlo|wyze|hikvision|dahua|reolink/i, 'camera'],
  [/desktop|laptop|macbook|imac|thinkpad|surface|dell|lenovo|asus|acer|msi|intel|windows|pc\b/i, 'computer'],
];

export function deviceKind(d: Device): DeviceKind {
  if (d.role === 'gateway') return 'router';
  if (d.role === 'self') return 'this';
  // What shared/identify.ts judged, when it judged anything.
  if (d.identity && d.identity.kind !== 'other') return d.identity.kind;
  const text = [d.model, ...d.names.map((n) => n.name), d.vendor].filter(Boolean).join(' ');
  return RULES.find(([re]) => re.test(text))?.[1] ?? 'other';
}

export const KIND_WORD: Record<DeviceKind, string> = {
  router: 'Router',
  this: 'This PC',
  phone: 'Phone',
  computer: 'Computer',
  tv: 'TV or box',
  speaker: 'Speaker',
  board: 'Board or sensor',
  printer: 'Printer',
  console: 'Console',
  camera: 'Camera',
  watch: 'Watch',
  tablet: 'Tablet',
  container: 'Container',
  other: 'Device',
};

/** The line under a device's name: what it probably is, unless the name already says so ("This PC", "Router
 * Tp-Link"); for this PC, its maker. */
export function subline(d: Device): string {
  if (d.identity && d.role !== 'gateway') return d.identity.label;
  const word = KIND_WORD[deviceKind(d)];
  if (d.role === 'self') return d.names[0]?.name ? 'This PC' : (d.model ?? d.vendor ?? '');
  return d.name.toLowerCase().startsWith(word.toLowerCase()) ? (d.model ?? '') : word;
}
