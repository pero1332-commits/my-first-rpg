// =========================
// JKスーパーサバイバー（完全版）
// - 有限マップ(例: 6000x6000) + カメラ追従（Vampire Survivors構図）
// - 背景：スーパーのドット風タイル（map_super.png を敷き詰め）
// - スコア：敵撃破で +1（カゴではない）
// - 敵強化：50キルごとに速度UP（上限あり）
// - 敵増加：10キルごとに最大同時湧きUP（上限あり）
// - ドロップ：確率テーブル
//    60% カゴ(回復+1)
//    10% 守護猫(周回)  ※重ねがけOK
//    5%  虹猫(追尾)    ※重ねがけOK
//    5%  レジ袋(吸引60秒)
//    1%  メンケア注射(最大ライフ+1)
//    19% なし
// - 操作：左下アナログスティック（1本指で斜めOK）、右下SCAN（360°ビーム）
// =========================

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

// ---- 内部解像度（ゲーム画面）9:16 ----
const BASE_W = 360;
const BASE_H = 640;

let dpr = 1;
let scale = 1;
let lastTime = 0;

// ---- ワールド（有限マップ） ----
const WORLD = {
  w: 6000,
  h: 6000,
};

// =========================
// 画像
// =========================
const IMG = {
  player: new Image(),
  ojisan: new Image(),
  map: new Image(),

  item_basket: new Image(),
  item_cat_rainbow: new Image(),
  item_cat_orbit: new Image(),
  item_bag: new Image(),
  item_injection: new Image(),
};

IMG.player.src = "/assets/player.png";
IMG.ojisan.src = "/assets/ojisan.png";
IMG.map.src = "/assets/map_super.png";

IMG.item_basket.src = "/assets/item_basket.png";
IMG.item_cat_rainbow.src = "/assets/item_cat_rainbow.png";
IMG.item_cat_orbit.src = "/assets/item_cat_orbit.png";
IMG.item_bag.src = "/assets/item_bag.png";
IMG.item_injection.src = "/assets/item_injection.png";

