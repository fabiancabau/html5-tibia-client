// Stay inside the 18x14 rectangle sent by YurOTS, with one tile for scrolling.
// Changing the window crops the view rather than stretching the world tiles.
export function viewGeometry(cssWidth, cssHeight) {
  const width = Math.max(1, cssWidth),
    height = Math.max(1, cssHeight);
  const scale = Math.max(width / 544, height / 416);
  const bufferWidth = Math.max(32, Math.round(width / scale / 2) * 2);
  const bufferHeight = Math.max(32, Math.round(height / scale / 2) * 2);
  return {
    width: bufferWidth,
    height: bufferHeight,
    centerX: (bufferWidth / 32 - 1) / 2,
    centerY: (bufferHeight / 32 - 1) / 2,
  };
}

export function pointerToWorld(clientX, clientY, rect, view, camera) {
  if (!rect.width || !rect.height) return null;
  return {
    x: Math.floor(
      (((clientX - rect.left) / rect.width) * view.width) / 32 +
        camera.x -
        view.centerX,
    ),
    y: Math.floor(
      (((clientY - rect.top) / rect.height) * view.height) / 32 +
        camera.y -
        view.centerY,
    ),
    z: camera.z,
  };
}
