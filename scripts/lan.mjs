import { networkInterfaces } from 'node:os';

/** Private IPv4 addresses of this laptop (Wi-Fi or Ethernet), skipping virtual adapters where possible. */
export function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback/i.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push({ name, address: a.address });
    }
  }
  // Wi-Fi first: it is the adapter a friend's laptop on the same network reaches.
  return out.sort((a, b) => Number(/wi-?fi|wlan/i.test(b.name)) - Number(/wi-?fi|wlan/i.test(a.name)));
}
