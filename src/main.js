// ===== Canvas =====
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

// 内部解像度（ゲーム世界）
const BASE_W = 480;
const BASE_H = 270;

// 表示スケール（画面にフィット）
let scale = 2;
let dpr = 1;

function fitCanvas() {
  dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

  const maxW = Math.min(window.innerWidth * 0.96, 960);
  const maxH = Math.min((window.innerHeight - 170) * 0.96, 720);

  scale = Math.max(1, Math.floor(Math.min(maxW / BASE_W, maxH / BASE_H)));

  const viewW = BASE_W * scale;
  const viewH = BASE_H * scale;

  canvas.style.width = `${viewW}px`;
  canvas.style.height = `${viewH}px`;
  canvas.width = viewW * dpr;
  canvas.height = viewH * dpr;

  // 座標系：ゲームは BASE_* 基準で描画（dprとscaleをまとめて変換）
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

// ===== Assets =====
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const ASSET = {
  player: "/assets/player.png",
  basket: "/assets/basket.png",
  ojisan: "/assets/ojisan.png",
};

// ===== Tiny Sound (WebAudio) =====
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
function beep({ freq = 660, dur = 0.06, type = "square", gain = 0.08 } = {}) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g);
  g.connect(audioCtx.destination);
  const t = audioCtx.currentTime;
  o.start(t);
  o.stop(t + dur);
}
function sfxScan() {
  ensureAudio();
  beep({ freq: 880, dur: 0.05, type: "square", gain: 0.08 });
  setTimeout(() => beep({ freq: 660, dur: 0.05, type: "square", gain: 0.07 }), 40);
}
function sfxHit() {
  ensureAudio();
  beep({ freq: 220, dur: 0.08, type: "sawtooth", gain: 0.06 });
}

// ===== Game State =====
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let score = 0;
let mental = 3; // ライフ
let gameOver = false;

// 移動
const input = { up: false, down: false, left: false, right: false, scan: false };

// プレイヤー
const player = {
  x: 60,
  y: 70,
  w: 22,
  h: 28,
  speed: 95, // px/sec
  dir: "down", // up/down/left/right
};

// 敵（おじ）
const ojisans = [];
const OJISAN_MAX = 3;
const OJISAN_SPAWN_MS = 1500;
let lastSpawn = 0;

function spawnOjisan() {
  // 画面端から出す
  const side = Math.floor(rnd(0, 4));
  let x = 0, y = 0;
  if (side === 0) { x = rnd(0, BASE_W); y = -20; }
  if (side === 1) { x = rnd(0, BASE_W); y = BASE_H + 20; }
  if (side === 2) { x = -20; y = rnd(0, BASE_H); }
  if (side === 3) { x = BASE_W + 20; y = rnd(0, BASE_H); }

  ojisans.push({
    x, y,
    w: 22, h: 26,
    speed: rnd(45, 70),
    alive: true,
    hitFlash: 0,
  });
}

// ドロップ（カゴ）
const drops = [];
function dropBasket(x, y) {
  drops.push({
    x, y,
    w: 20, h: 20,
    vy: -20,
    t: 0,
  });
}

// SCAN ビーム
const beam = {
  active: false,
  t: 0,
  dur: 0.14,
  range: 120,
  width: 22,
};
function triggerScan() {
  if (gameOver) return;
  if (beam.active) return;
  beam.active = true;
  beam.t = 0;
  sfxScan();
}

// ===== Touch D-Pad =====
const pad = {
  size: 60,
  gap: 12,
  bottom: 16,
};

function getDpadRects() {
  const viewW = BASE_W * scale;
  const viewH = BASE_H * scale;

  // 画面下に配置（見た目はCSSで決まってるので、canvasの表示サイズ viewW/viewH を使う）
  // ただし当たり判定は「canvasの表示座標」で取る
  const baseX = 16;
  const baseY = viewH - (pad.size * 2 + pad.gap + pad.bottom);

  const up = { x: baseX + pad.size + pad.gap, y: baseY, w: pad.size, h: pad.size };
  const left = { x: baseX, y: baseY + pad.size + pad.gap, w: pad.size, h: pad.size };
  const down = { x: baseX + pad.size + pad.gap, y: baseY + pad.size + pad.gap, w: pad.size, h: pad.size };
  const right = { x: baseX + (pad.size + pad.gap) * 2, y: baseY + pad.size + pad.gap, w: pad.size, h: pad.size };

  const scan = {
    x: viewW - 16 - (pad.size * 2 + pad.gap),
    y: viewH - (pad.size + pad.bottom),
    w: pad.size * 2 + pad.gap,
    h: pad.size,
  };

  return { up, down, left, right, scan, viewW, viewH };
}

function ptInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function canvasEventToViewXY(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left);
  const y = (e.clientY - rect.top);
  return { x, y }; // 表示座標（scale済み）
}

