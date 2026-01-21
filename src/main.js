function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.min(window.innerWidth, 480);
  const h = Math.min(window.innerHeight - 140, 270);

  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  canvas.width = w * dpr;
  canvas.height = h * dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

// ====== 画面設定（スマホ対応）======
const BASE_W = 480;
const BASE_H = 270;

// 見た目の表示サイズ（CSSピクセル）
let viewW = BASE_W;
let viewH = BASE_H;

// 実描画サイズ（devicePixelRatio込み）
let W = BASE_W;
let H = BASE_H;

function resize() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

  // 画面に収まる最大サイズ（上下にUIがある前提で少し引く）
  const maxW = Math.min(window.innerWidth, 960);
  const maxH = Math.min(window.innerHeight - 160, 720);

  // 比率維持でスケール
  const scale = Math.max(1, Math.floor(Math.min(maxW / BASE_W, maxH / BASE_H)));

  viewW = BASE_W * scale;
  viewH = BASE_H * scale;

  // CanvasのCSSサイズ（見た目）
  canvas.style.width = viewW + "px";
  canvas.style.height = viewH + "px";

  // Canvasの実ピクセル（描画の解像度）
  W = viewW * dpr;
  H = viewH * dpr;
  canvas.width = W;
  canvas.height = H;

  // 座標系を「viewW/viewH基準」にする（縦伸びしない）
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

window.addEventListener("resize", resize);
resize();


function resize() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resize);
resize();

// ===== 画像（public/assets に置く）=====
const playerImg = new Image();
playerImg.src = "/assets/player.png";

const basketImg = new Image();
basketImg.src = "/assets/basket.png";

const ojisanImg = new Image();
ojisanImg.src = "/assets/ojisan.png";

// ===== サウンド（WebAudio）=====
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
function beep({ freq = 880, dur = 0.07, type = "square", gain = 0.06 } = {}) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g);
  g.connect(audioCtx.destination);
  const t = audioCtx.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur);
}
function sfxScan() {
  beep({ freq: 1200, dur: 0.06, type: "square", gain: 0.06 });
}
function sfxHit() {
  beep({ freq: 220, dur: 0.09, type: "sawtooth", gain: 0.05 });
}
function sfxGet() {
  beep({ freq: 740, dur: 0.05, type: "triangle", gain: 0.05 });
  setTimeout(() => beep({ freq: 980, dur: 0.05, type: "triangle", gain: 0.045 }), 55);
}

// ===== ユーティリティ =====
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hypot = (x, y) => Math.hypot(x, y);
const nowMs = () => performance.now();

function hit(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function drawKeepAspect(img, x, y, targetH) {
  if (!img.complete || !img.naturalWidth) return { w: 0, h: 0 };
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = targetH / ih;
  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);
  ctx.drawImage(img, x, y, w, h);
  return { w, h };
}

function roundRectPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ===== キーボード入力 =====
const keys = {};
window.addEventListener("keydown", (e) => (keys[e.key.toLowerCase()] = true));
window.addEventListener("keyup", (e) => (keys[e.key.toLowerCase()] = false));

// ===== スマホ：タッチ十字キー + 攻撃ボタン =====
const pad = { up: false, down: false, left: false, right: false };
let tappedAttack = false;

const DPAD = { x: 24, y: H - 86, s: 28, g: 8 }; // 左下
const ATTACK_BTN = { x: W - 88, y: H - 86, w: 64, h: 64 }; // 右下

function getDpadRects() {
  const { x, y, s, g } = DPAD;
  return {
    up: { x: x + (s + g), y: y - (s + g), w: s, h: s },
    left: { x, y, w: s, h: s },
    right: { x: x + 2 * (s + g), y, w: s, h: s },
    down: { x: x + (s + g), y: y + (s + g), w: s, h: s },
  };
}
function inRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}
function clientToLogical(clientX, clientY) {
  const b = canvas.getBoundingClientRect();
  const nx = (clientX - b.left) / b.width;
  const ny = (clientY - b.top) / b.height;
  return { x: nx * W, y: ny * H };
}
function clearPad() {
  pad.up = pad.down = pad.left = pad.right = false;
}

canvas.addEventListener("pointerdown", (e) => {
  ensureAudio();
  const p = clientToLogical(e.clientX, e.clientY);
  const rects = getDpadRects();

  if (inRect(p.x, p.y, ATTACK_BTN)) {
    tappedAttack = true;
    return;
  }

  clearPad();
  if (inRect(p.x, p.y, rects.up)) pad.up = true;
  if (inRect(p.x, p.y, rects.down)) pad.down = true;
  if (inRect(p.x, p.y, rects.left)) pad.left = true;
  if (inRect(p.x, p.y, rects.right)) pad.right = true;
});

