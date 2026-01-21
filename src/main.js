// =========================
// JKスーパーRPG（完全版）
// - 9:16 縦全画面フィット
// - タッチ十字キー + キーボード
// - 前方スキャン“ビーム” + 効果音（ビープ）
// - 敵：ウザ客ハゲおじ（追尾/ランダム湧き）
// - メンタル(ライフ)3、接触で減る、倒すと回復
// - 倒すと買い物カゴを落とす → 回収でスコア
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

  // タッチUI用
  canvas._viewW = viewW;
  canvas._viewH = viewH;
  canvas._offsetX = offsetX;
  canvas._offsetY = offsetY;
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

// =========================
// ユーティリティ
// =========================
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function dist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.hypot(dx, dy);
}
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
  size: 64,   // ボタン1個の見た目サイズ（内部座標）
  gap: 10,
  baseY: BASE_H - 90,
  leftX: 20,
};

function getPadRects() {
  const s = pad.size;
  const g = pad.gap;
  const y = pad.baseY;

  const left  = { x: pad.leftX,        y: y,      w: s, h: s, label:"◀" };
  const right = { x: pad.leftX + s+g + s+g, y: y, w: s, h: s, label:"▶" };
  const up    = { x: pad.leftX + s+g,  y: y - (s+g), w: s, h: s, label:"▲" };
  const down  = { x: pad.leftX + s+g,  y: y,      w: s, h: s, label:"▼" };

  const atkW = 120, atkH = 64;
  const atk = { x: BASE_W - atkW - 20, y: y - 10, w: atkW, h: atkH, label:"SCAN" };

  return { left, right, up, down, atk };
}

const touchState = {
  up:false, down:false, left:false, right:false,
  atk:false,
};

function viewToWorldXY(clientX, clientY) {
  // 画面ピクセル → 内部ワールド座標（BASE）
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left);
  const y = (clientY - rect.top);

  // 表示は100vw/100vh、内部は「中央にBASE*scale」なので、余白ぶん引く
  const viewW = rect.width;
  const viewH = rect.height;

  const drawW = BASE_W * scale;
  const drawH = BASE_H * scale;
  const offsetX = (viewW - drawW) / 2;
  const offsetY = (viewH - drawH) / 2;

  const wx = (x - offsetX) / scale;
  const wy = (y - offsetY) / scale;
  return { x: wx, y: wy };
}

function hitRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function resetTouchState() {
  touchState.up = touchState.down = touchState.left = touchState.right = false;
  touchState.atk = false;
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = viewToWorldXY(e.clientX, e.clientY);
  const r = getPadRects();

  if (hitRect(p, r.up)) touchState.up = true;
  if (hitRect(p, r.down)) touchState.down = true;
  if (hitRect(p, r.left)) touchState.left = true;
  if (hitRect(p, r.right)) touchState.right = true;

  if (hitRect(p, r.atk)) {
    touchState.atk = true;
    requestScan();
  }
});

canvas.addEventListener("pointermove", (e) => {
  const p = viewToWorldXY(e.clientX, e.clientY);
  const r = getPadRects();

  // 指が動いたら押下判定を更新（簡易）
  touchState.up = hitRect(p, r.up);
  touchState.down = hitRect(p, r.down);
  touchState.left = hitRect(p, r.left);
  touchState.right = hitRect(p, r.right);
});

canvas.addEventListener("pointerup", () => {
  resetTouchState();
});

// =========================
// ゲーム状態
// =========================
const player = {
  x: 40, y: 80,
  w: 40, h: 52,
  speed: 170, // px/sec（内部座標）
  dir: "down", // up/down/left/right
  mental: 3,
  invuln: 0, // 無敵時間
};

let score = 0;

const enemies = [];
const drops = [];

let spawnTimer = 0;

// スキャン（ビーム）状態
let scanCooldown = 0;
let scanFx = 0;

