// =========================
// バイト戦士の戦い（完全版・斜め移動入り）
// - 9:16 縦全画面フィット（比率維持）
// - タッチ十字キー（複数指同時押し対応）→ 斜め移動
// - キーボード（WASD/矢印）→ 斜め移動
// - 前方スキャン“ビーム” + 効果音（ビープ）
// - 敵：ウザ客ハゲおじ（追尾/ランダム湧き）
// - メンタル(ライフ)3、接触で減る、倒すと回復
// - 倒すと買い物カゴを落とす → 回収でスコア
// - ゲームオーバー画面（SCANでリスタート）
// =========================

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

// ---- 内部解像度（ゲーム世界）9:16 ----
const BASE_W = 360;
const BASE_H = 640;

let dpr = 1;
let scale = 1;
let lastTime = 0;

// =========================
// 画像
// =========================
const IMG = {
  player: new Image(),
  ojisan: new Image(),
  basket: new Image(),
};
IMG.player.src = "/assets/player.png";
IMG.ojisan.src = "/assets/ojisan.png";
IMG.basket.src = "/assets/basket.png";

// =========================
// 画面フィット（縦全画面）
// =========================
function fitCanvas() {
  dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  // BASEを画面に収める最大整数倍率
  scale = Math.max(1, Math.floor(Math.min(viewW / BASE_W, viewH / BASE_H)));

  canvas.style.width = `${viewW}px`;
  canvas.style.height = `${viewH}px`;
  canvas.width = viewW * dpr;
  canvas.height = viewH * dpr;

  // 中央寄せ（余白が出ても中央）
  const drawW = BASE_W * scale;
  const drawH = BASE_H * scale;
  const offsetX = (viewW - drawW) / 2;
  const offsetY = (viewH - drawH) / 2;

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr, offsetY * dpr);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

// =========================
// ユーティリティ
// =========================
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function aabb(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}
function drawSprite(img, x, y, w, h) {
  if (!img || !img.complete) return;
  ctx.drawImage(img, x, y, w, h);
}

// =========================
// 効果音（ビープ）
// =========================
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

// =========================
// 入力（キーボード）
// =========================
const keys = new Set();
window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());
  if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(e.key.toLowerCase())) e.preventDefault();
}, { passive: false });

window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
});

// =========================
// タッチ十字キーUI（画面下）
// =========================
const pad = {
  size: 64,
  gap: 10,
  baseY: BASE_H - 90,
  leftX: 20,
};

function getPadRects() {
  const s = pad.size;
  const g = pad.gap;
  const y = pad.baseY;

  const left  = { x: pad.leftX,              y: y,        w: s, h: s, label:"◀" };
  const right = { x: pad.leftX + (s+g)*2,    y: y,        w: s, h: s, label:"▶" };
  const up    = { x: pad.leftX + (s+g),      y: y-(s+g),  w: s, h: s, label:"▲" };
  const down  = { x: pad.leftX + (s+g),      y: y,        w: s, h: s, label:"▼" };

  const atkW = 120, atkH = 64;
  const atk = { x: BASE_W - atkW - 20, y: y - 10, w: atkW, h: atkH, label:"SCAN" };

  return { left, right, up, down, atk };
}

const touchState = { up:false, down:false, left:false, right:false, atk:false };

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

function hitRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function resetTouchState() {
  touchState.up = touchState.down = touchState.left = touchState.right = false;
  touchState.atk = false;
}

// ★斜め移動の鍵：複数指同時押しを読む（touchイベント）
function handleMultiTouch(e) {
  // 移動方向を指から再構築
  touchState.up = touchState.down = touchState.left = touchState.right = false;

  const r = getPadRects();

  for (const t of e.touches) {
    const p = viewToWorldXY(t.clientX, t.clientY);
    if (hitRect(p, r.up)) touchState.up = true;
    if (hitRect(p, r.down)) touchState.down = true;
    if (hitRect(p, r.left)) touchState.left = true;
    if (hitRect(p, r.right)) touchState.right = true;
  }

  e.preventDefault();
}

canvas.addEventListener("touchstart", (e) => {
  const r = getPadRects();

  // SCANは「押した瞬間」だけ反応
  for (const t of e.touches) {
    const p = viewToWorldXY(t.clientX, t.clientY);
    if (hitRect(p, r.atk)) {
      touchState.atk = true;
      requestScan();
      break;
    }
  }

  handleMultiTouch(e);
}, { passive: false });

canvas.addEventListener("touchmove", handleMultiTouch, { passive: false });

canvas.addEventListener("touchend", (e) => {
  touchState.atk = false;
  handleMultiTouch(e);
}, { passive: false });

