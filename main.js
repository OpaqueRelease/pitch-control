// Interactive football pitch control visualization
// -------------------------------------------------
// Two teams of 11 players (blue / red) are draggable.
// The pitch is colored based on which player is closest to each point.

const CANVAS_ID = "pitchCanvas";

// Use a logical pitch size with football-like aspect ratio
// Standard: 105m x 68m ≈ 105:68 ≈ 1.54
const LOGICAL_WIDTH = 1050; // logical units for calculations
const LOGICAL_HEIGHT = 680;

// Resolution used when calculating control areas on a lower‑res buffer.
// Smaller step -> higher resolution (smoother) but more CPU work.
// We use a slightly coarser grid and then upscale it with smoothing to
// keep performance high while preserving soft boundaries.
const GRID_STEP = 3;

// Player visual properties
const PLAYER_RADIUS = 10;
const PLAYER_OUTLINE_WIDTH = 2;
const PLAYER_STROKE_STYLE = "#020617";
// How far around a player you can hover/grab (multiplier of radius)
const HIT_RADIUS_FACTOR = 2.0;
// Velocity / arrow rendering configuration
const MAX_SPEED_VIS = 35; // logical speed corresponding to max arrow length
const INITIAL_SPEED = 18; // default starting speed magnitude
const ARROW_HIT_RADIUS_FACTOR = 1.6; // relative to circle radius, for arrow hit test

// Team colors
const BLUE_COLOR = "#3b82f6";
const RED_COLOR = "#ef4444";

// Slight transparent control color to blend with pitch lines
const CONTROL_BLUE_RGBA = "rgba(59, 130, 246, 0.28)";
// Make red-controlled regions visually strong, clearly red
const CONTROL_RED_RGBA = "rgba(255, 0, 0, 0.46)";
// Contested areas (similar distance to both teams)
const CONTROL_CONTESTED_RGBA = "rgba(255, 255, 255, 0.7)";

// Pitch line style
const PITCH_LINE_COLOR = "rgba(226, 232, 240, 0.85)";
const PITCH_LINE_WIDTH = 2;

/** @type {HTMLCanvasElement | null} */
let canvas = null;
/** @type {CanvasRenderingContext2D | null} */
let ctx = null;

let deviceRatio = window.devicePixelRatio || 1;

// Offscreen canvas used for control map (lower resolution, then upscaled)
/** @type {HTMLCanvasElement | null} */
let controlCanvas = null;
/** @type {CanvasRenderingContext2D | null} */
let controlCtx = null;
let controlWidth = 0;
let controlHeight = 0;

// Player model
/**
 * @typedef {"blue" | "red"} Team
 *
 * @typedef Player
 * @property {number} id
 * @property {Team} team
 * @property {number} x // logical coordinate
 * @property {number} y // logical coordinate
 * @property {number} vx // logical velocity (delta per frame) in x
 * @property {number} vy // logical velocity (delta per frame) in y
 */

/** @type {Player[]} */
let players = [];

// Drag state
let draggingPlayerId = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let hoveredPlayerId = null;
let draggingArrowPlayerId = null;

// Feature flags
let arrowsEnabled = true;

// Simple render throttling: batch multiple updates into a single frame
let renderQueued = false;

window.addEventListener("DOMContentLoaded", () => {
  canvas = /** @type {HTMLCanvasElement} */ (
    document.getElementById(CANVAS_ID)
  );

  if (!canvas) return;

  ctx = canvas.getContext("2d");
  if (!ctx) return;

  setupCanvasSize();
  initPlayers();
  attachInteractionHandlers();

  // Hook up arrows toggle
  const arrowsCheckbox = document.getElementById("toggleArrows");
  if (arrowsCheckbox instanceof HTMLInputElement) {
    arrowsCheckbox.checked = arrowsEnabled;
    arrowsCheckbox.addEventListener("change", () => {
      arrowsEnabled = arrowsCheckbox.checked;
      if (!arrowsEnabled) {
        draggingArrowPlayerId = null;
      }
      requestRender();
    });
  }

  // First render
  renderAll();

  // Recompute layout on resize
  window.addEventListener("resize", () => {
    setupCanvasSize();
    requestRender();
  });
});