// =========================
// スキャン処理（前方ビーム）
// =========================
function requestScan() {
  if (scanCooldown > 0) return;
  scanCooldown = 0.35;
  scanFx = 0.12; // 描画用
  beep(880, 70, "square", 0.035);
  beep(1320, 40, "square", 0.02);

  // 向きに応じた判定矩形
  const range = 120;
  const thick = 48;

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

  // 命中：敵を倒す
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (aabb(beam, e)) {
      // ドロップ
      drops.push({
        x: e.x + e.w/2 - 18,
        y: e.y + e.h/2 - 18,
        w: 36, h: 36,
      });

      // 回復
      player.mental = Math.min(3, player.mental + 1);

      // 撃破SE
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
  // 画面外周寄りに湧く
  const margin = 20;
  const side = Math.floor(Math.random() * 4);

  let x, y;
  if (side === 0) { // top
    x = rand(margin, BASE_W - margin);
    y = -40;
  } else if (side === 1) { // bottom
    x = rand(margin, BASE_W - margin);
    y = BASE_H + 40;
  } else if (side === 2) { // left
    x = -40;
    y = rand(margin, BASE_H - margin);
  } else { // right
    x = BASE_W + 40;
    y = rand(margin, BASE_H - margin);
  }

  enemies.push({
    x, y,
    w: 40, h: 50,
    speed: rand(70, 110),
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

  // スキャン
  if (input.atk) requestScan();

  if (scanCooldown > 0) scanCooldown -= dt;
  if (scanFx > 0) scanFx -= dt;

  // 無敵
  if (player.invuln > 0) player.invuln -= dt;

  // 移動
  let vx = 0, vy = 0;
  if (input.left) vx -= 1;
  if (input.right) vx += 1;
  if (input.up) vy -= 1;
  if (input.down) vy += 1;

  if (vx !== 0 || vy !== 0) {
    const len = Math.hypot(vx, vy);
    vx /= len; vy /= len;

    // 向き
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
    spawnTimer = rand(1.2, 2.0);
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

  // 敵接触ダメージ
  for (const e of enemies) {
    if (player.invuln <= 0 && aabb(player, e)) {
      player.mental -= 1;
      player.invuln = 0.9;
      beep(120, 120, "square", 0.04);

      if (player.mental <= 0) {
        // ゲームオーバー：リセット（簡易）
        resetGame();
        return;
      }
    }
  }

  // ドロップ回収
  for (let i = drops.length - 1; i >= 0; i--) {
    if (aabb(player, drops[i])) {
      score += 1;
      beep(660, 60, "triangle", 0.03);
      drops.splice(i, 1);
    }
  }
}

function resetGame() {
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
}

// =========================
// 描画
// =========================
function drawUI() {
  // スコア
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "16px system-ui";
  ctx.fillText(`Score: ${score}`, 10, 22);

  // メンタル（ハート）
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

    ctx.fillStyle = "rgba(255,255,255,0.85)";
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

  // SCANボタン
  btn(r.atk, false, "SCAN");
}

function drawScanFx() {
  if (scanFx <= 0) return;

  const alpha = clamp(scanFx / 0.12, 0, 1);
  const range = 120;
  const thick = 48;

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
  ctx.globalAlpha = 0.35 * alpha;
  ctx.fillStyle = "rgba(80,255,200,1)";
  ctx.fillRect(bx, by, bw, bh);

  ctx.globalAlpha = 0.75 * alpha;
  ctx.strokeStyle = "rgba(200,255,240,1)";
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.restore();
}

function draw() {
  // 背景はCSSなので、ここではクリアだけ
  ctx.clearRect(0, 0, BASE_W, BASE_H);

  // ドロップ
  for (const d of drops) drawSprite(IMG.basket, d.x, d.y, d.w, d.h);

  // 敵
  for (const e of enemies) drawSprite(IMG.ojisan, e.x, e.y, e.w, e.h);

  // プレイヤー（無敵点滅）
  if (player.invuln > 0) {
    if (Math.floor(player.invuln * 12) % 2 === 0) {
      drawSprite(IMG.player, player.x, player.y, player.w, player.h);
    }
  } else {
    drawSprite(IMG.player, player.x, player.y, player.w, player.h);
  }

  // スキャンエフェクト
  drawScanFx();

  // UI
  drawUI();
  drawPad();
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