canvas.addEventListener("touchcancel", (e) => {
  touchState.atk = false;
  handleMultiTouch(e);
}, { passive: false });

// pointerupでも念のためOFF
canvas.addEventListener("pointerup", () => resetTouchState());

// =========================
// ゲーム状態
// =========================
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

// =========================
// スキャン処理（前方ビーム）
// =========================
function requestScan() {
  if (GAME.over) return;
  if (scanCooldown > 0) return;

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
      drops.push({
        x: e.x + e.w/2 - 24,
        y: e.y + e.h/2 - 24,
        w: 48, h: 48,
      });

      player.mental = Math.min(3, player.mental + 1);

      beep(220, 60, "sawtooth", 0.03);
      beep(160, 80, "sawtooth", 0.02);

      enemies.splice(i, 1);
    }
  }
}

// =========================
// 敵生成
// =========================
function spawnEnemy() {
  const margin = 20;
  const side = Math.floor(Math.random() * 4);

  let x, y;
  if (side === 0) { x = rand(margin, BASE_W - margin); y = -60; }
  else if (side === 1) { x = rand(margin, BASE_W - margin); y = BASE_H + 60; }
  else if (side === 2) { x = -60; y = rand(margin, BASE_H - margin); }
  else { x = BASE_W + 60; y = rand(margin, BASE_H - margin); }

  enemies.push({
    x, y,
    w: 56, h: 66,
    speed: rand(45, 70),
  });
}

// =========================
// 更新
// =========================
function getMoveInput() {
  const up = keys.has("w") || keys.has("arrowup") || touchState.up;
  const down = keys.has("s") || keys.has("arrowdown") || touchState.down;
  const left = keys.has("a") || keys.has("arrowleft") || touchState.left;
  const right = keys.has("d") || keys.has("arrowright") || touchState.right;
  const atk = keys.has(" ") || keys.has("enter") || touchState.atk;
  return { up, down, left, right, atk };
}

function update(dt) {
  const input = getMoveInput();

  if (GAME.over) {
    if (input.atk) restartGame();
    return;
  }

  if (input.atk) requestScan();

  if (scanCooldown > 0) scanCooldown -= dt;
  if (scanFx > 0) scanFx -= dt;
  if (player.invuln > 0) player.invuln -= dt;

  // ---- 移動（斜めOK：vx/vyを正規化済み） ----
  let vx = 0, vy = 0;
  if (input.left) vx -= 1;
  if (input.right) vx += 1;
  if (input.up) vy -= 1;
  if (input.down) vy += 1;

  if (vx !== 0 || vy !== 0) {
    const len = Math.hypot(vx, vy);
    vx /= len; vy /= len;

    // 向き（ビーム方向）だけは4方向に丸める
    if (Math.abs(vx) > Math.abs(vy)) player.dir = vx < 0 ? "left" : "right";
    else player.dir = vy < 0 ? "up" : "down";
  }

  player.x += vx * player.speed * dt;
  player.y += vy * player.speed * dt;

  player.x = clamp(player.x, 0, BASE_W - player.w);
  player.y = clamp(player.y, 0, BASE_H - player.h);

  // 敵湧き
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = rand(1.4, 2.2);
    spawnEnemy();
  }

  // 敵追尾
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

  // 接触ダメージ
  for (const e of enemies) {
    if (player.invuln <= 0 && aabb(player, e)) {
      player.mental -= 1;
      player.invuln = 1.0;
      beep(120, 120, "square", 0.04);

      if (player.mental <= 0) {
        GAME.over = true;
        beep(90, 180, "sawtooth", 0.04);
        break;
      }
    }
  }

  // カゴ回収
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

  player.x = 40;
  player.y = 80;
  player.mental = 3;
  player.invuln = 0;
  player.dir = "down";

  enemies.length = 0;
  drops.length = 0;

  spawnTimer = 0.3;
  scanCooldown = 0;
  scanFx = 0;

  beep(880, 60, "square", 0.03);
}

// =========================
// 描画
// =========================
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

function drawPad() {
  const r = getPadRects();

  function btn(rect, pressed, label) {
    ctx.fillStyle = pressed ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.12)";
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = "18px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, rect.x + rect.w/2, rect.y + rect.h/2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  btn(r.left, touchState.left, "◀");
  btn(r.right, touchState.right, "▶");
  btn(r.up, touchState.up, "▲");
  btn(r.down, touchState.down, "▼");
  btn(r.atk, false, "SCAN");
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
  drawPad();

  if (GAME.over) drawGameOver();
}

// =========================
// ループ
// =========================
function loop(t) {
  const now = t / 1000;
  const dt = Math.min(0.033, now - (lastTime || now));
  lastTime = now;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