canvas.addEventListener("pointermove", (e) => {
  const p = clientToLogical(e.clientX, e.clientY);
  const rects = getDpadRects();
  clearPad();
  if (inRect(p.x, p.y, rects.up)) pad.up = true;
  if (inRect(p.x, p.y, rects.down)) pad.down = true;
  if (inRect(p.x, p.y, rects.left)) pad.left = true;
  if (inRect(p.x, p.y, rects.right)) pad.right = true;
});

canvas.addEventListener("pointerup", () => clearPad());
canvas.addEventListener("pointercancel", () => clearPad());

// ===== ゲーム状態 =====
const player = {
  x: 40,
  y: 40,
  w: 48,
  h: 72,
  speed: 150,
  faceX: 1,
  faceY: 0,
};

let score = 0;

// メンタル（ライフ）
let mental = 3;
const MENTAL_MAX = 3;
let invincibleUntil = 0;

// 敵（ウザ客ハゲおじ）
const enemy = {
  x: 0,
  y: 0,
  w: 64,
  h: 64,
  speed: 86,
  alive: false,
};

// ドロップ（買い物カゴ）
const drops = []; // {x,y,w,h,ttl}
const DROP_SIZE = 56;

// ビーム（スキャナー）
const beam = {
  active: false,
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  until: 0,
  dirX: 1,
  dirY: 0,
};

// スポーン管理
let nextSpawnAt = nowMs() + 900;

function randomSpawnPoint() {
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * (W - enemy.w);
    const y = Math.random() * (H - enemy.h);
    const dx = x - player.x;
    const dy = y - player.y;
    if (hypot(dx, dy) > 150) return { x, y };
  }
  return { x: W - enemy.w - 10, y: H - enemy.h - 10 };
}
function spawnEnemy() {
  const p = randomSpawnPoint();
  enemy.x = p.x;
  enemy.y = p.y;
  enemy.alive = true;
}
function dropBasket(x, y) {
  drops.push({
    x: clamp(x, 0, W - DROP_SIZE),
    y: clamp(y, 0, H - DROP_SIZE),
    w: DROP_SIZE,
    h: DROP_SIZE,
    ttl: nowMs() + 15000,
  });
}
function takeDamage() {
  if (nowMs() < invincibleUntil) return;
  mental = Math.max(0, mental - 1);
  invincibleUntil = nowMs() + 900;
  sfxHit();
}
function healMental() {
  mental = Math.min(MENTAL_MAX, mental + 1);
}

// ===== ビーム発射（向いてる方向にだけ出る）=====
function triggerBeam() {
  let fx = player.faceX || 1;
  let fy = player.faceY || 0;
  const d = hypot(fx, fy) || 1;
  fx /= d;
  fy /= d;

  beam.dirX = fx;
  beam.dirY = fy;

  const px = player.x + player.w / 2;
  const py = player.y + player.h / 2;

  const L = 170;

  if (Math.abs(fx) >= Math.abs(fy)) {
    // 横向き
    beam.w = L;
    beam.h = 18;
    beam.x = clamp(px + fx * 26 - (fx > 0 ? 0 : L), 0, W - L);
    beam.y = clamp(py - beam.h / 2, 0, H - beam.h);
  } else {
    // 縦向き
    beam.w = 18;
    beam.h = L;
    beam.x = clamp(px - beam.w / 2, 0, W - beam.w);
    beam.y = clamp(py + fy * 26 - (fy > 0 ? 0 : L), 0, H - L);
  }

  beam.active = true;
  beam.until = nowMs() + 170;
  sfxScan();
}

// ===== ループ =====
let last = performance.now();
requestAnimationFrame(function loop(t) {
  const dt = (t - last) / 1000;
  last = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
});