// =========================
// 画面フィット
// =========================
function fitCanvas() {
  dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  scale = Math.max(1, Math.floor(Math.min(vw / BASE_W, vh / BASE_H)));

  canvas.style.width = `${vw}px`;
  canvas.style.height = `${vh}px`;
  canvas.width = vw * dpr;
  canvas.height = vh * dpr;

  const drawW = BASE_W * scale;
  const drawH = BASE_H * scale;
  const offsetX = (vw - drawW) / 2;
  const offsetY = (vh - drawH) / 2;

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
function len(x, y) { return Math.hypot(x, y); }
function norm(x, y) {
  const L = Math.hypot(x, y);
  if (L < 1e-6) return { x: 0, y: 0 };
  return { x: x / L, y: y / L };
}

// 点と線分の距離^2（ビームの当たり判定）
function distPointToSegmentSq(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const abLenSq = abx * abx + aby * aby || 1e-9;
  let t = (apx * abx + apy * aby) / abLenSq;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

// =========================
// 効果音（簡易ビープ）
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
// 入力：アナログスティック + SCANボタン
// =========================
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

const ui = {
  joyZone: { x: 0, y: BASE_H * 0.45, w: BASE_W * 0.62, h: BASE_H * 0.55 },

  joyActive: false,
  joyPointerId: null,

  joyCenter: { x: 90, y: BASE_H - 120 },
  joyRadius: 62,
  knobRadius: 24,

  joyVec: { x: 0, y: 0 }, // -1..1
  deadZone: 0.10,

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
  const L = Math.hypot(dx, dy);

  const r = ui.joyRadius;
  const clamped = Math.min(L, r);
  const nx = L > 0 ? dx / L : 0;
  const ny = L > 0 ? dy / L : 0;

  ui.joyVec.x = (nx * clamped) / r;
  ui.joyVec.y = (ny * clamped) / r;

  const mag = Math.hypot(ui.joyVec.x, ui.joyVec.y);
  if (mag < ui.deadZone) {
    ui.joyVec.x = 0;
    ui.joyVec.y = 0;
  }
}

canvas.addEventListener("pointerdown", (e) => {
  const p = viewToWorldXY(e.clientX, e.clientY);

  // SCAN
  if (ptInRect(p, ui.scanRect)) {
    canvas.setPointerCapture(e.pointerId);
    requestScan();
    return;
  }

  // Joy
  if (ptInRect(p, ui.joyZone) && !ui.joyActive) {
    canvas.setPointerCapture(e.pointerId);
    ui.joyActive = true;
    ui.joyPointerId = e.pointerId;

    ui.joyCenter.x = clamp(p.x, 40, BASE_W * 0.62);
    ui.joyCenter.y = clamp(p.y, BASE_H * 0.55, BASE_H - 40);

    setJoyFromPoint(p);
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!ui.joyActive) return;
  if (e.pointerId !== ui.joyPointerId) return;
  setJoyFromPoint(viewToWorldXY(e.clientX, e.clientY));
});

canvas.addEventListener("pointerup", (e) => {
  if (ui.joyActive && e.pointerId === ui.joyPointerId) resetJoy();
});
canvas.addEventListener("pointercancel", (e) => {
  if (ui.joyActive && e.pointerId === ui.joyPointerId) resetJoy();
});

// PC用（任意）
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// =========================
// ゲーム状態
// =========================
const GAME = { over: false };

const player = {
  x: WORLD.w / 2,
  y: WORLD.h / 2,
  w: 54,
  h: 70,
  speed: 185,

  mental: 3,
  maxMental: 3,
  invuln: 0,

  // 360°照準（スティック方向）
  aimX: 0,
  aimY: 1,
};

const camera = { x: 0, y: 0 };

let score = 0;
let killCount = 0;

const enemies = [];
const items = [];     // ドロップアイテム（拾える）
const cats = [];      // 猫（仲間）
let vacuumTimer = 0;  // レジ袋：吸引残り秒

// 敵スケーリング
const DIFF = {
  speedBase: 50,
  speedCap: 90,
  speedStepPer50Kills: 5,

  maxEnemiesBase: 5,
  maxEnemiesCap: 15,
  maxEnemiesStepPer10Kills: 1,

  spawnCooldownMin: 0.25,
  spawnCooldownMax: 0.9,
};

let spawnCooldown = 0;

// ビーム
let scanCooldown = 0;
let scanFx = 0;
const SCAN = { length: 150, radius: 28 };
const lastBeam = { ax: 0, ay: 0, bx: 0, by: 0 };

// =========================
// マップ＆カメラ
// =========================
function updateCamera() {
  camera.x = player.x - BASE_W / 2;
  camera.y = player.y - BASE_H / 2;

  camera.x = clamp(camera.x, 0, WORLD.w - BASE_W);
  camera.y = clamp(camera.y, 0, WORLD.h - BASE_H);
}

// =========================
// 敵スポーン（画面外）
// =========================
function currentEnemySpeed() {
  const bonus = Math.floor(killCount / 50) * DIFF.speedStepPer50Kills;
  return clamp(DIFF.speedBase + bonus, DIFF.speedBase, DIFF.speedCap);
}
function currentMaxEnemies() {
  const add = Math.floor(killCount / 10) * DIFF.maxEnemiesStepPer10Kills;
  return clamp(DIFF.maxEnemiesBase + add, DIFF.maxEnemiesBase, DIFF.maxEnemiesCap);
}

function spawnEnemyOffscreen() {
  const margin = 80;

  const left = camera.x - margin;
  const right = camera.x + BASE_W + margin;
  const top = camera.y - margin;
  const bottom = camera.y + BASE_H + margin;

  // 画面外の4辺からランダム
  const side = Math.floor(Math.random() * 4);

  let x, y;
  if (side === 0) { // top
    x = rand(camera.x, camera.x + BASE_W);
    y = top;
  } else if (side === 1) { // bottom
    x = rand(camera.x, camera.x + BASE_W);
    y = bottom;
  } else if (side === 2) { // left
    x = left;
    y = rand(camera.y, camera.y + BASE_H);
  } else { // right
    x = right;
    y = rand(camera.y, camera.y + BASE_H);
  }

  // ワールド内に戻す（はみ出し防止）
  x = clamp(x, 0, WORLD.w);
  y = clamp(y, 0, WORLD.h);

  enemies.push({
    x, y,
    w: 56, h: 66,
    speed: currentEnemySpeed(),
  });
}

// =========================
// ドロップ抽選
// =========================
function rollDrop() {
  const r = Math.random() * 100;

  if (r < 60) return "basket";        // 60%
  if (r < 70) return "cat_orbit";     // +10%
  if (r < 75) return "cat_rainbow";   // +5%
  if (r < 80) return "bag";           // +5%
  if (r < 81) return "injection";     // +1%
  return null;                        // 19%
}

function spawnDropAt(x, y) {
  const type = rollDrop();
  if (!type) return;

  items.push({
    type,
    x: clamp(x, 0, WORLD.w),
    y: clamp(y, 0, WORLD.h),
    w: 42,
    h: 42,
  });
}

// =========================
// 猫（仲間）
// =========================
function addCat(type) {
  // duration: 永続でも良いけど、ゲームバランス用に長めの持続にしてる
  // ここは気に入らなければ "Infinity" にしてOK
  const duration = 35; // 秒
  cats.push({
    type, // "cat_rainbow" or "cat_orbit"
    t: 0,
    life: duration,
    x: player.x,
    y: player.y,
  });
}

// =========================
// スキャン（360°ビーム）
// =========================
function requestScan() {
  if (GAME.over) return;
  if (scanCooldown > 0) return;

  scanCooldown = 0.35;
  scanFx = 0.12;

  beep(880, 70, "square", 0.035);
  beep(1320, 40, "square", 0.02);

  const px = player.x + player.w / 2;
  const py = player.y + player.h / 2;

  const ax = px;
  const ay = py;
  const bx = px + player.aimX * SCAN.length;
  const by = py + player.aimY * SCAN.length;

  lastBeam.ax = ax; lastBeam.ay = ay; lastBeam.bx = bx; lastBeam.by = by;

  // 敵ヒット
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;

    if (distPointToSegmentSq(cx, cy, ax, ay, bx, by) <= SCAN.radius * SCAN.radius) {
      // 撃破
      enemies.splice(i, 1);
      onEnemyKilled(cx, cy);
    }
  }
}

function onEnemyKilled(x, y) {
  killCount += 1;
  score += 1;

  // 回復（仕様：倒すと回復）
  player.mental = Math.min(player.maxMental, player.mental + 1);

  // ドロップ
  spawnDropAt(x, y);

  // 難易度更新（次スポーンから）
  // 速度は spawnEnemyOffscreen 内で currentEnemySpeed() を使う
}

// =========================
// 更新
// =========================
function getMoveVector() {
  let vx = ui.joyVec.x;
  let vy = ui.joyVec.y;

  // PC補助
  let kx = 0, ky = 0;
  if (keys.has("a") || keys.has("arrowleft")) kx -= 1;
  if (keys.has("d") || keys.has("arrowright")) kx += 1;
  if (keys.has("w") || keys.has("arrowup")) ky -= 1;
  if (keys.has("s") || keys.has("arrowdown")) ky += 1;

  if (kx || ky) {
    const n = norm(kx, ky);
    vx += n.x;
    vy += n.y;
  }

  const L = Math.hypot(vx, vy);
  if (L > 1) { vx /= L; vy /= L; }

  return { vx, vy, mag: Math.hypot(vx, vy) };
}

function updateCats(dt) {
  // 猫の寿命減少
  for (let i = cats.length - 1; i >= 0; i--) {
    const c = cats[i];
    c.t += dt;
    c.life -= dt;
    if (c.life <= 0) cats.splice(i, 1);
  }

  // 猫の移動＆敵浄化
  for (const c of cats) {
    if (c.type === "cat_orbit") {
      // プレイヤー周りを円運動
      const radius = 70;
      const speed = 3.2; // 回転速度
      const ang = c.t * speed;

      c.x = player.x + player.w / 2 + Math.cos(ang) * radius;
      c.y = player.y + player.h / 2 + Math.sin(ang) * radius;

    } else if (c.type === "cat_rainbow") {
      // 最寄りの敵に追尾、いなければプレイヤーに戻る
      let target = null;
      let best = Infinity;

      for (const e of enemies) {
        const dx = (e.x + e.w / 2) - c.x;
        const dy = (e.y + e.h / 2) - c.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) {
          best = d2;
          target = e;
        }
      }

      let tx, ty;
      if (target) {
        tx = target.x + target.w / 2;
        ty = target.y + target.h / 2;
      } else {
        tx = player.x + player.w / 2;
        ty = player.y + player.h / 2;
      }

      const dx = tx - c.x;
      const dy = ty - c.y;
      const n = norm(dx, dy);
      const catSpeed = 210; // 追尾速度
      c.x += n.x * catSpeed * dt;
      c.y += n.y * catSpeed * dt;

      // ワールド内
      c.x = clamp(c.x, 0, WORLD.w);
      c.y = clamp(c.y, 0, WORLD.h);
    }

    // 猫が触れた敵は浄化（即死）
    const killRadius = 26;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const ex = e.x + e.w / 2;
      const ey = e.y + e.h / 2;
      const dx = ex - c.x;
      const dy = ey - c.y;
      if (dx * dx + dy * dy <= killRadius * killRadius) {
        enemies.splice(i, 1);
        onEnemyKilled(ex, ey);
      }
    }
  }
}

