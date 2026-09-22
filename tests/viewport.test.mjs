import test from "node:test";
import assert from "node:assert/strict";
import { viewGeometry, pointerToWorld } from "../yurots/viewport.mjs";

test("fullscreen viewport preserves square tiles within the server map", () => {
  for (const [width, height] of [
    [1920, 1018],
    [1440, 838],
    [1000, 698],
    [390, 782],
    [2560, 1018],
  ]) {
    const view = viewGeometry(width, height);
    assert(view.width <= 544);
    assert(view.height <= 416);
    assert.equal(view.width % 2, 0);
    assert.equal(view.height % 2, 0);
    assert(Math.abs(width / view.width / (height / view.height) - 1) < 0.005);
    assert(view.centerX <= 8);
    assert(view.centerY <= 6);
  }
});
test("world pointer inverse stays correct after desktop and portrait resizing", () => {
  for (const [width, height] of [
    [1440, 838],
    [390, 782],
  ]) {
    const view = viewGeometry(width, height),
      rect = { left: 0, top: 62, width, height },
      camera = { x: 134, y: 50, z: 7 };
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [-1, -2],
      [2, 1],
    ]) {
      const x = (((view.centerX + dx + 0.5) * 32) / view.width) * width;
      const y = 62 + (((view.centerY + dy + 0.5) * 32) / view.height) * height;
      assert.deepEqual(pointerToWorld(x, y, rect, view, camera), {
        x: 134 + dx,
        y: 50 + dy,
        z: 7,
      });
    }
  }
});
