
const COLS = 5, ROWS = 5;     
const LEVELS = 6;
const MAX_PER_CELL = 4;
const REACH = 0.75;
const MAX_JITTER = 0.3;
const MAX_SHIFT = 0.25;
const MAX_ROT = 0.35;
const TINY = 0.18;

const DIAL_MIN = 0.5;
const DIAL_MAX = 2.0;
const ECHOES = 4;
const ECHO_SPREAD = 0.22;
const PINCH_REACH = 1.0;

const LAYER_CHANCE = 0.3;
const LAYER_EVERY = 400;
const LAYER_FADE = 200;
const MAX_LAYERS = 8;

const MAX_HANDS = 4;
const MOUSE_TEST = false;
const HAND_COLORS = [[40, 35, 30], [180, 60, 50], [40, 90, 160], [40, 130, 90]];

let handPose, video, hands = [];
let cells = [], cellSize, gridX, gridY;
let pointers = [], palms = [], frozen = false, showVideo = false;

function preload() {
  handPose = ml5.handPose({ flipped: true, maxHands: MAX_HANDS });
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('Sometype Mono');
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  handPose.detectStart(video, results => (hands = results));
  buildGrid();
}

function buildGrid() {
  cellSize = (min(width, height) * 0.8) / max(COLS, ROWS);
  gridX = (width - cellSize * COLS) / 2;
  gridY = (height - cellSize * ROWS) / 2;
  cells = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      cells.push({
        cx: gridX + (c + 0.5) * cellSize,
        cy: gridY + (r + 0.5) * cellSize,
        isLayer: random() < LAYER_CHANCE,
        amt: 0,
        pinch: 0,
        squares: newSquares(),
        rot: random(-1, 1),
        rings: [],
        timer: 0,
      });
}

function newSquares() {
  const count = floor(random(1, MAX_PER_CELL + 1));
  const levels = shuffle([...Array(LEVELS).keys()].map(i => i + 1)).slice(0, count);
  return levels.map(level => ({
    size: level / LEVELS,
    corners: Array.from({ length: 4 }, () => createVector(random(-1, 1), random(-1, 1))),
    shift: createVector(random(-1, 1), random(-1, 1)),
    echoes: newEchoes(),
  }));
}

function newEchoes() {
  return Array.from({ length: ECHOES }, () =>
    ({ dx: random(-1, 1), dy: random(-1, 1), rot: random(-1, 1), scale: random(0.8, 1.25) }));
}

function rerollDistortion(cell) {
  for (const sq of cell.squares) {
    sq.corners = Array.from({ length: 4 }, () => createVector(random(-1, 1), random(-1, 1)));
    sq.shift = createVector(random(-1, 1), random(-1, 1));
    sq.echoes = newEchoes();
  }
  cell.rot = random(-1, 1);
}

const toCanvas = p => createVector(map(p.x, 0, video.width, 0, width),
                                   map(p.y, 0, video.height, 0, height));

function extended(hand, name) {
  const w = hand.wrist;
  const tip = hand[name + '_tip'], pip = hand[name + '_pip'];
  return dist(tip.x, tip.y, w.x, w.y) > dist(pip.x, pip.y, w.x, w.y) * 1.15;
}

const SMOOTH = 0.35;
let prevPos = [], prevStrength = [];
function smoothPos(i, raw) {
  const p = prevPos[i];
  prevPos[i] = (p && p.dist(raw) < cellSize * 1.5) ? p.copy().lerp(raw, SMOOTH) : raw.copy();
  return prevPos[i];
}
function smoothVal(i, v) {
  prevStrength[i] = prevStrength[i] === undefined ? v : lerp(prevStrength[i], v, 0.2);
  return prevStrength[i];
}

function readHands() {
  pointers = []; palms = [];
  let freeze = false;

  hands.forEach((hand, i) => {
    const col = HAND_COLORS[i % HAND_COLORS.length];
    const fingers = ['index_finger', 'middle_finger', 'ring_finger', 'pinky_finger']
      .filter(f => extended(hand, f)).length;
    const scale = dist(hand.wrist.x, hand.wrist.y,
                       hand.middle_finger_mcp.x, hand.middle_finger_mcp.y);

    if (fingers === 4) {
      freeze = true;
      palms.push({ pos: toCanvas(hand.middle_finger_mcp), col });
    } else {
      const tip = hand.index_finger_tip, th = hand.thumb_tip;
      const spread = dist(tip.x, tip.y, th.x, th.y) / scale;
      const strength = constrain(map(spread, 0.25, 1.3, DIAL_MAX, DIAL_MIN), DIAL_MIN, DIAL_MAX);
      const raw = toCanvas(hand.index_finger_mcp);
      const s = smoothVal(i, strength);
      pointers.push({ pos: smoothPos(i, raw), strength: s,
                      pinch: map(s, DIAL_MIN, DIAL_MAX, 0, 1), col });
    }
  });

  if (MOUSE_TEST && hands.length === 0 && mouseX > 0 && mouseY > 0) {
    const s = mouseIsPressed ? DIAL_MAX : 1;
    pointers.push({ pos: createVector(mouseX, mouseY), strength: s,
                    pinch: map(s, DIAL_MIN, DIAL_MAX, 0, 1), col: HAND_COLORS[0] });
  }
  if (keyIsDown(70)) freeze = true;

  frozen = freeze;
}

