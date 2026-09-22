// Tibia 7.6 strings are byte strings (Latin-1), with a uint16 length.
export class Reader {
  constructor(bytes) {
    this.bytes = new Uint8Array(bytes);
    this.offset = 0;
  }
  get remaining() {
    return this.bytes.length - this.offset;
  }
  need(n) {
    if (n > this.remaining)
      throw new Error(
        `Truncated packet at ${this.offset}: need ${n}, have ${this.remaining}`,
      );
  }
  u8() {
    this.need(1);
    return this.bytes[this.offset++];
  }
  u16() {
    return this.u8() | (this.u8() << 8);
  }
  peek16() {
    this.need(2);
    return this.bytes[this.offset] | (this.bytes[this.offset + 1] << 8);
  }
  u32() {
    return (this.u16() + this.u16() * 65536) >>> 0;
  }
  string() {
    const n = this.u16();
    this.need(n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  pos() {
    return { x: this.u16(), y: this.u16(), z: this.u8() };
  }
}
export class Writer {
  constructor(opcode) {
    this.bytes = [];
    if (opcode !== undefined) this.u8(opcode);
  }
  u8(n) {
    this.bytes.push(n & 255);
    return this;
  }
  u16(n) {
    return this.u8(n).u8(n >> 8);
  }
  u32(n) {
    return this.u16(n).u16(n >>> 16);
  }
  string(s) {
    if (s.length > 65535) throw new Error("String too long");
    this.u16(s.length);
    for (const c of s) {
      if (c.codePointAt(0) > 255)
        throw new Error("Use Latin-1 text with this server");
      this.u8(c.charCodeAt(0));
    }
    return this;
  }
  pos(p) {
    return this.u16(p.x).u16(p.y).u8(p.z);
  }
  get data() {
    return Uint8Array.from(this.bytes);
  }
}
export function loginPacket(account, password) {
  return new Writer(1)
    .u16(2)
    .u16(760)
    .u32(0x439d5a33)
    .u32(0x439852be)
    .u32(0)
    .u32(account)
    .string(password).data;
}
export function gamePacket(account, password, name) {
  return new Writer(10)
    .u16(2)
    .u16(760)
    .u8(0)
    .u32(account)
    .string(name)
    .string(password).data;
}
export function readLogin(bytes) {
  const r = new Reader(bytes),
    result = { characters: [], motd: "", premiumDays: 0 };
  while (r.remaining) {
    const op = r.u8();
    if (op === 10) throw new Error(r.string());
    if (op === 20) result.motd = r.string();
    else if (op === 100) {
      const count = r.u8();
      for (let i = 0; i < count; i++) {
        const name = r.string(),
          world = r.string(),
          ip = r.u32(),
          port = r.u16();
        result.characters.push({ name, world, ip, port });
      }
      result.premiumDays = r.u16();
    } else if (op !== 20) throw new Error(`Unknown login opcode ${op}`);
  }
  return result;
}
