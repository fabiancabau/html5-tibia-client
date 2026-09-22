import { Reader, Writer } from "./bytes.mjs";
import { stepDuration } from "./movement.mjs";
export const key = (p) => `${p.x},${p.y},${p.z}`;
export const equal = (a, b) =>
  a && b && a.x === b.x && a.y === b.y && a.z === b.z;
export const moves = {
  north: 0x65,
  east: 0x66,
  south: 0x67,
  west: 0x68,
  northeast: 0x6a,
  southeast: 0x6b,
  southwest: 0x6c,
  northwest: 0x6d,
};

export class Protocol76 {
  constructor(assets, emit = () => {}) {
    this.assets = assets;
    this.emit = emit;
    this.tiles = new Map();
    this.creatures = new Map();
    this.inventory = new Map();
    this.containers = new Map();
    this.vip = new Map();
    this.position = null;
    this.playerId = null;
    this.stats = {};
    this.skills = [];
    this.icons = 0;
    this.target = 0;
    this.packets = 0;
    this.opcodes = new Set();
    this.pendingMove = false;
    this.huntState = { active: false };
  }
  get player() {
    return this.creatures.get(this.playerId);
  }
  thing(r) {
    const type = r.u16();
    if (type === 0x61 || type === 0x62) {
      let id, creature;
      if (type === 0x61) {
        this.creatures.delete(r.u32());
        id = r.u32();
        creature = { kind: "creature", id, name: r.string() };
      } else {
        id = r.u32();
        creature = this.creatures.get(id);
        if (!creature) throw new Error(`Unknown creature ${id}`);
      }
      Object.assign(creature, {
        health: r.u8(),
        direction: r.u8(),
        outfit: this.outfit(r),
        light: r.u8(),
        lightColor: r.u8(),
        speed: r.u16(),
        skull: r.u8(),
        shield: r.u8(),
      });
      this.creatures.set(id, creature);
      return creature;
    }
    if (type === 0x63) {
      const id = r.u32(),
        direction = r.u8();
      const creature = this.creatures.get(id);
      if (!creature) throw new Error(`Turn for unknown creature ${id}`);
      creature.direction = direction;
      return creature;
    }
    const def = this.assets.get(type);
    if (!def) throw new Error(`Missing 7.6 item definition ${type}`);
    return {
      kind: "item",
      id: type,
      count: this.assets.hasSubtype(type) ? r.u8() : 1,
    };
  }
  outfit(r) {
    const type = r.u8();
    return type
      ? { type, head: r.u8(), body: r.u8(), legs: r.u8(), feet: r.u8() }
      : { type: 0, item: r.u16() };
  }
  setTile(p, things) {
    this.tiles.set(key(p), { position: { ...p }, things });
    for (const t of things) if (t.kind === "creature") t.position = { ...p };
  }
  tile(r, p) {
    const things = [];
    while (r.peek16() < 0xff00) {
      if (things.length >= 10) throw new Error("Invalid tile stack");
      things.push(this.thing(r));
    }
    const skip = r.u16() & 255;
    this.setTile(p, things);
    return skip;
  }
  map(r, x, y, z, width, height) {
    let skip = 0;
    const floors =
      z > 7
        ? Array.from(
            { length: Math.min(15, z + 2) - (z - 2) + 1 },
            (_, i) => z - 2 + i,
          )
        : [7, 6, 5, 4, 3, 2, 1, 0];
    for (const floor of floors)
      for (let dx = 0; dx < width; dx++)
        for (let dy = 0; dy < height; dy++) {
          const p = { x: x + dx + z - floor, y: y + dy + z - floor, z: floor };
          if (skip) {
            this.setTile(p, []);
            skip--;
          } else skip = this.tile(r, p);
        }
  }
  insert(p, thing) {
    const tile = this.tiles.get(key(p)) || { position: { ...p }, things: [] };
    // No stack index on 7.6 tile-add. Recreate the server's ground/top/creatures/down order.
    const rank = (t) => (t.kind === "creature" ? 4 : this.assets.rank(t.id));
    let i = 0;
    while (i < tile.things.length && rank(tile.things[i]) < rank(thing)) i++;
    if (thing.kind === "creature")
      while (i < tile.things.length && tile.things[i].kind === "creature") i++;
    tile.things.splice(i, 0, thing);
    tile.things.length = Math.min(10, tile.things.length);
    this.setTile(p, tile.things);
  }
  prune() {
    const p = this.position;
    for (const [k, t] of this.tiles)
      if (
        Math.abs(t.position.x - p.x) > 24 ||
        Math.abs(t.position.y - p.y) > 24 ||
        Math.abs(t.position.z - p.z) > 8
      )
        this.tiles.delete(k);
  }
  parse(bytes) {
    const r = new Reader(bytes);
    this.packets++;
    // YurOTS sends creature movement first, then map strips using old X / new Y.
    let oldSelf = null;
    while (r.remaining) {
      const offset = r.offset,
        op = r.u8();
      this.opcodes.add(op);
      switch (op) {
        case 0xf0: {
          const version = r.u8();
          if (version !== 1) throw new Error("Unknown hunt message version");
          const data = JSON.parse(r.string());
          if (data.event === "state") this.huntState = data;
          this.emit("hunt", data);
          break;
        }
        case 0x0a:
          this.playerId = r.u32();
          this.beat = r.u16();
          this.canReport = r.u8();
          this.emit("login");
          break;
        case 0x14:
        case 0x15:
          this.emit("error", r.string());
          break;
        case 0x16: {
          const message = r.string(),
            seconds = r.u8();
          this.emit("error", `${message} Retry in ${seconds}s.`);
          break;
        }
        case 0x1e:
          this.emit("send", new Writer(0x1e).data);
          break;
        case 0x28:
          this.emit("death");
          break;
        case 0x64: {
          oldSelf = null;
          this.position = r.pos();
          this.tiles.clear();
          // A full map replaces the scene (stairs/teleports/login). A cached
          // walk belongs to the previous scene and must not move this camera.
          for (const creature of this.creatures.values()) delete creature.walk;
          const p = this.position;
          this.map(r, p.x - 8, p.y - 6, p.z, 18, 14);
          this.pendingMove = false;
          this.emit("map");
          break;
        }
        case 0x65:
        case 0x66:
        case 0x67:
        case 0x68: {
          const p = this.position;
          if (!p) throw new Error("Map strip before initial map");
          // YurOTS follows the self 0x6d move with strips; do not move twice.
          if (!oldSelf) {
            if (op === 0x65) p.y--;
            if (op === 0x67) p.y++;
            if (op === 0x66) p.x++;
            if (op === 0x68) p.x--;
          }
          const x =
            op === 0x66
              ? p.x + 9
              : op === 0x68
                ? p.x - 8
                : (oldSelf?.x ?? p.x) - 8;
          const y = op === 0x67 ? p.y + 7 : p.y - 6;
          this.map(
            r,
            x,
            y,
            p.z,
            op === 0x65 || op === 0x67 ? 18 : 1,
            op === 0x65 || op === 0x67 ? 1 : 14,
          );
          this.pendingMove = false;
          this.emit("move");
          break;
        }
        case 0x69: {
          const p = r.pos();
          this.tile(r, p);
          break;
        }
        case 0x6a: {
          const p = r.pos();
          const thing = this.thing(r);
          if (thing.kind === "creature") delete thing.walk;
          this.insert(p, thing);
          break;
        }
        case 0x6b: {
          const p = r.pos(),
            index = r.u8(),
            thing = this.thing(r);
          const tile = this.tiles.get(key(p));
          if (tile) {
            tile.things[index] = thing;
            if (thing.kind === "creature") thing.position = p;
          }
          break;
        }
        case 0x6c: {
          const p = r.pos(),
            index = r.u8();
          this.tiles.get(key(p))?.things.splice(index, 1);
          break;
        }
        case 0x6d: {
          const from = r.pos(),
            index = r.u8(),
            to = r.pos(),
            tile = this.tiles.get(key(from));
          const thing = tile?.things.splice(index, 1)[0];
          if (!thing || thing.kind !== "creature")
            throw new Error(
              `Missing moving creature at ${key(from)} stack ${index}`,
            );
          thing.direction =
            to.y < from.y ? 0 : to.y > from.y ? 2 : to.x > from.x ? 1 : 3;
          thing.walk = {
            from,
            to,
            start: performance.now(),
            duration:
              stepDuration(this.assets, this.tiles.get(key(to)), thing.speed) *
              (thing.id === this.playerId && to.x !== from.x && to.y !== from.y
                ? 2
                : 1),
          };
          this.insert(to, thing);
          if (thing.id === this.playerId) {
            oldSelf = { ...from };
            this.position = { ...to };
            this.pendingMove = false;
            this.emit("move");
          }
          break;
        }
        case 0x6e: {
          const id = r.u8(),
            item = r.u16(),
            name = r.string(),
            capacity = r.u8(),
            parent = !!r.u8(),
            count = r.u8(),
            items = [];
          for (let i = 0; i < count; i++) items.push(this.thing(r));
          this.containers.set(id, { id, item, name, capacity, parent, items });
          this.emit("containers");
          break;
        }
        case 0x6f:
          this.containers.delete(r.u8());
          this.emit("containers");
          break;
        case 0x70: {
          const id = r.u8(),
            item = this.thing(r);
          this.containers.get(id)?.items.unshift(item);
          this.emit("containers");
          break;
        }
        case 0x71: {
          const id = r.u8(),
            index = r.u8(),
            item = this.thing(r);
          const c = this.containers.get(id);
          if (c) c.items[index] = item;
          this.emit("containers");
          break;
        }
        case 0x72: {
          const id = r.u8(),
            index = r.u8();
          this.containers.get(id)?.items.splice(index, 1);
          this.emit("containers");
          break;
        }
        case 0x78: {
          const slot = r.u8();
          this.inventory.set(slot, this.thing(r));
          this.emit("inventory");
          break;
        }
        case 0x79:
          this.inventory.delete(r.u8());
          this.emit("inventory");
          break;
        case 0x7d:
        case 0x7e: {
          const name = r.string(),
            count = r.u8(),
            items = [];
          for (let i = 0; i < count; i++) items.push(this.thing(r));
          this.emit("trade", { name, items, own: op === 0x7d });
          break;
        }
        case 0x7f:
          this.emit("tradeClose");
          break;
        case 0x82:
          this.light = { level: r.u8(), color: r.u8() };
          break;
        case 0x83:
          this.emit("effect", {
            position: r.pos(),
            id: r.u8(),
            start: performance.now(),
          });
          break;
        case 0x84:
          this.emit("text", {
            position: r.pos(),
            color: r.u8(),
            text: r.string(),
            start: performance.now(),
          });
          break;
        case 0x85:
          this.emit("missile", {
            from: r.pos(),
            to: r.pos(),
            id: r.u8(),
            start: performance.now(),
          });
          break;
        case 0x86: {
          const id = r.u32(),
            color = r.u8();
          this.emit("square", { id, color });
          break;
        }
        case 0x8c: {
          const c = this.creatures.get(r.u32()),
            health = r.u8();
          if (c) c.health = health;
          break;
        }
        case 0x8d: {
          const c = this.creatures.get(r.u32()),
            light = r.u8(),
            lightColor = r.u8();
          if (c) Object.assign(c, { light, lightColor });
          break;
        }
        case 0x8e: {
          const c = this.creatures.get(r.u32()),
            outfit = this.outfit(r);
          if (c) c.outfit = outfit;
          break;
        }
        case 0x8f: {
          const c = this.creatures.get(r.u32()),
            speed = r.u16();
          if (c) c.speed = speed;
          break;
        }
        case 0x90:
        case 0x91: {
          const c = this.creatures.get(r.u32()),
            value = r.u8();
          if (c) c[op === 0x90 ? "skull" : "shield"] = value;
          break;
        }
        case 0x96:
          this.emit("book", {
            id: r.u32(),
            item: r.u16(),
            maxLength: r.u16(),
            text: r.string(),
            writer: r.string(),
          });
          break;
        case 0x97:
          this.emit("house", { type: r.u8(), id: r.u32(), text: r.string() });
          break;
        case 0xa0: {
          this.stats = {
            health: r.u16(),
            maxHealth: r.u16(),
            capacity: r.u16(),
            experience: r.u32(),
            level: r.u16(),
            levelPercent: r.u8(),
            mana: r.u16(),
            maxMana: r.u16(),
            magicLevel: r.u8(),
            magicPercent: r.u8(),
            soul: r.u8(),
          };
          this.emit("stats");
          break;
        }
        case 0xa1:
          this.skills = Array.from({ length: 7 }, () => ({
            level: r.u8(),
            percent: r.u8(),
          }));
          this.emit("stats");
          break;
        case 0xa2:
          this.icons = r.u8();
          break;
        case 0xa3:
          this.target = 0;
          break;
        case 0xaa: {
          const name = r.string(),
            type = r.u8();
          let position, channel;
          if ([1, 2, 3, 16, 17].includes(type)) position = r.pos();
          else if ([5, 10, 14].includes(type)) channel = r.u16();
          this.emit("message", {
            name,
            type,
            position,
            channel,
            text: r.string(),
          });
          break;
        }
        case 0xab: {
          const channels = Array.from({ length: r.u8() }, () => ({
            id: r.u16(),
            name: r.string(),
          }));
          this.emit("channels", channels);
          break;
        }
        case 0xac:
        case 0xb2:
          this.emit("channel", { id: r.u16(), name: r.string() });
          break;
        case 0xad:
          this.emit("private", r.string());
          break;
        case 0xb3:
          this.emit("channelClose", r.u16());
          break;
        case 0xb4:
          this.emit("message", { type: r.u8(), text: r.string() });
          break;
        case 0xb5: {
          const direction = r.u8();
          if (this.player) this.player.direction = direction;
          this.pendingMove = false;
          this.emit("cancelWalk");
          break;
        }
        case 0xc8:
          this.emit("outfit", {
            current: this.outfit(r),
            first: r.u8(),
            last: r.u8(),
          });
          break;
        case 0xd2: {
          const id = r.u32();
          this.vip.set(id, { id, name: r.string(), online: !!r.u8() });
          this.emit("vip");
          break;
        }
        case 0xd3:
        case 0xd4: {
          const c = this.vip.get(r.u32());
          if (c) c.online = op === 0xd3;
          this.emit("vip");
          break;
        }
        default:
          throw new Error(
            `Unsupported 7.6 opcode 0x${op.toString(16)} at ${offset}`,
          );
      }
    }
    if (this.position) this.prune();
    this.emit("update");
  }
}