function draw() {
  background(236, 235, 232);
  if (showVideo) { tint(255, 60); image(video, 0, 0, width, height); noTint(); }
  readHands();

  stroke(101, 67, 33); strokeWeight(1.3); noFill();
  for (const cell of cells) {
    if (!frozen) {
      if (cell.isLayer) updateLayerCell(cell); else updateChaosCell(cell);
    }
    if (cell.isLayer) drawLayerCell(cell); else drawChaosCell(cell);
  }
  drawCursors();
}

function updateLayerCell(cell) {
  const h = cellSize / 2;
  const inside = pointers.some(p => abs(p.pos.x - cell.cx) < h && abs(p.pos.y - cell.cy) < h);
  cell.timer += deltaTime;
  if (inside) {
    if (cell.timer > LAYER_EVERY && cell.rings.length < MAX_LAYERS) {
      cell.rings.push({ k: cell.rings.length, appear: 0 });
      cell.timer = 0;
    }
  } else if (cell.rings.length && cell.timer > LAYER_FADE) {
    cell.rings.pop();
    cell.timer = 0;
  }
  for (const ring of cell.rings) ring.appear = min(1, ring.appear + 0.06);
}

function drawLayerCell(cell) {
  const base = (cellSize / 2) * 0.75, limit = (cellSize / 2) * 0.95;
  rectMode(CENTER);
  rect(cell.cx, cell.cy, base * TINY * 2, base * TINY * 2);
  for (const ring of cell.rings) {
    const target = TINY + (ring.k + 1) * (1.2 - TINY) / MAX_LAYERS;
    const s = min(base * lerp(TINY, target, ring.appear), limit);
    rect(cell.cx, cell.cy, s * 2, s * 2);
  }
}

function updateChaosCell(cell) {
  let target = 0, pinchTarget = 0;
  for (const p of pointers) {
    const radius = cellSize * (REACH + PINCH_REACH * p.pinch);
    const d = dist(p.pos.x, p.pos.y, cell.cx, cell.cy);
    if (d < radius) {
      const falloff = map(d, 0, radius, 1, 0);
      target = max(target, falloff * p.strength);
      pinchTarget = max(pinchTarget, min(1, falloff * 1.5) * p.pinch);
    }
  }
  cell.amt = lerp(cell.amt, target, target > cell.amt ? 0.2 : 0.03);
  cell.pinch = lerp(cell.pinch, pinchTarget, pinchTarget > cell.pinch ? 0.25 : 0.05);
  if (cell.amt < 0.005 && target === 0) {
    if (cell.amt > 0) rerollDistortion(cell);
    cell.amt = 0; cell.pinch = 0;
  }
}

function drawChaosCell(cell) {
  const grow = min(1, cell.amt * 2);
  for (const sq of cell.squares) {
    drawQuad(cell, sq, grow, 0, 0, 0, 1);
    const n = cell.pinch * ECHOES;
    for (let e = 0; e < ceil(n); e++) {
      const ec = sq.echoes[e];
      const k = min(1, n - e);
      drawQuad(cell, sq, grow,
        ec.dx * cellSize * ECHO_SPREAD * k,
        ec.dy * cellSize * ECHO_SPREAD * k,
        ec.rot * 0.6 * k,
        lerp(1, ec.scale, k));
    }
  }
}

function drawQuad(cell, sq, grow, ox, oy, extraRot, scl) {
  const half = cellSize / 2, limit = half * 0.95, base = half * 0.75;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const a = cell.rot * MAX_ROT * cell.amt + extraRot;
  const size = base * lerp(TINY, sq.size, grow) * scl;
  const sx = sq.shift.x * cellSize * MAX_SHIFT * cell.amt + ox;
  const sy = sq.shift.y * cellSize * MAX_SHIFT * cell.amt + oy;
  beginShape();
  for (let i = 0; i < 4; i++) {
    const j = sq.corners[i];
    const x = corners[i][0] * size + j.x * cellSize * MAX_JITTER * cell.amt;
    const y = corners[i][1] * size + j.y * cellSize * MAX_JITTER * cell.amt;
    const rx = x * cos(a) - y * sin(a) + sx, ry = x * sin(a) + y * cos(a) + sy;
    vertex(cell.cx + constrain(rx, -limit, limit), cell.cy + constrain(ry, -limit, limit));
  }
  endShape(CLOSE);
}

function drawCursors() {
  for (const p of pointers) {
    noStroke(); fill(...p.col, 170);
    circle(p.pos.x, p.pos.y, 6);
  }
  for (const p of palms) {
    noFill(); stroke(...p.col, 120); strokeWeight(1);
    rectMode(CENTER); square(p.pos.x, p.pos.y, 16);
  }
  if (frozen) {
    noStroke(); fill(40, 35, 30, 160); textSize(14); textAlign(CENTER, BOTTOM);
    text('frozen', width / 2, height - 20);
  }
}

function keyPressed() {
  if (key === 'v') showVideo = !showVideo;
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); buildGrid(); }