function updateItems(dt) {
  // レジ袋吸引：アイテムをプレイヤーに引き寄せる
  if (vacuumTimer > 0) {
    vacuumTimer -= dt;

    const pullR = 140;
    const pullSpeed = 380;

    const px = player.x + player.w / 2;
    const py = player.y + player.h / 2;

    for (const it of items) {
      const ix = it.x + it.w / 2;
      const iy = it.y + it.h / 2;
      const dx = px - ix;
      const dy = py - iy;
      const d = Math.hypot(dx, dy);

      if (d < pullR && d > 1) {
        const nx = dx / d;
        const ny = dy / d;
        it.x += nx * pullSpeed * dt;
        it.y += ny * pullSpeed * dt;
      }
    }
  }

  // 拾う
  const pbox = { x: player.x, y: player.y, w: player.w, h: player.h };
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (aabb(pbox, it)) {
      applyItem(it.type);
      items.splice(i, 1);
    }
  }
}

function applyItem(type) {
  if (type === "basket") {
    player.mental = Math.min(player.maxMental, player.mental + 1);
    beep(660, 60, "triangle", 0.03);

  } else if (type === "injection") {
    // 最大ライフ +1、回復も
    player.maxMental = Math.min(6, player.maxMental + 1);
    player.mental = player.maxMental;
    beep(980, 90, "square", 0.04);

  } else if (type === "bag") {
    vacuumTimer = 60;
    beep(520, 80, "sawtooth", 0.03);

  } else if (type === "cat_rainbow") {
    addCat("cat_rainbow");
    beep(880, 60, "square", 0.03);

  } else if (type === "cat_orbit") {
    addCat("cat_orbit");
    beep(740, 60, "square", 0.03);
  }
}

