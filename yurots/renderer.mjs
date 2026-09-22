import { key } from "./protocol76.mjs";
export class Renderer76 {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.assets = assets;
    this.effects = [];
    this.texts = [];
    this.missiles = [];
  }
  camera(protocol) {
    const p = { ...protocol.position },
      walk = protocol.player?.walk;
    if (walk) {
      const t = Math.min(1, (performance.now() - walk.start) / walk.duration);
      p.x = walk.from.x + (walk.to.x - walk.from.x) * t;
      p.y = walk.from.y + (walk.to.y - walk.from.y) * t;
    }
    return p;
  }
  screen(p, camera) {
    const dz = camera.z - p.z;
    return {
      x: (p.x - camera.x + 7 - dz) * 32,
      y: (p.y - camera.y + 5 - dz) * 32,
    };
  }
  render(protocol) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#101615";
    ctx.fillRect(0, 0, 480, 352);
    if (!protocol?.position) return;
    const p = protocol.position,
      camera = this.camera(protocol),
      now = performance.now();
    let min = p.z > 7 ? p.z - 2 : 0,
      max = p.z > 7 ? Math.min(15, p.z + 2) : 7;
    // Hide roofs above the player, including the diagonally projected covering tile.
    for (let z = p.z - 1; z >= min; z--) {
      const dz = p.z - z;
      if (
        [
          { x: p.x, y: p.y, z },
          { x: p.x + dz, y: p.y + dz, z },
        ].some((pos) =>
          protocol.tiles
            .get(key(pos))
            ?.things.some(
              (t) =>
                t.kind === "item" && this.assets.flag(t.id, "DatFlagGround"),
            ),
        )
      ) {
        min = z + 1;
        break;
      }
    }
    const labels = [];
    for (let z = max; z >= min; z--) {
      for (let sy = -2; sy < 14; sy++)
        for (let sx = -2; sx < 18; sx++) {
          const dz = p.z - z,
            pos = { x: p.x - 7 + sx + dz, y: p.y - 5 + sy + dz, z };
          const tile = protocol.tiles.get(key(pos));
          if (!tile) continue;
          const screen = this.screen(pos, camera);
          let elevation = 0;
          const items = tile.things.filter((t) => t.kind === "item");
          const ground = items.filter((t) => this.assets.rank(t.id) < 3),
            down = items.filter((t) => this.assets.rank(t.id) === 5).reverse(),
            top = items.filter((t) => this.assets.rank(t.id) === 3);
          const drawItem = (t) => {
            this.assets.draw(
              ctx,
              t.id,
              screen.x - elevation,
              screen.y - elevation,
              { position: pos, count: t.count },
            );
            elevation = Math.min(
              24,
              elevation + (this.assets.get(t.id)?.properties.elevation || 0),
            );
          };
          ground.forEach(drawItem);
          down.forEach(drawItem);
          for (const c of tile.things.filter((t) => t.kind === "creature")) {
            const at = { ...pos };
            let frame = 0;
            if (c.walk) {
              const t = Math.min(1, (now - c.walk.start) / c.walk.duration);
              at.x = c.walk.from.x + (c.walk.to.x - c.walk.from.x) * t;
              at.y = c.walk.from.y + (c.walk.to.y - c.walk.from.y) * t;
              const f = this.assets.get(
                this.assets.data.itemCount + c.outfit.type,
              )?.frameGroups[0];
              if (t < 1 && f?.animationLength > 1)
                frame = 1 + (Math.floor(t * 4) % (f.animationLength - 1));
            }
            const cp = this.screen(at, camera),
              outfit = c.outfit;
            if (c.id === protocol.target) {
              ctx.strokeStyle = "#eb5855";
              ctx.lineWidth = 1;
              ctx.strokeRect(cp.x, cp.y, 32, 32);
            }
            if (outfit.type)
              this.assets.draw(
                ctx,
                this.assets.data.itemCount + outfit.type,
                cp.x - elevation,
                cp.y - elevation,
                { outfit, direction: c.direction, frame },
              );
            else if (outfit.item)
              this.assets.draw(
                ctx,
                outfit.item,
                cp.x - elevation,
                cp.y - elevation,
                { position: pos },
              );
            if (c.name && z === p.z)
              labels.push({ c, x: cp.x + 16 - elevation, y: cp.y - elevation });
          }
          top.forEach((t) =>
            this.assets.draw(ctx, t.id, screen.x, screen.y, {
              position: pos,
              count: t.count,
            }),
          );
        }
      if (z > p.z) {
        ctx.fillStyle = "rgba(0,0,0,.16)";
        ctx.fillRect(0, 0, 480, 352);
      }
    }
    this.effects = this.effects.filter((e) => {
      const def = this.assets.data.getAnimation(e.id),
        age = now - e.start,
        frame = Math.floor(age / 100);
      if (!def || frame >= def.frameGroups[0].animationLength) return false;
      const at = this.screen(e.position, camera);
      this.assets.draw(ctx, this.assets.data.getAnimationId(e.id), at.x, at.y, {
        frame,
      });
      return true;
    });
    this.missiles = this.missiles.filter((e) => {
      const t = (now - e.start) / 220;
      if (t >= 1) return false;
      const p = {
        x: e.from.x + (e.to.x - e.from.x) * t,
        y: e.from.y + (e.to.y - e.from.y) * t,
        z: e.from.z,
      };
      const at = this.screen(p, camera);
      this.assets.draw(
        ctx,
        this.assets.data.getDistanceAnimationId(e.id),
        at.x,
        at.y,
        {
          frame: 0,
          position: {
            x: Math.sign(e.to.x - e.from.x) + 1,
            y: Math.sign(e.to.y - e.from.y) + 1,
            z: 0,
          },
        },
      );
      return true;
    });
    ctx.font = "bold 10px Verdana";
    ctx.textAlign = "center";
    for (const { c, x, y } of labels) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#101010";
      ctx.strokeText(c.name, x, y - 9);
      ctx.fillStyle =
        c.health > 50 ? "#8be978" : c.health > 20 ? "#e4cf52" : "#e66560";
      ctx.fillText(c.name, x, y - 9);
      ctx.fillStyle = "#101010";
      ctx.fillRect(x - 14, y - 7, 28, 4);
      ctx.fillStyle = c.health > 50 ? "#56ce55" : "#de5749";
      ctx.fillRect(x - 13, y - 6, (26 * c.health) / 100, 2);
    }
    this.texts = this.texts.filter((e) => {
      const t = (now - e.start) / 1200;
      if (t >= 1) return false;
      const at = this.screen(e.position, camera);
      ctx.fillStyle = "#f3cc70";
      ctx.strokeStyle = "#111";
      ctx.strokeText(e.text, at.x + 16, at.y - t * 32);
      ctx.fillText(e.text, at.x + 16, at.y - t * 32);
      return true;
    });
  }
}
