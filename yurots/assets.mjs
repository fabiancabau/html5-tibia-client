// Reuse the upstream client's DAT reader, SPR atlas, frame groups and outfit compositor.
export class Assets76 {
  constructor() {
    this.data = new ObjectBuffer();
    this.sprites = new SpriteBuffer(64);
    this.data.__createLoopedAnimations = () => {}; // Native 7.6 renderer owns effect lifetimes.
    globalThis.gameClient = {
      clientVersion: 760,
      spriteBuffer: this.sprites,
      dataObjects: this.data,
      renderer: { __nMiliseconds: 0 },
      interface: { loadAssetCallback() {} },
    };
    this.loaded = false;
  }
  async load(dat, spr) {
    if (!dat || !spr) {
      const responses = await Promise.all(
        ["Tibia.dat", "Tibia.spr"].map((f) => fetch(`data/76/${f}`)),
      );
      if (responses.some((r) => !r.ok))
        throw new Error("Select your Tibia 7.6 .dat and .spr files to play.");
      [dat, spr] = await Promise.all(responses.map((r) => r.arrayBuffer()));
    }
    if (
      new DataView(dat).getUint32(0, true) !== 0x439d5a33 ||
      new DataView(spr).getUint32(0, true) !== 0x439852be
    )
      throw new Error("These files are not the supported Tibia 7.6 assets.");
    this.sprites.clear();
    this.sprites.__spriteAddressPointers = {};
    this.data.dataObjects = {};
    this.sprites.__load("Tibia.spr", spr);
    this.data.__load("Tibia.dat", dat);
    this.loaded = true;
  }
  get(id) {
    return this.data.get(id);
  }
  flag(id, name) {
    return !!this.get(id)?.flags.get(PropBitFlag.prototype.flags[name]);
  }
  hasSubtype(id) {
    return ["DatFlagStackable", "DatFlagFluidContainer", "DatFlagSplash"].some(
      (f) => this.flag(id, f),
    );
  }
  rank(id) {
    return this.flag(id, "DatFlagGround")
      ? 0
      : this.flag(id, "DatFlagGroundBorder")
        ? 1
        : this.flag(id, "DatFlagOnBottom")
          ? 2
          : this.flag(id, "DatFlagOnTop")
            ? 3
            : 5;
  }
  draw(
    ctx,
    id,
    x,
    y,
    {
      position = { x: 0, y: 0, z: 0 },
      count = 1,
      frame = null,
      direction = 0,
      outfit = null,
    } = {},
  ) {
    const data = this.get(id);
    if (!data) return;
    const f = data.frameGroups[0];
    if (frame === null)
      frame = outfit
        ? 0
        : Math.floor(performance.now() / 200) % f.animationLength;
    frame %= f.animationLength;
    let px = outfit ? direction % f.pattern.x : position.x % f.pattern.x,
      py = outfit ? 0 : position.y % f.pattern.y,
      pz = position.z % f.pattern.z;
    if (
      this.flag(id, "DatFlagStackable") &&
      f.pattern.x === 4 &&
      f.pattern.y === 2
    ) {
      const n =
        count < 5
          ? count - 1
          : count < 10
            ? 4
            : count < 25
              ? 5
              : count < 50
                ? 6
                : 7;
      px = n % 4;
      py = Math.floor(n / 4);
    }
    if (
      this.flag(id, "DatFlagFluidContainer") ||
      this.flag(id, "DatFlagSplash")
    ) {
      const color = [0, 1, 5, 3, 6, 8, 2, 4][count % 8] || 0;
      px = color % f.pattern.x;
      py = Math.floor(color / f.pattern.x) % f.pattern.y;
    }
    const displacement = data.properties.displacement || { x: 0, y: 0 };
    for (let h = 0; h < f.height; h++)
      for (let w = 0; w < f.width; w++) {
        let sprite;
        if (outfit && f.layers > 1) {
          const cache = `outfit:${id}:${outfit.head}:${outfit.body}:${outfit.legs}:${outfit.feet}:${direction}:${frame}:${w}:${h}`;
          if (!this.sprites.has(cache)) {
            const base = f.getSpriteId(frame, px, py, pz, 0, w, h),
              mask = f.getSpriteId(frame, px, py, pz, 1, w, h);
            if (!base) continue;
            if (mask) {
              const look = new Outfit({ id, details: outfit });
              this.sprites.addComposed(
                this.sprites.reserve(cache),
                look,
                base,
                mask,
              );
            } else sprite = this.sprites.get(base);
          }
          sprite ||= this.sprites.get(cache);
          if (sprite)
            ctx.drawImage(
              sprite.src,
              sprite.position.x * 32,
              sprite.position.y * 32,
              32,
              32,
              x - w * 32 - displacement.x,
              y - h * 32 - displacement.y,
              32,
              32,
            );
        } else
          for (let layer = 0; layer < f.layers; layer++) {
            sprite = this.sprites.get(
              f.getSpriteId(frame, px, py, pz, layer, w, h),
            );
            if (sprite)
              ctx.drawImage(
                sprite.src,
                sprite.position.x * 32,
                sprite.position.y * 32,
                32,
                32,
                x - w * 32 - displacement.x,
                y - h * 32 - displacement.y,
                32,
                32,
              );
          }
      }
  }
}