function update(dt) {
  if (GAME.over) return;

  if (scanCooldown > 0) scanCooldown -= dt;
  if (scanFx > 0) scanFx -= dt;
  if (player.invuln > 0) player.invuln -= dt;

  // aim更新：スティックが倒れてる限り360°で更新
  if (ui.joyVec.x !== 0 || ui.joyVec.y !== 0) {
    const n = norm(ui.joyVec.x, ui.joyVec.y);
    player.aimX = n.x;
    player.aimY = n.y;
  }

  // 移動
  const mv = getMoveVector();
  player.x += mv.vx * player.speed * dt;
  player.y += mv.vy * player.speed * dt;

  // ワールド境界（有限）
  player.x = clamp(player.x, 0, WORLD.w - player.w);
  player.y = clamp(player.y, 0, WORLD.h - player.h);

  updateCamera();

  // 敵の最大数に届くように湧かせる（上限つき）
  const maxE = currentMaxEnemies();
  spawnCooldown -= dt;

  // 湧き間隔：敵が増えるほど少し短く（ただし下限あり）
  const targetCd = clamp(0.9 - (maxE - DIFF.maxEnemiesBase) * 0.05, DIFF.spawnCooldownMin, DIFF.spawnCooldownMax);

  if (enemies.length < maxE && spawnCooldown <= 0) {
    spawnEnemyOffscreen();
    spawnCooldown = targetCd;
  }

  // 敵追尾
  for (const e of enemies) {
    // 速度は段階的に強化（上限あり）
    e.speed = currentEnemySpeed();

    const px = player.x + player.w / 2;
    const py = player.y + player.h / 2;
    const ex = e.x + e.w / 2;
    const ey = e.y + e.h / 2;

    const dx = px - ex;
    const dy = py - ey;
    const n = norm(dx, dy);

    e.x += n.x * e.speed * dt;
    e.y += n.y * e.speed * dt;

    // ワールド内
    e.x = clamp(e.x, 0, WORLD.w - e.w);
    e.y = clamp(e.y, 0, WORLD.h - e.h);
  }

  // 接触ダメージ
  const pbox = { x: player.x, y: player.y, w: player.w, h: player.h };
  for (const e of enemies) {
    if (player.invuln <= 0 && aabb(pbox, e)) {
      player.mental -= 1;
      player.invuln = 1.0;
      beep(120, 120, "square", 0.04);

      if (player.mental <= 0) {
        GAME.over = true;
        break;
      }
    }
  }

  // 猫＆アイテム
  updateCats(dt);
  updateItems(dt);
}