// ---- Setup & model -------------------------------------------------------

function setupCanvasSize() {
  if (!canvas) return;

  const parentRect = canvas.parentElement?.getBoundingClientRect();

  const availableWidth = parentRect ? parentRect.width : window.innerWidth;
  const aspect = LOGICAL_WIDTH / LOGICAL_HEIGHT;
  const targetWidth = availableWidth;
  const targetHeight = targetWidth / aspect;

  canvas.style.width = `${targetWidth}px`;
  canvas.style.height = `${targetHeight}px`;

  deviceRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(targetWidth * deviceRatio);
  canvas.height = Math.round(targetHeight * deviceRatio);

  if (ctx) {
    ctx.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
  }

  // Force control buffer to be re-created at the new size
  controlCanvas = null;
  controlCtx = null;
  controlWidth = 0;
  controlHeight = 0;
}

function initPlayers() {
  players = [];

  // Arrange players in classic 4-4-2 style starting positions, mirrored
  // along the vertical axis for blue vs red.
  //
  // Positions given as fractions of pitch (0..1).
  const blueFormation = [
    // Goalkeeper
    { x: 0.08, y: 0.5 },
    // Defenders (back line)
    { x: 0.22, y: 0.18 },
    { x: 0.22, y: 0.38 },
    { x: 0.22, y: 0.62 },
    { x: 0.22, y: 0.82 },
    // Midfield
    { x: 0.4, y: 0.16 },
    { x: 0.4, y: 0.35 },
    { x: 0.4, y: 0.65 },
    { x: 0.4, y: 0.84 },
    // Forwards
    { x: 0.64, y: 0.35 },
    { x: 0.64, y: 0.65 },
  ];

  const redFormation = blueFormation.map((p) => ({
    x: 1 - p.x,
    y: p.y,
  }));

  let idCounter = 1;
  for (const p of blueFormation) {
    players.push({
      id: idCounter++,
      team: "blue",
      x: p.x * LOGICAL_WIDTH,
      y: p.y * LOGICAL_HEIGHT,
      // Initial movement: toward opposition goal (to the right)
      vx: INITIAL_SPEED,
      vy: 0,
    });
  }
  for (const p of redFormation) {
    players.push({
      id: idCounter++,
      team: "red",
      x: p.x * LOGICAL_WIDTH,
      y: p.y * LOGICAL_HEIGHT,
      // Initial movement: toward opposition goal (to the left)
      vx: -INITIAL_SPEED,
      vy: 0,
    });
  }
}

// ---- Rendering -----------------------------------------------------------

function renderAll() {
  if (!ctx || !canvas) return;

  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw base pitch
  drawGrassGradient();
  drawPitchLines();

  // Draw control heatmap
  drawControlAreas();

  // Draw players on top
  drawPlayers();
}

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  window.requestAnimationFrame(() => {
    renderQueued = false;
    renderAll();
  });
}

function drawGrassGradient() {
  if (!ctx || !canvas) return;

  const w = canvas.width / deviceRatio;
  const h = canvas.height / deviceRatio;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#15803d");
  grad.addColorStop(0.45, "#16a34a");
  grad.addColorStop(0.9, "#14532d");

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Add subtle mowing stripes
  const stripes = 10;
  const stripeWidth = h / stripes;
  ctx.save();
  ctx.globalAlpha = 0.20;
  ctx.fillStyle = "#16a34a";
  for (let i = 0; i < stripes; i += 2) {
    ctx.fillRect(0, i * stripeWidth, w, stripeWidth);
  }
  ctx.restore();
}