function update(dt) {
  if (mental <= 0) return;

  // ===== 移動（キーボード + タッチ十字）=====
  let vx = 0,
    vy = 0;
  const up = keys["arrowup"] || keys["w"] || pad.up;
  const down = keys["arrowdown"] || keys["s"] || pad.down;
  const left = keys["arrowleft"] || keys["a"] || pad.left;
  const right = keys["arrowright"] || keys["d"] || pad.right;

  if (up) vy -= 1;
  if (down) vy += 1;
  if (left) vx -= 1;
  if (right) vx += 1;

  if (vx && vy) {
    vx *= Math.SQRT1_2;
    vy *= Math.SQRT1_2;
  }
  if (vx || vy) {
    player.faceX = vx;
    player.faceY = vy;
  }

  player.x += vx * player.speed * dt;
  player.y += vy * player.speed * dt;
  player.x = clamp(player.x, 0, W - player.w);
  player.y = clamp(player.y, 0, H - player.h);

  // ===== 攻撃（Space/Enter/攻撃ボタン）=====
  const attackKey = keys[" "] || keys["enter"];
  if (attackKey || tappedAttack) {
    tappedAttack = false;
    ensureAudio();
    triggerBeam();
  }
  if (beam.active && nowMs() > beam.until) beam.active = false;

  // ===== 敵スポーン =====
  if (!enemy.alive && nowMs() >= nextSpawnAt) spawnEnemy();

  // ===== 敵追跡 =====
  if (enemy.alive) {
    const tx = player.x + player.w / 2 - (enemy.x + enemy.w / 2);
    const ty = player.y + player.h / 2 - (enemy.y + enemy.h / 2);
    const d = hypot(tx, ty) || 1;

    enemy.x += (tx / d) * enemy.speed * dt;
    enemy.y += (ty / d) * enemy.speed * dt;

    enemy.x = clamp(enemy.x, 0, W - enemy.w);
    enemy.y = clamp(enemy.y, 0, H - enemy.h);

    if (hit(player, enemy)) takeDamage();

    // ===== ビームで撃破（前方にいる時だけ当たる）=====
    const isInFront =
      (beam.dirX > 0 && enemy.x > player.x) ||
      (beam.dirX < 0 && enemy.x < player.x) ||
      (beam.dirY > 0 && enemy.y > player.y) ||
      (beam.dirY < 0 && enemy.y < player.y);

    if (beam.active && isInFront && hit(beam, enemy)) {
      enemy.alive = false;
      healMental();
      dropBasket(enemy.x, enemy.y);
      sfxGet();
      nextSpawnAt = nowMs() + 900 + Math.random() * 1400;
    }
  }

  // ===== ドロップ拾う =====
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (nowMs() > d.ttl) {
      drops.splice(i, 1);
      continue;
    }
    if (hit(player, d)) {
      score += 1;
      sfxGet();
      drops.splice(i, 1);
    }
  }
}

function drawBtn(r, active, label) {
  ctx.save();
  ctx.globalAlpha = active ? 0.55 : 0.25;
  ctx.fillStyle = "#ffffff";
  roundRectPath(r.x, r.y, r.w, r.h, 10);
  ctx.fill();

  ctx.globalAlpha = active ? 0.95 : 0.7;
  ctx.fillStyle = "#0b1020";
  ctx.font = "13px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  // 背景
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, W, H);

  // ドロップ（買い物カゴ）
  for (const d of drops) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    drawKeepAspect(basketImg, d.x, d.y, 64);
    ctx.restore();
  }

  // 敵（画像）
  if (enemy.alive) {
    const s = drawKeepAspect(ojisanImg, enemy.x, enemy.y, 64);
    if (s.w && s.h) {
      enemy.w = s.w;
      enemy.h = s.h;
    }
  }

  // プレイヤー
  drawKeepAspect(playerImg, player.x, player.y, 72);

  // 無敵点滅
  if (nowMs() < invincibleUntil) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(player.x, player.y, player.w, player.h);
    ctx.restore();
  }

  // ビーム（バーコードっぽい）
  if (beam.active) {
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(beam.x, beam.y, beam.w, beam.h);

    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(beam.x, beam.y, beam.w, beam.h);

    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "#ffffff";
    const step = 6;
    const bars = Math.floor(beam.w / step);
    for (let i = 0; i < bars; i++) {
      const x = beam.x + i * step;
      const bw = i % 3 === 0 ? 2 : 1;
      ctx.fillRect(x, beam.y + 2, bw, Math.max(2, beam.h - 4));
    }
    ctx.restore();
  }

  // UI
  ctx.fillStyle = "#ffffff";
  ctx.font = "12px system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`Score: ${score}`, 10, 18);

  // メンタル（♥）
  for (let i = 0; i < MENTAL_MAX; i++) {
    ctx.globalAlpha = i < mental ? 1 : 0.2;
    ctx.fillText("♥", 10 + i * 14, 34);
  }
  ctx.globalAlpha = 1;

  // 操作UI
  const r = getDpadRects();
  drawBtn(r.left, pad.left, "◀");
  drawBtn(r.up, pad.up, "▲");
  drawBtn(r.down, pad.down, "▼");
  drawBtn(r.right, pad.right, "▶");
  drawBtn(ATTACK_BTN, false, "SCAN");

  // ヒント
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "11px system-ui";
  ctx.fillText("移動：十字/WASD  攻撃：SCAN/Space/Enter", 10, H - 10);

  // ゲームオーバー
  if (mental <= 0) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.font = "22px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("メンタル崩壊…", W / 2, H / 2 - 6);
    ctx.font = "12px system-ui";
    ctx.fillText("リロードで再挑戦", W / 2, H / 2 + 18);
    ctx.restore();
  }
}
