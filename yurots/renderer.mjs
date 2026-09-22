import { key } from "./protocol76.mjs";
import { viewGeometry, pointerToWorld } from "./viewport.mjs";
import {
  creaturePose,
  creatureDepthPosition,
  compareTileDepth,
  samePosition,
} from "./render-state.mjs";
export class Renderer76 {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.assets = assets;
    this.effects = [];
    this.texts = [];
    this.missiles = [];
    this.view = { width: 480, height: 352, centerX: 7, centerY: 5 };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const next = viewGeometry(rect.width, rect.height);
    if (this.canvas.width !== next.width) this.canvas.width = next.width;
    if (this.canvas.height !== next.height) this.canvas.height = next.height;
    this.view = next;
  }
  worldPosition(clientX, clientY, protocol) {
    if (!protocol?.position) return null;
    return pointerToWorld(
      clientX,
      clientY,
      this.canvas.getBoundingClientRect(),
      this.view,
      this.camera(protocol),
    );
  }
  camera(protocol, now = performance.now()) {
    if (protocol.player && samePosition(protocol.player.position, protocol.position))
      return creaturePose(protocol.player, now).position;
    return { ...protocol.position };
  }

  screen(p, camera) {
    const dz = camera.z - p.z;
    return {
      x: Math.round((p.x - camera.x + this.view.centerX - dz) * 32),
      y: Math.round((p.y - camera.y + this.view.centerY - dz) * 32),
    };
  }
  drawFloor(protocol, z, camera, now, labels) {
    const p = protocol.position;
    const entries = new Map();
    for (let sy = -2; sy < 14; sy++)
      for (let sx = -2; sx < 18; sx++) {
        const dz = p.z - z;
        const position = { x: p.x - 7 + sx + dz, y: p.y - 5 + sy + dz, z };
        const tile = protocol.tiles.get(key(position));
        if (tile)
          entries.set(key(position), {
            position,
            tile,
            creatures: [],
            elevation: 0,
          });
      }
    const tiles = [...entries.values()].sort((a, b) =>
      compareTileDepth(a.position, b.position),
    );
    const seen = new Set();
    for (const entry of tiles) {
      for (const creature of entry.tile.things) {
        if (creature.kind !== "creature" || seen.has(creature.id)) continue;
        seen.add(creature.id);
        const pose = creaturePose(creature, now);
        const id = creature.outfit.type
          ? this.assets.data.itemCount + creature.outfit.type
          : creature.outfit.item;
        const displacement = this.assets.get(id)?.properties.displacement;
        const depth = creatureDepthPosition(creature, pose, displacement);
        const depthKey = key(depth);
        if (!entries.has(depthKey))
          entries.set(depthKey, {
            position: depth,
            tile: { things: [] },
            creatures: [],
            elevation: 0,
          });
        entries.get(depthKey).creatures.push({ creature, pose });
      }
    }
    // Every walkable surface on this floor is underneath its creatures. In
    // particular, the old/source tile must never repaint an interpolating actor.
    for (const entry of tiles) {
      for (const item of entry.tile.things) {
        if (item.kind === "item" && this.assets.rank(item.id) < 2)
          this.drawItem(item, entry, camera);
      }
    }
    const scene = [...entries.values()].sort((a, b) =>
      compareTileDepth(a.position, b.position),
    );
    for (const entry of scene) {
      const items = entry.tile.things.filter((t) => t.kind === "item");
      items
        .filter((t) => this.assets.rank(t.id) === 2)
        .forEach((t) => this.drawItem(t, entry, camera));
      items
        .filter((t) => this.assets.rank(t.id) === 5)
        .reverse()
        .forEach((t) => this.drawItem(t, entry, camera));
      for (const { creature, pose } of entry.creatures)
        this.drawCreature(
          creature,
          pose,
          entry.elevation,
          camera,
          protocol,
          labels,
        );
      const at = this.screen(entry.position, camera);
      for (const item of items.filter((t) => this.assets.rank(t.id) === 3))
        this.assets.draw(this.ctx, item.id, at.x, at.y, {
          position: entry.position,
          count: item.count,
        });
    }
  }

  drawItem(item, entry, camera) {
    const at = this.screen(entry.position, camera);
    this.assets.draw(
      this.ctx,
      item.id,
      at.x - entry.elevation,
      at.y - entry.elevation,
      { position: entry.position, count: item.count },
    );
    entry.elevation = Math.min(
      24,
      entry.elevation + (this.assets.get(item.id)?.properties.elevation || 0),
    );
  }

  drawCreature(creature, pose, elevation, camera, protocol, labels) {
    const outfit = creature.outfit;
    const at = this.screen(pose.position, camera);
    const id = outfit.type
      ? this.assets.data.itemCount + outfit.type
      : outfit.item;
    let frame = 0;
    const frames = this.assets.get(id)?.frameGroups[0].animationLength || 1;
    if (pose.walking && frames > 1)
      frame = 1 + (Math.floor(pose.progress * 4) % (frames - 1));
    if (creature.id === protocol.target) {
      this.ctx.strokeStyle = "#eb5855";
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(at.x, at.y, 32, 32);
    }
    if (id)
      this.assets.draw(
        this.ctx,
        id,
        at.x - elevation,
        at.y - elevation,
        outfit.type
          ? { outfit, direction: creature.direction, frame }
          : { position: pose.position },
      );
    if (creature.name && pose.position.z === protocol.position.z)
      labels.push({
        c: creature,
        x: at.x + 16 - elevation,
        y: at.y - elevation,
      });
  }

  render(protocol, now = performance.now()) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#101615";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!protocol?.position) return;
    const p = protocol.position,
      camera = this.camera(protocol, now);
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
      this.drawFloor(protocol, z, camera, now, labels);
      if (z > p.z) {
        ctx.fillStyle = "rgba(0,0,0,.16)";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
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
