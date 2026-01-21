// =========================
// JKスーパーRPG（完全版・ガチアナログスティック）
// - 左下エリアを1本指ドラッグ = アナログ移動（斜めOK）
// - スティック中心は「触った地点」に出現（スマホで確実）
// - 右下：SCANボタン
// - 9:16/全画面/ゲームオーバー/敵/カゴ/回復/ビーム/SE ぜんぶ込み
// =========================

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const BASE_W = 360;
const BASE_H = 640;

let dpr = 1;
let scale = 1;
let lastTime = 0;

// -------- images --------
const IMG = {
  player: new Image(),
  ojisan: new Image(),
  basket: new Image(),
};
IMG.player.src = "/assets/player.png";
IMG.ojisan.src = "/assets/ojisan.png";
IMG.basket.src = "/assets/basket.png";

// -------- fit --------
function fitCanvas() {
  dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  scale = Math.max(1, Math.floor(Math.min(viewW / BASE_W, viewH / BASE_H)));

  canvas.style.width = `${viewW}px`;
  canvas.style.height = `${viewH}px`;
  canvas.width = viewW * dpr;
  canvas.height = viewH * dpr;

  const drawW = BASE_W * scale;
  const drawH = BASE_H * scale;
  const offsetX = (viewW - drawW) / 2;
  const offsetY = (viewH - drawH) / 2;

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr, offsetY * dpr);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

// -------- utils --------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function drawSprite(img, x, y, w, h) {
  if (!img || !img.complete) return;
  ctx.drawImage(img, x, y, w, h);
}
function roundRectPath(x, y, w, h, r) {
  if (ctx.roundRect) return ctx.roundRect(x, y, w, h, r);
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
}

// -------- audio --------
let audioCtx = null;
function beep(freq = 880, ms = 60, type = "square", gain = 0.03) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000);
  } catch {}
}

// -------- keyboard --------
const keys = new Set();
window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());
  if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(e.key.toLowerCase())) e.preventDefault();
}, { passive: false });
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// -------- coords --------
function viewToWorldXY(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left);
  const y = (clientY - rect.top);

  const viewW = rect.width;
  const viewH = rect.height;

  const drawW = BASE_W * scale;
  const drawH = BASE_H * scale;
  const offsetX = (viewW - drawW) / 2;
  const offsetY = (viewH - drawH) / 2;

  return { x: (x - offsetX) / scale, y: (y - offsetY) / scale };
}
function ptInRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

// =========================
// UI: ガチアナログスティック
// =========================
const ui = {
  // 左下の「スティックを開始できるエリア」（広め）
  joyZone: { x: 0, y: BASE_H * 0.45, w: BASE_W * 0.62, h: BASE_H * 0.55 },

  joyActive: false,
  joyPointerId: null,

  // スティック中心（触った地点に出現）
  joyCenter: { x: 90, y: BASE_H - 120 },

  joyRadius: 62,
  knobRadius: 24,

  // -1..1
  joyVec: { x: 0, y: 0 },

  // デッドゾーン（少し触れただけで動かない）
  deadZone: 0.10,

  // 右下SCAN
  scanRect: { x: BASE_W - 160, y: BASE_H - 120, w: 140, h: 70 },
};

function resetJoy() {
  ui.joyActive = false;
  ui.joyPointerId = null;
  ui.joyVec.x = 0;
  ui.joyVec.y = 0;
}

function setJoyFromPoint(p) {
  const dx = p.x - ui.joyCenter.x;
  const dy = p.y - ui.joyCenter.y;
  const len = Math.hypot(dx, dy);

  const r = ui.joyRadius;
  const clamped = Math.min(len, r);

  const nx = len > 0 ? dx / len : 0;
  const ny = len > 0 ? dy / len : 0;

  ui.joyVec.x = (nx * clamped) / r;
  ui.joyVec.y = (ny * clamped) / r;

  // デッドゾーン
  const mag = Math.hypot(ui.joyVec.x, ui.joyVec.y);
  if (mag < ui.deadZone) {
    ui.joyVec.x = 0;
    ui.joyVec.y = 0;
  }
}

// -------- game state --------
const GAME = { over: false };

const player = {
  x: 40, y: 80,
  w: 54, h: 70,
  speed: 185,
  dir: "down",
  mental: 3,
  invuln: 0,
};

let score = 0;
const enemies = [];
const drops = [];
let spawnTimer = 0;

let scanCooldown = 0;
let scanFx = 0;

