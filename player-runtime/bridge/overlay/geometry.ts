// @ts-nocheck

function transformPoint(matrix, x, y) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.tx,
    y: matrix.b * x + matrix.d * y + matrix.ty,
  };
}

function spriteFrame(sprite) {
  const frame = sprite && (sprite._frame || sprite._realFrame);
  const width = Number(frame && frame.width) || Number(sprite.width) || 0;
  const height = Number(frame && frame.height) || Number(sprite.height) || 0;
  return {
    x: Number(frame && frame.x) || 0,
    y: Number(frame && frame.y) || 0,
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

export function roundCssPixel(value) {
  return Math.round(value * 2) / 2;
}

export function cssTransformFromTopLeftPoints(points, localWidth, localHeight) {
  if (!Array.isArray(points) || points.length !== 4) return null;

  const width = Number(localWidth);
  const height = Number(localHeight);
  if (!(width > 0) || !(height > 0)) return null;

  const cssPoints = points.map((point) => ({
    x: Number(point?.x),
    y: Number(point?.y),
  }));
  if (cssPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return null;
  }

  const [topLeft, topRight, , bottomLeft] = cssPoints;
  return {
    left: topLeft.x,
    top: topLeft.y,
    width,
    height,
    matrix: {
      a: (topRight.x - topLeft.x) / width,
      b: (topRight.y - topLeft.y) / width,
      c: (bottomLeft.x - topLeft.x) / height,
      d: (bottomLeft.y - topLeft.y) / height,
    },
    bounds: {
      left: Math.min(...cssPoints.map((point) => point.x)),
      top: Math.min(...cssPoints.map((point) => point.y)),
      right: Math.max(...cssPoints.map((point) => point.x)),
      bottom: Math.max(...cssPoints.map((point) => point.y)),
    },
  };
}

export function displayObjectIsVisible(object) {
  let current = object;
  let guard = 0;
  while (current && guard++ < 30) {
    if (
      current.visible === false ||
      current.renderable === false ||
      current.alpha === 0
    ) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

export function rectsIntersect(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function boundsIntersectRect(bounds, rect) {
  return (
    bounds.left < rect.right &&
    bounds.top < rect.bottom &&
    bounds.right > rect.left &&
    bounds.bottom > rect.top
  );
}

export function intersectRects(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function ownerWorldPosition(owner) {
  let x = 0;
  let y = 0;
  let current = owner;
  let guard = 0;
  while (current && guard++ < 20) {
    x += Number(current.x) || 0;
    y += Number(current.y) || 0;
    current = current.parent;
  }
  return { x, y };
}

export function findBitmapSprite(owner, bitmap) {
  if (!owner || !bitmap) return null;
  const queue = Array.isArray(owner.children) ? [...owner.children] : [];
  const seen = new Set();
  while (queue.length && seen.size < 3000) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (current.bitmap === bitmap || current._bitmap === bitmap) return current;
    if (Array.isArray(current.children)) queue.push(...current.children);
  }
  return null;
}

function contentSpriteFor(owner, bitmap) {
  const candidates = [
    owner && owner._windowContentsSprite,
    owner && owner._contentsSprite,
  ];
  const matching = candidates.find(
    (sprite) => sprite && sprite.bitmap === bitmap,
  );
  return matching || findBitmapSprite(owner, bitmap) || candidates.find(Boolean) || null;
}

export function contentGeometry(entry) {
  const owner = entry.owner;
  const sprite = contentSpriteFor(owner, entry.bitmap);
  if (sprite) {
    const position = ownerWorldPosition(sprite);
    const frame = spriteFrame(sprite);
    const anchorX = Number(sprite.anchor?.x) || 0;
    const anchorY = Number(sprite.anchor?.y) || 0;
    return {
      x: position.x - anchorX * frame.width,
      y: position.y - anchorY * frame.height,
      originX: frame.x,
      originY: frame.y,
      visibleWidth: frame.width,
      visibleHeight: frame.height,
    };
  }

  const ownerPos = ownerWorldPosition(owner);
  const padding = Number(owner.padding) || 0;
  const originX = owner.origin ? Number(owner.origin.x) || 0 : 0;
  const originY = owner.origin ? Number(owner.origin.y) || 0 : 0;
  return {
    x: ownerPos.x + padding,
    y: ownerPos.y + padding,
    originX,
    originY,
    visibleWidth: Math.max(
      0,
      (Number(owner.width) || Number(owner._width) || 0) - padding * 2,
    ),
    visibleHeight: Math.max(
      0,
      (Number(owner.height) || Number(owner._height) || 0) - padding * 2,
    ),
  };
}

export function displayObjectPageBounds(
  object,
  canvasRect,
  canvasWidth,
  canvasHeight,
) {
  if (!object || !displayObjectIsVisible(object)) return null;
  const frame = spriteFrame(object);
  if (frame.width <= 0 || frame.height <= 0) return null;
  const anchorX = Number(object.anchor?.x) || 0;
  const anchorY = Number(object.anchor?.y) || 0;
  const matrix = object.worldTransform || object.transform?.worldTransform;
  let points;
  if (
    matrix &&
    [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty].every(
      Number.isFinite,
    )
  ) {
    const left = -anchorX * frame.width;
    const top = -anchorY * frame.height;
    points = [
      transformPoint(matrix, left, top),
      transformPoint(matrix, left + frame.width, top),
      transformPoint(matrix, left + frame.width, top + frame.height),
      transformPoint(matrix, left, top + frame.height),
    ];
  } else {
    const position = ownerWorldPosition(object);
    const left = position.x - anchorX * frame.width;
    const top = position.y - anchorY * frame.height;
    points = [
      { x: left, y: top },
      { x: left + frame.width, y: top },
      { x: left + frame.width, y: top + frame.height },
      { x: left, y: top + frame.height },
    ];
  }

  const cssScaleX =
    canvasRect.width / (Number(canvasWidth) || canvasRect.width || 1);
  const cssScaleY =
    canvasRect.height / (Number(canvasHeight) || canvasRect.height || 1);
  const cssPoints = points.map((point) => ({
    x: canvasRect.left + point.x * cssScaleX,
    y: canvasRect.top + point.y * cssScaleY,
  }));
  const left = Math.min(...cssPoints.map((point) => point.x));
  const top = Math.min(...cssPoints.map((point) => point.y));
  const right = Math.max(...cssPoints.map((point) => point.x));
  const bottom = Math.max(...cssPoints.map((point) => point.y));
  return {
    left: roundCssPixel(left),
    top: roundCssPixel(top),
    width: roundCssPixel(Math.max(1, right - left)),
    height: roundCssPixel(Math.max(1, bottom - top)),
  };
}

export function hashText(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}
