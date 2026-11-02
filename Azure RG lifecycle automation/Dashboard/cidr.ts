export interface Block {
  start: number;
  prefix: number;
}

const TOTAL = 2 ** 32;

export function parseCidr(cidr: string): Block {
  const [ip, bits] = cidr.trim().split("/");
  const octets = ip.split(".").map(Number);
  const prefix = Number(bits);
  const valid =
    octets.length === 4 &&
    octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255) &&
    Number.isInteger(prefix) &&
    prefix >= 0 &&
    prefix <= 32;
  if (!valid) throw new Error(`Invalid CIDR: ${cidr}`);
  const raw = octets.reduce((acc, o) => acc * 256 + o, 0);
  const size = blockSize(prefix);
  return { start: Math.floor(raw / size) * size, prefix };
}

export function blockSize(prefix: number) {
  return 2 ** (32 - prefix);
}

export function formatCidr(block: Block) {
  const octets: number[] = [];
  let n = block.start;
  for (let i = 0; i < 4; i++) {
    octets.unshift(n % 256);
    n = Math.floor(n / 256);
  }
  return `${octets.join(".")}/${block.prefix}`;
}

export function overlaps(a: string, b: string) {
  const x = parseCidr(a);
  const y = parseCidr(b);
  const xEnd = x.start + blockSize(x.prefix);
  const yEnd = y.start + blockSize(y.prefix);
  return x.start < yEnd && y.start < xEnd;
}

export function sameCidr(a: string, b: string) {
  return formatCidr(parseCidr(a)) === formatCidr(parseCidr(b));
}

export function allocateFromPools(
  pools: string[],
  prefix: number,
  taken: string[],
): string | null {
  const size = blockSize(prefix);
  for (const pool of pools) {
    const p = parseCidr(pool);
    if (prefix < p.prefix) continue;
    const end = Math.min(p.start + blockSize(p.prefix), TOTAL);
    for (let start = p.start; start + size <= end; start += size) {
      const candidate = formatCidr({ start, prefix });
      if (!taken.some((t) => overlaps(t, candidate))) return candidate;
    }
  }
  return null;
}

export function carveSubnets(
  vnetCidr: string,
  subnets: { name: string; prefix: number }[],
) {
  const vnet = parseCidr(vnetCidr);
  const vnetEnd = vnet.start + blockSize(vnet.prefix);
  const ordered = [...subnets].sort((a, b) => a.prefix - b.prefix);
  let cursor = vnet.start;
  const carved = new Map<string, string>();
  for (const s of ordered) {
    const size = blockSize(s.prefix);
    cursor = Math.ceil(cursor / size) * size;
    if (cursor + size > vnetEnd) {
      throw new Error(`Subnets do not fit in ${vnetCidr}`);
    }
    carved.set(s.name, formatCidr({ start: cursor, prefix: s.prefix }));
    cursor += size;
  }
  return subnets.map((s) => ({ name: s.name, cidr: carved.get(s.name)! }));
}