function handleTouch(e) {
  ensureAudio();
  const touches = [...e.touches];
  input.up = input.down = input.left = input.right = false;
  let wantsScan = false;

  const r = getDpadRects();
  for (const t of touches) {
    const p = canvasEventToViewXY(t);
    if (ptInRect(p.x, p.y, r.up)) input.up = true;
    if (ptInRect(p.x, p.y, r.down)) input.down = true;
    if (ptInRect(p.x, p.y, r.left)) input.left = true;
    if (ptInRect(p.x, p.y, r.right)) input.right = true;
    if (ptInRect(p.x, p.y, r.scan)) wantsScan = true;
  }

  // scanは「押した瞬間」にしたいので、touchstartでだけトリガー
  if (e.type === "touchstart" && wantsScan) triggerScan();

  e.preventDefault();
}
canvas.addEventListener("touchstart", handleTouch, { passive: false });
canvas.addEventListener("touchmove", handleTouch, { passive: false });
canvas.addEventListener("touchend", handleTouch, { passive: false });
canvas.addEventListener("touchcancel", handleTouch, { passive: false });

// ===== Keyboard =====
window.addEventListener("keydown", (e) => {
  ensureAudio();
  if (e.key === "ArrowUp" || e.key === "w") input.up = true;
  if (e.key === "ArrowDown" || e.key === "s") input.down = true;
  if (e.key === "ArrowLeft" || e.key === "a") input.left = true;
  if (e.key === "ArrowRight" || e.key === "d") input.right = true;
  if (e.key === " " || e.key === "Enter") triggerScan();
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowUp" || e.key === "w") input.up = false;
  if (e.key === "ArrowDown" || e.key === "s") input.down = false;
  if (e.key === "ArrowLeft" || e.key === "a") input.left = false;
  if (e.key === "ArrowRight" || e.key === "d") input.right = false;
});

// ===== Collision =====
function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ビームの当たり判定（向き依存）
function getBeamRect() {
  const bx = player.x + player.w / 2;
  const by = player.y + player.h / 2;

  const range = beam.range;
  const w = beam.width;

  if (player.dir === "up") {
    return { x: bx - w / 2, y: by - range, w: w, h: range };
  }
  if (player.dir === "down") {
    return { x: bx - w / 2, y: by, w: w, h: range };
  }
  if (player.dir === "left") {
    return { x: bx - range, y: by - w / 2, w: range, h: w };
  }
  // right
  return { x: bx, y: by - w / 2, w: range, h: w };
}

// ===== Main Loop =====
let last = performance.now();
let loaded = false;
let IMG = {};

async function boot() {
  IMG.player = await loadImage(ASSET.player);
  IMG.basket = await loadImage(ASSET.basket);
  IMG.ojisan = await loadImage(ASSET.ojisan);
  loaded = true;
  requestAnimationFrame(loop);
}
boot().catch((err) => {
  console.error("Asset load failed:", err);
});

function resetGame() {
  score = 0;
  mental = 3;
  gameOver = false;
  player.x = 60; player.y = 70;
  player.dir = "down";
  ojisans.length = 0;
  drops.length = 0;
  lastSpawn = 0;
}

function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  update(dt, now);
  draw();

  requestAnimationFrame(loop);
}

function update(dt, nowMs) {
  if (!loaded) return;

  if (gameOver) {
    // Enter/Space or tap scan to restart (scan triggers anyway)
    return;
  }

  // プレイヤー移動
  let vx = 0, vy = 0;
  if (input.up) vy -= 1;
  if (input.down) vy += 1;
  if (input.left) vx -= 1;
  if (input.right) vx += 1;

  if (vx !== 0 || vy !== 0) {
    // 方向
    if (Math.abs(vx) > Math.abs(vy)) player.dir = vx > 0 ? "right" : "left";
    else player.dir = vy > 0 ? "down" : "up";

    // 正規化
    const len = Math.hypot(vx, vy) || 1;
    vx /= len; vy /= len;
    player.x += vx * player.speed * dt;
    player.y += vy * player.speed * dt;
  }

  // 画面内
  player.x = clamp(player.x, 0, BASE_W - player.w);
  player.y = clamp(player.y, 0, BASE_H - player.h);

  // 敵スポーン
  if (ojisans.length < OJISAN_MAX && nowMs - lastSpawn > OJISAN_SPAWN_MS) {
    spawnOjisan();
    lastSpawn = nowMs;
  }

  // 敵移動（追尾）
  for (const o of ojisans) {
    if (!o.alive) continue;
    const dx = (player.x - o.x);
    const dy = (player.y - o.y);
    const len = Math.hypot(dx, dy) || 1;
    o.x += (dx / len) * o.speed * dt;
    o.y += (dy / len) * o.speed * dt;
    o.hitFlash = Math.max(0, o.hitFlash - dt);

    // ぶつかったらダメージ
    if (aabb(player, o)) {
      o.alive = false; // 1回当たったら消える（理不尽回避）
      mental -= 1;
      sfxHit();
      if (mental <= 0) {
        gameOver = true;
      }
    }
  }

  // SCAN処理
  if (beam.active) {
    beam.t += dt;
    const br = getBeamRect();

    // 当たり判定
    for (const o of ojisans) {
      if (!o.alive) continue;
      if (aabb(br, o)) {
        o.alive = false;
        score += 1;
        mental = Math.min(3, mental + 1); // 回復
        dropBasket(o.x + o.w / 2, o.y + o.h / 2);
      }
    }

    if (beam.t >= beam.dur) {
      beam.active = false;
      beam.t = 0;
    }
  }

  // ドロップ演出
  for (const d of drops) {
    d.t += dt;
    d.y += d.vy * dt;
    d.vy += 60 * dt;
  }
  // 消す
  for (let i = drops.length - 1; i >= 0; i--) {
    if (drops[i].t > 2.2) drops.splice(i, 1);
  }

  // リスタート（PC）
  // gameOver中に Enter/Space は keydownで scan が走るが、updateでは止めてるので、
  // ここで別扱い：beamがトリガーされたら復帰させたい
  // → 代わりにクリックで復帰を用意
}