// -------- scan --------
function requestScan() {
  if (scanCooldown > 0) return;

  if (GAME.over) {
    restartGame();
    return;
  }

  scanCooldown = 0.35;
  scanFx = 0.12;

  beep(880, 70, "square", 0.035);
  beep(1320, 40, "square", 0.02);

  const range = 130;
  const thick = 56;

  let bx, by, bw, bh;
  if (player.dir === "up") {
    bw = thick; bh = range;
    bx = player.x + player.w/2 - bw/2;
    by = player.y - bh;
  } else if (player.dir === "down") {
    bw = thick; bh = range;
    bx = player.x + player.w/2 - bw/2;
    by = player.y + player.h;
  } else if (player.dir === "left") {
    bw = range; bh = thick;
    bx = player.x - bw;
    by = player.y + player.h/2 - bh/2;
  } else {
    bw = range; bh = thick;
    bx = player.x + player.w;
    by = player.y + player.h/2 - bh/2;
  }

  const beam = { x: bx, y: by, w: bw, h: bh };

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (aabb(beam, e)) {
      drops.push({ x: e.x + e.w/2 - 24, y: e.y + e.h/2 - 24, w: 48, h: 48 });
      player.mental = Math.min(3, player.mental + 1);

      beep(220, 60, "sawtooth", 0.03);
      beep(160, 80, "sawtooth", 0.02);

      enemies.splice(i, 1);
    }
  }
}

function spawnEnemy() {
  const margin = 20;
  const side = Math.floor(Math.random() * 4);

  let x, y;
  if (side === 0) { x = rand(margin, BASE_W - margin); y = -60; }
  else if (side === 1) { x = rand(margin, BASE_W - margin); y = BASE_H + 60; }
  else if (side === 2) { x = -60; y = rand(margin, BASE_H - margin); }
  else { x = BASE_W + 60; y = rand(margin, BASE_H - margin); }

  enemies.push({ x, y, w: 56, h: 66, speed: rand(45, 70) });
}

// -------- pointer events (確実アナログ) --------
canvas.addEventListener("pointerdown", (e) => {
  const p = viewToWorldXY(e.clientX, e.clientY);

  // 右下SCAN
  if (ptInRect(p, ui.scanRect)) {
    canvas.setPointerCapture(e.pointerId);
    requestScan();
    return;
  }

  // 左下ゾーンならどこでもスティック開始（中心がタッチ地点に出現）
  if (ptInRect(p, ui.joyZone) && !ui.joyActive) {
    canvas.setPointerCapture(e.pointerId);
    ui.joyActive = true;
    ui.joyPointerId = e.pointerId;

    ui.joyCenter.x = clamp(p.x, 40, BASE_W * 0.62);
    ui.joyCenter.y = clamp(p.y, BASE_H * 0.55, BASE_H - 40);

    setJoyFromPoint(p);
    return;
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!ui.joyActive) return;
  if (e.pointerId !== ui.joyPointerId) return;

  const p = viewToWorldXY(e.clientX, e.clientY);
  setJoyFromPoint(p);
});

canvas.addEventListener("pointerup", (e) => {
  if (ui.joyActive && e.pointerId === ui.joyPointerId) resetJoy();
});

canvas.addEventListener("pointercancel", (e) => {
  if (ui.joyActive && e.pointerId === ui.joyPointerId) resetJoy();
});

// -------- input --------
function getMoveVector() {
  // アナログ（-1..1）
  let vx = ui.joyVec.x;
  let vy = ui.joyVec.y;

  // キーボード加算
  let kx = 0, ky = 0;
  if (keys.has("a") || keys.has("arrowleft")) kx -= 1;
  if (keys.has("d") || keys.has("arrowright")) kx += 1;
  if (keys.has("w") || keys.has("arrowup")) ky -= 1;
  if (keys.has("s") || keys.has("arrowdown")) ky += 1;

  if (kx !== 0 || ky !== 0) {
    const len = Math.hypot(kx, ky) || 1;
    kx /= len; ky /= len;
    vx += kx;
    vy += ky;
  }

  // 正規化（斜めが速くならない）
  const len = Math.hypot(vx, vy);
  if (len > 1) { vx /= len; vy /= len; }

  return { vx, vy };
}
function isScanPressed() { return keys.has(" ") || keys.has("enter"); }

// -------- update --------
function update(dt) {
  if (scanCooldown > 0) scanCooldown -= dt;
  if (scanFx > 0) scanFx -= dt;
  if (player.invuln > 0) player.invuln -= dt;

  if (isScanPressed()) requestScan();
  if (GAME.over) return;

  const { vx, vy } = getMoveVector();

  if (vx !== 0 || vy !== 0) {
    if (Math.abs(vx) > Math.abs(vy)) player.dir = vx < 0 ? "left" : "right";
    else player.dir = vy < 0 ? "up" : "down";
  }

  player.x += vx * player.speed * dt;
  player.y += vy * player.speed * dt;
  player.x = clamp(player.x, 0, BASE_W - player.w);
  player.y = clamp(player.y, 0, BASE_H - player.h);

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = rand(1.4, 2.2);
    spawnEnemy();
  }

  // enemy chase
  for (const e of enemies) {
    const px = player.x + player.w/2;
    const py = player.y + player.h/2;
    const ex = e.x + e.w/2;
    const ey = e.y + e.h/2;
    const dx = px - ex;
    const dy = py - ey;
    const l = Math.hypot(dx, dy) || 1;
    e.x += (dx / l) * e.speed * dt;
    e.y += (dy / l) * e.speed * dt;
  }

  // collide damage
  for (const e of enemies) {
    if (player.invuln <= 0 && aabb(player, e)) {
      player.mental -= 1;
      player.invuln = 1.0;
      beep(120, 120, "square", 0.04);

      if (player.mental <= 0) {
        GAME.over = true;
        resetJoy();
        beep(90, 180, "sawtooth", 0.04);
        break;
      }
    }
  }

  // pickup baskets
  for (let i = drops.length - 1; i >= 0; i--) {
    if (aabb(player, drops[i])) {
      score += 1;
      beep(660, 60, "triangle", 0.03);
      drops.splice(i, 1);
    }
  }
}