function drawPitchLines() {
  if (!ctx || !canvas) return;

  const w = canvas.width / deviceRatio;
  const h = canvas.height / deviceRatio;

  const scaleX = w / LOGICAL_WIDTH;
  const scaleY = h / LOGICAL_HEIGHT;

  const lineWidth = PITCH_LINE_WIDTH;

  ctx.save();
  ctx.strokeStyle = PITCH_LINE_COLOR;
  ctx.lineWidth = lineWidth;

  // Outer rectangle
  ctx.strokeRect(
    lineWidth,
    lineWidth,
    w - 2 * lineWidth,
    h - 2 * lineWidth
  );

  // Halfway line
  const midX = w / 2;
  ctx.beginPath();
  ctx.moveTo(midX, 0);
  ctx.lineTo(midX, h);
  ctx.stroke();

  // Centre circle
  const centerCircleRadius = 9.15 * scaleX * (LOGICAL_WIDTH / 105); // approx 9.15m radius
  ctx.beginPath();
  ctx.arc(midX, h / 2, centerCircleRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Centre spot
  ctx.beginPath();
  ctx.fillStyle = PITCH_LINE_COLOR;
  ctx.arc(midX, h / 2, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // Penalty boxes
  const penaltyBoxDepth = 16.5 * scaleX * (LOGICAL_WIDTH / 105);
  const penaltyBoxWidth = 40.32 * scaleY * (LOGICAL_HEIGHT / 68);

  const sixY = (h - penaltyBoxWidth) / 2;
  const sixH = penaltyBoxWidth;

  // Left penalty box
  ctx.strokeRect(0, sixY, penaltyBoxDepth, sixH);
  // Right penalty box
  ctx.strokeRect(w - penaltyBoxDepth, sixY, penaltyBoxDepth, sixH);

  // Goal boxes
  const goalBoxDepth = 5.5 * scaleX * (LOGICAL_WIDTH / 105);
  const goalBoxWidth = 18.32 * scaleY * (LOGICAL_HEIGHT / 68);

  const goalY = (h - goalBoxWidth) / 2;
  const goalH = goalBoxWidth;

  ctx.strokeRect(0, goalY, goalBoxDepth, goalH);
  ctx.strokeRect(w - goalBoxDepth, goalY, goalBoxDepth, goalH);

  // Penalty spots
  const penaltyDistance = 11 * scaleX * (LOGICAL_WIDTH / 105);
  ctx.beginPath();
  ctx.arc(penaltyDistance, h / 2, 1.8, 0, Math.PI * 2);
  ctx.arc(w - penaltyDistance, h / 2, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Penalty arcs
  const penaltyArcRadius = 9.15 * scaleX * (LOGICAL_WIDTH / 105);
  // Left
  ctx.beginPath();
  ctx.arc(
    penaltyDistance,
    h / 2,
    penaltyArcRadius,
    -0.3 * Math.PI,
    0.3 * Math.PI,
    false
  );
  ctx.stroke();
  // Right
  ctx.beginPath();
  ctx.arc(
    w - penaltyDistance,
    h / 2,
    penaltyArcRadius,
    0.7 * Math.PI,
    1.3 * Math.PI,
    false
  );
  ctx.stroke();

  ctx.restore();
}

function drawControlAreas() {
  if (!ctx || !canvas) return;

  const w = canvas.width / deviceRatio;
  const h = canvas.height / deviceRatio;

  const scaleX = LOGICAL_WIDTH / w;
  const scaleY = LOGICAL_HEIGHT / h;

  // Pre-compute players by team
  const bluePlayers = players.filter((p) => p.team === "blue");
  const redPlayers = players.filter((p) => p.team === "red");

  if (!bluePlayers.length && !redPlayers.length) return;

  // Prepare / resize offscreen buffer
  const offW = Math.max(1, Math.round(w / GRID_STEP));
  const offH = Math.max(1, Math.round(h / GRID_STEP));

  if (!controlCanvas || controlWidth !== offW || controlHeight !== offH) {
    controlCanvas = document.createElement("canvas");
    controlCanvas.width = offW;
    controlCanvas.height = offH;
    controlCtx = controlCanvas.getContext("2d");
    controlWidth = offW;
    controlHeight = offH;
    if (controlCtx) {
      controlCtx.imageSmoothingEnabled = true;
    }
  }

  if (!controlCtx || !controlCanvas) return;

  // Clear previous frame
  controlCtx.clearRect(0, 0, offW, offH);

  // Draw the control map onto the low‑res buffer, one cell per pixel.
  for (let oy = 0; oy < offH; oy++) {
    for (let ox = 0; ox < offW; ox++) {
      // Sample at the centre of each coarse cell in logical coordinates
      const x = (ox + 0.5) * GRID_STEP;
      const y = (oy + 0.5) * GRID_STEP;
      const lx = x * scaleX;
      const ly = y * scaleY;

      // Find nearest blue and red players separately using either
      // pure distance or an arrival "cost" that factors in both
      // distance and current velocity / movement direction.
      let minBlueSq = Infinity;
      for (const p of bluePlayers) {
        const costSq = arrowsEnabled
          ? arrivalCostSquared(p, lx, ly)
          : ((p.x - lx) * (p.x - lx) + (p.y - ly) * (p.y - ly));
        if (costSq < minBlueSq) minBlueSq = costSq;
      }

      let minRedSq = Infinity;
      for (const p of redPlayers) {
        const costSq = arrowsEnabled
          ? arrivalCostSquared(p, lx, ly)
          : ((p.x - lx) * (p.x - lx) + (p.y - ly) * (p.y - ly));
        if (costSq < minRedSq) minRedSq = costSq;
      }

      // If only one team has players, let that team control everything.
      if (!isFinite(minBlueSq) && !isFinite(minRedSq)) continue;

      if (!isFinite(minRedSq)) {
        // Only blue on the pitch
        controlCtx.fillStyle = CONTROL_BLUE_RGBA;
      } else if (!isFinite(minBlueSq)) {
        // Only red on the pitch
        controlCtx.fillStyle = CONTROL_RED_RGBA;
      } else {
        // Both teams present: compute how "contested" the point is.
        const minSq = Math.min(minBlueSq, minRedSq);
        const maxSq = Math.max(minBlueSq, minRedSq);
        const ratioSq = minSq / maxSq; // 0..1

        const blueControls = minBlueSq <= minRedSq;

        // Soften the transition to white so the contested borders look smooth
        // rather than like hard polygons.
        const START_FADE_RATIO_SQUARED = 0.45; // start blending towards white
        const FULL_WHITE_RATIO_SQUARED = 0.9;  // almost equal distance -> very white

        // Determine how much to fade the team colour towards white.
        let t; // 0 => pure team colour, 1 => very white/contested
        if (ratioSq <= START_FADE_RATIO_SQUARED) {
          t = 0;
        } else if (ratioSq >= FULL_WHITE_RATIO_SQUARED) {
          t = 1;
        } else {
          t =
            (ratioSq - START_FADE_RATIO_SQUARED) /
            (FULL_WHITE_RATIO_SQUARED - START_FADE_RATIO_SQUARED);
        }

        // Base RGB + alpha for the controlling team
        const baseR = blueControls ? 59 : 255;
        const baseG = blueControls ? 130 : 0;
        const baseB = blueControls ? 246 : 0;
        const baseAlpha = blueControls ? 0.28 : 0.46;

        // Linearly blend the colour towards a softer light tone and a
        // slightly lower alpha so contested regions "shine" less.
        const targetR = 235;
        const targetG = 240;
        const targetB = 245;
        const targetAlpha = 0.55;

        const r = Math.round(baseR * (1 - t) + targetR * t);
        const g = Math.round(baseG * (1 - t) + targetG * t);
        const b = Math.round(baseB * (1 - t) + targetB * t);
        const alpha = baseAlpha * (1 - t) + targetAlpha * t;

        controlCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
      }

      controlCtx.fillRect(ox, oy, 1, 1);
    }
  }

  // Now upscale the low-res control buffer onto the main canvas with
  // smoothing, which visually softens the boundaries between cells.
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(controlCanvas, 0, 0, w, h);
  ctx.restore();
}

/**
 * Approximate "time to arrive" cost for a player to reach (lx, ly),
 * taking into account both distance and the player's current velocity
 * direction. Lower cost means arriving sooner.
 *
 * We avoid real units and use a biased distance that is shorter when the
 * player is already moving toward the point and longer when moving away.
 *
 * @param {Player} p
 * @param {number} lx
 * @param {number} ly
 * @returns {number} squared cost (monotonic with time)
 */
function arrivalCostSquared(p, lx, ly) {
  const dx = lx - p.x;
  const dy = ly - p.y;
  const distSq = dx * dx + dy * dy;
  if (distSq === 0) return 0;

  const dist = Math.sqrt(distSq);
  const dirX = dx / dist;
  const dirY = dy / dist;

  // Component of current velocity along the direction to the point.
  const speedAlong = p.vx * dirX + p.vy * dirY;

  // Limit how strongly velocity can bias arrival, to keep shapes stable.
  const MAX_V_EFFECT = 25;
  const clampedSpeed = Math.max(-MAX_V_EFFECT, Math.min(MAX_V_EFFECT, speedAlong));

  // Positive clampedSpeed (moving toward) effectively shortens distance;
  // negative (moving away) lengthens it slightly.
  const VELOCITY_INFLUENCE = 0.6;
  const biasedDist = dist - VELOCITY_INFLUENCE * clampedSpeed;
  const effectiveDist = Math.max(0, biasedDist);

  return effectiveDist * effectiveDist;
}

/**
 * @param {number} lx
 * @param {number} ly
 * @returns {Player | null}
 */
function findNearestPlayer(lx, ly) {
  let best = null;
  let bestDistSq = Infinity;

  for (const p of players) {
    const dx = p.x - lx;
    const dy = p.y - ly;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      best = p;
    }
  }
  return best;
}

function drawPlayers() {
  if (!ctx || !canvas) return;

  const w = canvas.width / deviceRatio;
  const h = canvas.height / deviceRatio;

  const scaleX = w / LOGICAL_WIDTH;
  const scaleY = h / LOGICAL_HEIGHT;

  ctx.save();
  ctx.lineWidth = PLAYER_OUTLINE_WIDTH;
  ctx.strokeStyle = PLAYER_STROKE_STYLE;

  for (const p of players) {
    const cx = p.x * scaleX;
    const cy = p.y * scaleY;

    const isHovered = p.id === hoveredPlayerId;
    const isDragging = p.id === draggingPlayerId || p.id === draggingArrowPlayerId;
    const radius = (isHovered || isDragging) ? PLAYER_RADIUS * 1.25 : PLAYER_RADIUS;

    // Glow halo
    ctx.save();
    ctx.globalAlpha = 0.35;
    const glowGrad = ctx.createRadialGradient(
      cx,
      cy,
      radius * 0.2,
      cx,
      cy,
      radius * 2.4
    );
    if (p.team === "blue") {
      glowGrad.addColorStop(0, "rgba(191, 219, 254, 0.9)");
      glowGrad.addColorStop(1, "rgba(37, 99, 235, 0)");
    } else {
      glowGrad.addColorStop(0, "rgba(254, 202, 202, 0.9)");
      glowGrad.addColorStop(1, "rgba(248, 113, 113, 0)");
    }
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Core circle
    const grad = ctx.createRadialGradient(
      cx - radius * 0.4,
      cy - radius * 0.4,
      radius * 0.2,
      cx,
      cy,
      radius
    );
    if (p.team === "blue") {
      grad.addColorStop(0, "#dbeafe");
      grad.addColorStop(0.4, BLUE_COLOR);
      grad.addColorStop(1, "#1d4ed8");
    } else {
      grad.addColorStop(0, "#fee2e2");
      grad.addColorStop(0.4, RED_COLOR);
      grad.addColorStop(1, "#b91c1c");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    if (isHovered) {
      ctx.lineWidth = PLAYER_OUTLINE_WIDTH + 1.5;
      ctx.strokeStyle = "#facc15";
    } else if (isDragging) {
      ctx.lineWidth = PLAYER_OUTLINE_WIDTH + 1;
      ctx.strokeStyle = "#e5e7eb";
    }
    ctx.stroke();
    ctx.restore();

    // Velocity arrow: indicates direction and magnitude of movement.
    const speedSq = p.vx * p.vx + p.vy * p.vy;
    if (arrowsEnabled && speedSq > 1) {
      const speed = Math.sqrt(speedSq);
      const ux = p.vx / speed;
      const uy = p.vy / speed;

      // Allow reasonably long arrows but keep them visually tidy.
      // Previously: PLAYER_RADIUS * 2.8; now 50% longer.
      const maxArrowLen = PLAYER_RADIUS * 4.2;
      const factor = Math.min(1, speed / MAX_SPEED_VIS);
      const arrowLen = maxArrowLen * factor;

      const endX = cx + ux * arrowLen;
      const endY = cy + uy * arrowLen;

      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle =
        p.team === "blue" ? "rgba(191, 219, 254, 0.9)" : "rgba(254, 202, 202, 0.9)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Arrow head
      const headLen = 6;
      const angle = Math.atan2(uy, ux);
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - headLen * Math.cos(angle - Math.PI / 6),
        endY - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        endX - headLen * Math.cos(angle + Math.PI / 6),
        endY - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fillStyle =
        p.team === "blue" ? "rgba(191, 219, 254, 0.9)" : "rgba(254, 202, 202, 0.9)";
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
}

// ---- Interaction ---------------------------------------------------------

function attachInteractionHandlers() {
  if (!canvas) return;

  // Mouse
  canvas.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  canvas.addEventListener("mouseleave", onPointerLeave);

  // Touch
  canvas.addEventListener("touchstart", onPointerDown, { passive: false });
  window.addEventListener("touchmove", onPointerMove, { passive: false });
  window.addEventListener("touchend", onPointerUp);
  window.addEventListener("touchcancel", onPointerUp);
}

/**
 * @param {MouseEvent | TouchEvent} e
 */
function getPointerPosition(e) {
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  let clientX, clientY;

  if (e instanceof TouchEvent) {
    if (!e.touches.length) return null;
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const x = clientX - rect.left;
  const y = clientY - rect.top;

  const w = rect.width;
  const h = rect.height;

  const lx = (x / w) * LOGICAL_WIDTH;
  const ly = (y / h) * LOGICAL_HEIGHT;

  return { lx, ly, x, y };
}

/**
 * @param {MouseEvent | TouchEvent} e
 */
function onPointerDown(e) {
  if (!canvas) return;

  const pos = getPointerPosition(e);
  if (!pos) return;

  const { lx, ly, x, y } = pos;

  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const scaleX = w / LOGICAL_WIDTH;
  const scaleY = h / LOGICAL_HEIGHT;

  const centerHitRadius = PLAYER_RADIUS * HIT_RADIUS_FACTOR;
  const arrowHitRadius = PLAYER_RADIUS * ARROW_HIT_RADIUS_FACTOR;

  let selectedPlayerForMove = null;
  let selectedPlayerForArrow = null;
  let bestCenterDist = Infinity;
  let bestArrowDist = Infinity;

  // Search from top-most player down
  for (let i = players.length - 1; i >= 0; i--) {
    const p = players[i];
    const cx = p.x * scaleX;
    const cy = p.y * scaleY;

    // Centre hit test (for moving player)
    const dcx = cx - x;
    const dcy = cy - y;
    const centerDist = Math.sqrt(dcx * dcx + dcy * dcy);
    if (centerDist <= centerHitRadius && centerDist < bestCenterDist) {
      bestCenterDist = centerDist;
      selectedPlayerForMove = p;
    }

    // Arrow tip hit test (for adjusting velocity) – only when arrows are enabled
    if (arrowsEnabled) {
      const speedSq = p.vx * p.vx + p.vy * p.vy;
      if (speedSq > 1) {
        const speed = Math.sqrt(speedSq);
        const ux = p.vx / speed;
        const uy = p.vy / speed;
        const maxArrowLen = PLAYER_RADIUS * 4.2;
        const factor = Math.min(1, speed / MAX_SPEED_VIS);
        const arrowLen = maxArrowLen * factor;
        const tipX = cx + ux * arrowLen;
        const tipY = cy + uy * arrowLen;

        const dax = tipX - x;
        const day = tipY - y;
        const arrowDist = Math.sqrt(dax * dax + day * day);
        if (arrowDist <= arrowHitRadius && arrowDist < bestArrowDist) {
          bestArrowDist = arrowDist;
          selectedPlayerForArrow = p;
        }
      }
    }
  }

  let foundMove = selectedPlayerForMove;
  let foundArrow = arrowsEnabled ? selectedPlayerForArrow : null;

  // Prefer arrow drag when clicking close to an arrow tip; otherwise move.
  if (foundArrow) {
    draggingArrowPlayerId = foundArrow.id;
    draggingPlayerId = null;
  } else if (foundMove) {
    draggingPlayerId = foundMove.id;
    draggingArrowPlayerId = null;
  } else {
    return;
  }

  if (e.cancelable) {
    e.preventDefault();
  }

  canvas.style.cursor = "grabbing";

  if (draggingPlayerId != null) {
    const p = foundMove;
    if (!p) return;
    dragOffsetX = lx - p.x;
    dragOffsetY = ly - p.y;
  }
}

/**
 * @param {MouseEvent | TouchEvent} e
 */
function onPointerMove(e) {
  if (!canvas) return;

  const pos = getPointerPosition(e);
  if (!pos) return;

  if (e.cancelable) {
    e.preventDefault();
  }

  const { lx, ly } = pos;

  // If dragging an arrow, update player velocity based on pointer direction
  if (arrowsEnabled && draggingArrowPlayerId != null) {
    const player = players.find((p) => p.id === draggingArrowPlayerId);
    if (!player) return;

    const dx = lx - player.x;
    const dy = ly - player.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < 1) {
      player.vx = 0;
      player.vy = 0;
    } else {
      const dist = Math.sqrt(distSq);
      const ux = dx / dist;
      const uy = dy / dist;
      const speed = Math.min(dist, MAX_SPEED_VIS);
      player.vx = ux * speed;
      player.vy = uy * speed;
    }

    requestRender();
    return;
  }

  // If dragging a player, move them and re-render
  if (draggingPlayerId != null) {
    const player = players.find((p) => p.id === draggingPlayerId);
    if (!player) return;

    // Update player position with clamping inside pitch
    const newX = lx - dragOffsetX;
    const newY = ly - dragOffsetY;

    player.x = clamp(
      newX,
      PLAYER_RADIUS * 1.5,
      LOGICAL_WIDTH - PLAYER_RADIUS * 1.5
    );
    player.y = clamp(
      newY,
      PLAYER_RADIUS * 1.5,
      LOGICAL_HEIGHT - PLAYER_RADIUS * 1.5
    );

    // Re-render visualization as the player moves (throttled)
    requestRender();
    return;
  }

  // Not dragging: update hovered player for highlight + cursor
  const hitRadius = PLAYER_RADIUS * HIT_RADIUS_FACTOR;
  let found = null;
  for (let i = players.length - 1; i >= 0; i--) {
    const p = players[i];
    const dx = p.x - lx;
    const dy = p.y - ly;
    if (Math.sqrt(dx * dx + dy * dy) <= hitRadius) {
      found = p;
      break;
    }
  }

  const newHoveredId = found ? found.id : null;
  if (newHoveredId === hoveredPlayerId) {
    return;
  }

  hoveredPlayerId = newHoveredId;

  if (hoveredPlayerId != null) {
    canvas.style.cursor = "grab";
  } else if (draggingPlayerId == null) {
    canvas.style.cursor = "default";
  }

  // Re-render only when hovered target changes
  requestRender();
}

/**
 * @param {MouseEvent | TouchEvent} e
 */
function onPointerUp(e) {
  if (draggingPlayerId == null && draggingArrowPlayerId == null) return;
  if (canvas) {
    canvas.style.cursor = "default";
  }
  draggingPlayerId = null;
  draggingArrowPlayerId = null;
}

function onPointerLeave() {
  if (!canvas) return;
  hoveredPlayerId = null;
  if (draggingPlayerId == null && draggingArrowPlayerId == null) {
    canvas.style.cursor = "default";
  }
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}