// =========================
// 描画：背景タイル（スーパー）
// =========================
function drawMap() {
  // タイルサイズ（画像の実サイズが取れない時の保険）
  const tileW = (IMG.map && IMG.map.complete) ? IMG.map.width : 128;
  const tileH = (IMG.map && IMG.map.complete) ? IMG.map.height : 128;

  // 画面に映る範囲（world座標）
  const viewL = camera.x;
  const viewT = camera.y;
  const viewR = camera.x + BASE_W;
  const viewB = camera.y + BASE_H;

  const startX = Math.floor(viewL / tileW) * tileW;
  const startY = Math.floor(viewT / tileH) * tileH;

  for (let y = startY; y < viewB; y += tileH) {
    for (let x = startX; x < viewR; x += tileW) {
      const sx = x - camera.x;
      const sy = y - camera.y;
      drawSprite(IMG.map, sx, sy, tileW, tileH);
    }
  }
}

// =========================
// 描画：UI
// =========================
function drawUI() {
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "16px system-ui";
  ctx.fillText(`Score: ${score}`, 10, 22);

  // ライフ
  const x0 = 10, y0 = 36;
  for (let i = 0; i < player.maxMental; i++) {
    const filled = i < player.mental;
    ctx.fillStyle = filled ? "rgba(255,80,120,0.95)" : "rgba(255,80,120,0.25)";
    ctx.fillRect(x0 + i * 18, y0, 14, 14);
  }

  // 吸引残り
  if (vacuumTimer > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "12px system-ui";
    ctx.fillText(`BAG: ${Math.ceil(vacuumTimer)}s`, 10, 68);
  }
}