canvas.addEventListener("pointerdown", () => {
  ensureAudio();
  if (gameOver) resetGame();
}, { passive: true });

// ===== Draw =====
function drawSprite(img, x, y, w, h) {
  ctx.drawImage(img, x, y, w, h);
}

function draw() {
  if (!loaded) {
    ctx.clearRect(0, 0, BASE_W, BASE_H);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "16px system-ui";
    ctx.fillText("Loading...", 18, 28);
    return;
  }

  // 背景
  ctx.clearRect(0, 0, BASE_W, BASE_H);

  // UI
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "12px system-ui";
  ctx.fillText(`Score: ${score}`, 10, 16);

  // メンタル（ハート）
  for (let i = 0; i < 3; i++) {
    const x = 10 + i * 18;
    const y = 26;
    ctx.globalAlpha = i < mental ? 1 : 0.25;
    ctx.fillStyle = i < mental ? "rgba(255,100,130,0.95)" : "rgba(255,255,255,0.25)";
    ctx.fillText("♥", x, y);
    ctx.globalAlpha = 1;
  }

  // ドロップ
  for (const d of drops) {
    const w = 22, h = 22;
    drawSprite(IMG.basket, d.x - w / 2, d.y - h / 2, w, h);
  }

  // 敵
  for (const o of ojisans) {
    if (!o.alive) continue;
    const w = 24, h = 28;
    ctx.globalAlpha = o.hitFlash > 0 ? 0.5 : 1;
    drawSprite(IMG.ojisan, o.x, o.y, w, h);
    ctx.globalAlpha = 1;
  }

  // プレイヤー
  drawSprite(IMG.player, player.x, player.y, 26, 30);

  // ビーム（見た目）
  if (beam.active) {
    const br = getBeamRect();
    const pulse = 0.5 + 0.5 * Math.sin((beam.t / beam.dur) * Math.PI);
    ctx.globalAlpha = 0.25 + 0.25 * pulse;
    ctx.fillStyle = "rgba(120,220,255,1)";
    ctx.fillRect(br.x, br.y, br.w, br.h);
    ctx.globalAlpha = 1;
  }

  // タッチUI（十字＆SCAN）
  const r = getDpadRects();

  // ここは “表示座標” で描画したいので一時的にscale変換を外すのではなく、
  // すでに ctx は BASE基準なので、rの座標を BASE基準に戻す必要がある
  // rは viewW/viewH の px（表示）なので、BASE換算 = /scale
  const toBase = (rect) => ({
    x: rect.x / scale,
    y: rect.y / scale,
    w: rect.w / scale,
    h: rect.h / scale,
  });

  const up = toBase(r.up);
  const down = toBase(r.down);
  const left = toBase(r.left);
  const right = toBase(r.right);
  const scan = toBase(r.scan);

  // ボタン描画
  const drawBtn = (rect, pressed, label) => {
    ctx.globalAlpha = pressed ? 0.65 : 0.35;
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(10,16,32,1)";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;
  };

  drawBtn(left, input.left, "◀");
  drawBtn(right, input.right, "▶");
  drawBtn(up, input.up, "▲");
  drawBtn(down, input.down, "▼");
  drawBtn(scan, false, "SCAN");

  // ゲームオーバー
  if (gameOver) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, BASE_W, BASE_H);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.font = "22px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("メンタル崩壊…", BASE_W / 2, BASE_H / 2 - 8);
    ctx.font = "12px system-ui";
    ctx.fillText("画面をタップして再挑戦", BASE_W / 2, BASE_H / 2 + 16);
    ctx.textAlign = "left";
    ctx.restore();
  }
}
