// Interactive football pitch control visualization
// -------------------------------------------------
// Two teams of 11 players (blue / red) are draggable.
// The pitch is colored based on which player is closest to each point.

const CANVAS_ID = "pitchCanvas";

// Use a logical pitch size with football-like aspect ratio
// Standard: 105m x 68m ≈ 105:68 ≈ 1.54
const LOGICAL_WIDTH = 1050; // logical units for calculations
const LOGICAL_HEIGHT = 680;

// Resolution used when calculating control areas
// (we don't need per-pixel; a step grid is much faster)
// Smaller step -> higher resolution (smoother) but more CPU work.
// 1 = ultra-fine resolution (per logical pixel).
const GRID_STEP = 1;

// Player visual properties
const PLAYER_RADIUS = 10;
const PLAYER_OUTLINE_WIDTH = 2;
const PLAYER_STROKE_STYLE = "#020617";

// Team colors
const BLUE_COLOR = "#3b82f6";
const RED_COLOR = "#ef4444";

// Slight transparent control color to blend with pitch lines
const CONTROL_BLUE_RGBA = "rgba(59, 130, 246, 0.28)";
// Make red-controlled regions visually strong, clearly red
const CONTROL_RED_RGBA = "rgba(255, 0, 0, 0.46)";

// Pitch line style
const PITCH_LINE_COLOR = "rgba(226, 232, 240, 0.85)";
const PITCH_LINE_WIDTH = 2;

/** @type {HTMLCanvasElement | null} */
let canvas = null;
/** @type {CanvasRenderingContext2D | null} */
let ctx = null;

let deviceRatio = window.devicePixelRatio || 1;

// Player model
/**
 * @typedef {"blue" | "red"} Team
 *
 * @typedef Player
 * @property {number} id
 * @property {Team} team
 * @property {number} x // logical coordinate
 * @property {number} y // logical coordinate
 */

/** @type {Player[]} */
let players = [];

// Drag state
let draggingPlayerId = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

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

  // First render
  renderAll();

  // Recompute layout on resize
  window.addEventListener("resize", () => {
    setupCanvasSize();
    renderAll();
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
    });
  }
  for (const p of redFormation) {
    players.push({
      id: idCounter++,
      team: "red",
      x: p.x * LOGICAL_WIDTH,
      y: p.y * LOGICAL_HEIGHT,
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

  // Pre-compute players by team for small speed gain
  const bluePlayers = players.filter((p) => p.team === "blue");
  const redPlayers = players.filter((p) => p.team === "red");

  if (!bluePlayers.length || !redPlayers.length) return;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  for (let y = 0; y < h; y += GRID_STEP) {
    for (let x = 0; x < w; x += GRID_STEP) {
      // Convert to logical coordinates
      const lx = x * scaleX;
      const ly = y * scaleY;

      const nearest = findNearestPlayer(lx, ly);
      if (!nearest) continue;

      ctx.fillStyle =
        nearest.team === "blue" ? CONTROL_BLUE_RGBA : CONTROL_RED_RGBA;
      ctx.fillRect(x, y, GRID_STEP, GRID_STEP);
    }
  }

  ctx.restore();
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

    const radius = PLAYER_RADIUS;

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
    ctx.stroke();
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

  return { lx, ly };
}

/**
 * @param {MouseEvent | TouchEvent} e
 */
function onPointerDown(e) {
  if (!canvas) return;

  const pos = getPointerPosition(e);
  if (!pos) return;

  const { lx, ly } = pos;

  // Find top-most player within hit radius
  const hitRadius = PLAYER_RADIUS * 1.5;
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

  if (!found) return;

  if (e.cancelable) {
    e.preventDefault();
  }

  draggingPlayerId = found.id;
  dragOffsetX = lx - found.x;
  dragOffsetY = ly - found.y;
}

/**
 * @param {MouseEvent | TouchEvent} e
 */
function onPointerMove(e) {
  if (!canvas || draggingPlayerId == null) return;

  const pos = getPointerPosition(e);
  if (!pos) return;

  if (e.cancelable) {
    e.preventDefault();
  }

  const { lx, ly } = pos;

  const player = players.find((p) => p.id === draggingPlayerId);
  if (!player) return;

  // Update player position with clamping inside pitch
  const newX = lx - dragOffsetX;
  const newY = ly - dragOffsetY;

  player.x = clamp(newX, PLAYER_RADIUS * 1.5, LOGICAL_WIDTH - PLAYER_RADIUS * 1.5);
  player.y = clamp(newY, PLAYER_RADIUS * 1.5, LOGICAL_HEIGHT - PLAYER_RADIUS * 1.5);

  // Re-render visualization as the player moves
  renderAll();
}

/**
 * @param {MouseEvent | TouchEvent} e
 */
function onPointerUp(e) {
  if (draggingPlayerId == null) return;
  draggingPlayerId = null;
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}


