// WebSocket messages contain exactly one unencrypted Tibia 7.6 payload.
// Only this transport boundary deals with the TCP uint16 length prefix.
export class Framer {
  constructor(onPacket, maxSize = 16766) {
    this.pending = Buffer.alloc(0);
    this.onPacket = onPacket;
    this.maxSize = maxSize;
  }
  push(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 2) {
      const size = this.pending.readUInt16LE(0);
      if (!size || size > this.maxSize)
        throw new Error("Invalid Tibia packet length");
      if (this.pending.length < size + 2) return;
      const packet = this.pending.subarray(2, size + 2);
      this.pending = this.pending.subarray(size + 2);
      this.onPacket(packet);
    }
  }
}
export function frame(payload) {
  if (!payload.length || payload.length > 16766)
    throw new Error("Invalid Tibia packet length");
  const header = Buffer.alloc(2);
  header.writeUInt16LE(payload.length);
  return Buffer.concat([header, payload]);
}