function restartGame() {
  GAME.over = false;
  score = 0;
  player.x = 40; player.y = 80;
  player.mental = 3;
  player.invuln = 0;
  player.dir = "down";
  enemies.length = 0;
  drops.length = 0;
  spawnTimer = 0.3;
  scanCooldown = 0;
  scanFx = 0;
  resetJoy();
  beep(880, 60, "square", 0.03);
}

// -------- draw --------
function drawUI() {
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "16px system-ui";
  ctx.fillText(`Score: ${score}`, 10, 22);

  const x0 = 10, y0 = 36;
  for (let i = 0; i < 3; i++) {
    const filled = i < player.mental;
    ctx.fillStyle = filled ? "rgba(255,80,120,0.95)" : "rgba(255,80,120,0.25)";
    ctx.fillRect(x0 + i * 18, y0, 14, 14);
  }
}

function drawScanFx() {
  if (scanFx <= 0) return;
  const alpha = clamp(scanFx / 0.12, 0, 1);

  const range = 130;
  const thick = 56;

  let bx, by, bw, bh;
  if (player.dir === "up") {
    bw = thick; bh = range;
    bx = player.x + player.w/2 - bw/2;
    by = player.y - bh;
  } else if (player.dir === "down") {
    bw = thick; bh = range;
    bx = player.x + player.w/2 - bw/2;
    by = player.y + player.h;
  } else if (player.dir === "left") {
    bw = range; bh = thick;
    bx = player.x - bw;
    by = player.y + player.h/2 - bh/2;
  } else {
    bw = range; bh = thick;
    bx = player.x + player.w;
    by = player.y + player.h/2 - bh/2;
  }

  ctx.save();
  ctx.globalAlpha = 0.32 * alpha;
  ctx.fillStyle = "rgba(80,255,200,1)";
  ctx.fillRect(bx, by, bw, bh);

  ctx.globalAlpha = 0.75 * alpha;
  ctx.strokeStyle = "rgba(200,255,240,1)";
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.restore();
}

function drawJoystick() {
  // ベース円
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.beginPath();
  ctx.arc(ui.joyCenter.x, ui.joyCenter.y, ui.joyRadius, 0, Math.PI * 2);
  ctx.fill();

  // ノブ（入力に追従）
  const knobX = ui.joyCenter.x + ui.joyVec.x * ui.joyRadius;
  const knobY = ui.joyCenter.y + ui.joyVec.y * ui.joyRadius;

  ctx.globalAlpha = 0.48;
  ctx.beginPath();
  ctx.arc(knobX, knobY, ui.knobRadius, 0, Math.PI * 2);
  ctx.fill();

  // 輪郭
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ui.joyCenter.x, ui.joyCenter.y, ui.joyRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawScanButton() {
  const r = ui.scanRect;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;

  ctx.beginPath();
  roundRectPath(r.x, r.y, r.w, r.h, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = "18px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("SCAN", r.x + r.w/2, r.y + r.h/2);

  ctx.restore();
}

function drawGameOver() {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.textAlign = "center";
  ctx.font = "28px system-ui";
  ctx.fillText("GAME OVER", BASE_W/2, BASE_H/2 - 40);

  ctx.font = "16px system-ui";
  ctx.fillText(`Score: ${score}`, BASE_W/2, BASE_H/2 - 10);

  ctx.font = "14px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("SCAN を押してリスタート", BASE_W/2, BASE_H/2 + 22);

  ctx.textAlign = "left";
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, BASE_W, BASE_H);

  for (const d of drops) drawSprite(IMG.basket, d.x, d.y, d.w, d.h);
  for (const e of enemies) drawSprite(IMG.ojisan, e.x, e.y, e.w, e.h);

  if (player.invuln > 0) {
    if (Math.floor(player.invuln * 12) % 2 === 0) {
      drawSprite(IMG.player, player.x, player.y, player.w, player.h);
    }
  } else {
    drawSprite(IMG.player, player.x, player.y, player.w, player.h);
  }

  drawScanFx();
  drawUI();

  // UI
  drawJoystick();
  drawScanButton();

  if (GAME.over) drawGameOver();
}

// -------- loop --------
function loop(t) {
  const now = t / 1000;
  const dt = Math.min(0.033, now - (lastTime || now));
  lastTime = now;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