function drawJoystick() {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.beginPath();
  ctx.arc(ui.joyCenter.x, ui.joyCenter.y, ui.joyRadius, 0, Math.PI * 2);
  ctx.fill();

  const knobX = ui.joyCenter.x + ui.joyVec.x * ui.joyRadius;
  const knobY = ui.joyCenter.y + ui.joyVec.y * ui.joyRadius;

  ctx.globalAlpha = 0.48;
  ctx.beginPath();
  ctx.arc(knobX, knobY, ui.knobRadius, 0, Math.PI * 2);
  ctx.fill();

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
  // roundRect互換
  if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, 12);
  else {
    const rr = 12;
    ctx.moveTo(r.x + rr, r.y);
    ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr);
    ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr);
    ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr);
    ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = "18px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("SCAN", r.x + r.w / 2, r.y + r.h / 2);

  ctx.restore();
}

function drawScanFx() {
  if (scanFx <= 0) return;
  const alpha = clamp(scanFx / 0.12, 0, 1);

  // ビーム線分は world座標 → screen座標に変換して描く
  const ax = lastBeam.ax - camera.x;
  const ay = lastBeam.ay - camera.y;
  const bx = lastBeam.bx - camera.x;
  const by = lastBeam.by - camera.y;

  ctx.save();
  ctx.globalAlpha = 0.25 * alpha;
  ctx.strokeStyle = "rgba(80,255,200,1)";
  ctx.lineWidth = SCAN.radius * 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();

  ctx.globalAlpha = 0.75 * alpha;
  ctx.strokeStyle = "rgba(200,255,240,1)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}

function drawGameOver() {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.textAlign = "center";
  ctx.font = "28px system-ui";
  ctx.fillText("GAME OVER", BASE_W / 2, BASE_H / 2 - 40);

  ctx.font = "16px system-ui";
  ctx.fillText(`Score: ${score}`, BASE_W / 2, BASE_H / 2 - 10);

  ctx.font = "14px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("リロードして再挑戦（次でリスタート実装も可）", BASE_W / 2, BASE_H / 2 + 22);

  ctx.restore();
}

// =========================
// 描画
// =========================
function draw() {
  ctx.clearRect(0, 0, BASE_W, BASE_H);

  // 背景（タイル）
  drawMap();

  // アイテム（world→screen）
  for (const it of items) {
    const sx = it.x - camera.x;
    const sy = it.y - camera.y;

    let img = IMG.item_basket;
    if (it.type === "cat_rainbow") img = IMG.item_cat_rainbow;
    else if (it.type === "cat_orbit") img = IMG.item_cat_orbit;
    else if (it.type === "bag") img = IMG.item_bag;
    else if (it.type === "injection") img = IMG.item_injection;

    drawSprite(img, sx, sy, it.w, it.h);
  }

  // 敵
  for (const e of enemies) {
    drawSprite(IMG.ojisan, e.x - camera.x, e.y - camera.y, e.w, e.h);
  }

  // 猫（小さめ）
  for (const c of cats) {
    const sx = c.x - camera.x;
    const sy = c.y - camera.y;
    const w = 30, h = 30;
    const img = (c.type === "cat_rainbow") ? IMG.item_cat_rainbow : IMG.item_cat_orbit;
    drawSprite(img, sx - w / 2, sy - h / 2, w, h);
  }

  // プレイヤー
  drawSprite(IMG.player, player.x - camera.x, player.y - camera.y, player.w, player.h);

  // ビーム
  drawScanFx();

  // UI
  drawUI();
  drawJoystick();
  drawScanButton();

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

// =========================
// スキャン：ボタン以外でもPCで Space/Enter
// =========================
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === " " || k === "enter") requestScan();
});
