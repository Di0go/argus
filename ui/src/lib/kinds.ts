// What a device probably is, from what it says of itself (its name, its model) and its maker: for its icon and a
// word. A guess, said as one: the facts are on its page.

import type { Device } from '../../../shared/types.ts';

export type DeviceKind = 'router' | 'this' | 'phone' | 'computer' | 'tv' | 'speaker' | 'board' | 'printer' | 'console' | 'camera' | 'watch' | 'tablet' | 'other';

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
  const text = [d.model, ...d.names.map((n) => n.name), d.vendor].filter(Boolean).join(' ');
  return RULES.find(([re]) => re.test(text))?.[1] ?? 'other';
}

export const KIND_WORD: Record<DeviceKind, string> = {
  router: 'Router',
  this: 'Este PC',
  phone: 'Telemóvel',
  computer: 'Computador',
  tv: 'Televisão ou box',
  speaker: 'Coluna',
  board: 'Placa ou sensor',
  printer: 'Impressora',
  console: 'Consola',
  camera: 'Câmara',
  watch: 'Relógio',
  tablet: 'Tablet',
  other: 'Dispositivo',
};

/** The line under a device's name: what it probably is, unless the name already says so ("Este PC", "Router
 * Tp-Link"); for this PC, its maker. */
export function subline(d: Device): string {
  const word = KIND_WORD[deviceKind(d)];
  if (d.role === 'self') return d.names[0]?.name ? 'Este PC' : (d.model ?? d.vendor ?? '');
  return d.name.toLowerCase().startsWith(word.toLowerCase()) ? (d.model ?? '') : word;
}
