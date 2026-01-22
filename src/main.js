// =========================
// JKスーパーサバイバー（完全版 v1.3）
// 追加：
// - 50体ごとに敵速度/湧き上限を少しずつ解除（暴走しない上限）
// - 敵が「お金」を落とす（50体ごとに上位金額が出やすい）
// - お金でUPGRADE → 食材武器へ自動交換（ランダム成長）
//   * 大根ロケット（ホーミング）
//   * にんじんピストル（最寄りへ連射）
//   * じゃがいも爆弾（周囲AoE）
// 既存：
// - 当たり判定小さめ / トースト / GAME OVER→SCANで即リスタ / 猫∞ / 残像対策
// - 敵撃破でHP回復（ON） / カゴ取得でもHP回復（ON）
// =========================

// ★反映確認タグ（ビルドタグ）
// これが画面右上に出ていれば「今デプロイされているJS」がこのファイル
const BUILD_TAG = "v1.3-money-build-" + Date.now();
console.log("[BUILD_TAG]", BUILD_TAG);

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const BASE_W = 360;
const BASE_H = 640;

let dpr = 1;
let scale = 1;
let lastTime = 0;

const WORLD = { w: 6000, h: 6000 };

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

  money_100: new Image(),
  money_1000: new Image(),
  money_10000: new Image(),
};

IMG.player.src = "/assets/player.png";
IMG.ojisan.src = "/assets/ojisan.png";
IMG.map.src = "/assets/map_super.png";

IMG.item_basket.src = "/assets/item_basket.png";
IMG.item_cat_rainbow.src = "/assets/item_cat_rainbow.png";
IMG.item_cat_orbit.src = "/assets/item_cat_orbit.png";
IMG.item_bag.src = "/assets/item_bag.png";
IMG.item_injection.src = "/assets/item_injection.png";

// お金画像（なくても動く：無ければ四角で描画する）
IMG.money_100.src = "/assets/money_100.png";
IMG.money_1000.src = "/assets/money_1000.png";
IMG.money_10000.src = "/assets/money_10000.png";

// =========================
// Canvas fit（スマホ全画面）
// =========================
function fitCanvas() {
  dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  scale = Math.max(1, Math.min(vw / BASE_W, vh / BASE_H));

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
// Utils
// =========================
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function drawSprite(img, x, y, w, h) {
  if (!img || !img.complete || img.naturalWidth === 0) return false;
  ctx.drawImage(img, x, y, w, h);
  return true;
}
function norm(x, y) {
  const L = Math.hypot(x, y);
  if (L < 1e-6) return { x: 0, y: 0, L: 0 };
  return { x: x / L, y: y / L, L };
}
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
// Audio（簡易ビープ）
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
// 入力（アナログ + SCAN + UPGRADE）
// =========================
function viewToBase(clientX, clientY) {
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
  joyVec: { x: 0, y: 0 },
  deadZone: 0.10,

  // 右下：SCAN
  scanRect: { x: BASE_W - 160, y: BASE_H - 120, w: 140, h: 70 },

  // 右下：UPGRADE（SCANの上）
  upRect: { x: BASE_W - 160, y: BASE_H - 200, w: 140, h: 60 },
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

// =========================
// Toast
// =========================
const toast = { text: "", t: 0 };
function showToast(text, seconds = 2.0) {
  toast.text = text;
  toast.t = seconds;
}

// =========================
// ゲーム状態
// =========================
const GAME = { over: false };

const player = {
  x: WORLD.w / 2,
  y: WORLD.h / 2,
  w: 92,
  h: 92,
  speed: 185,

  mental: 3,
  maxMental: 3,
  invuln: 0,

  aimX: 0,
  aimY: 1,
};

// ★当たり判定（ここをいじる）
const PLAYER_HIT_INSET = { l: 24, r: 24, t: 28, b: 22 };
function getPlayerHitbox() {
  return {
    x: player.x + PLAYER_HIT_INSET.l,
    y: player.y + PLAYER_HIT_INSET.t,
    w: player.w - PLAYER_HIT_INSET.l - PLAYER_HIT_INSET.r,
    h: player.h - PLAYER_HIT_INSET.t - PLAYER_HIT_INSET.b,
  };
}

const camera = { x: 0, y: 0 };

let score = 0;      // 撃破スコア
let killCount = 0;  // 総撃破数
let money = 0;      // 所持金（円）

const enemies = [];
const items = [];
const cats = []; // 寿命∞

let vacuumTimer = 0;

// ビルド（武器）
const build = {
  level: 0,
  nextCost: 500,
  daikon: 0, // 大根ロケット
  carrot: 0, // にんじんピストル
  potato: 0, // じゃがいも爆弾
};

function calcNextCost(lv) {
  return Math.floor(500 * Math.pow(1.25, lv)); // 500→625→781→...
}

// 自動攻撃用
const projectiles = [];
const aoeBursts = [];
const weaponTimer = {
  carrot: 0,
  daikon: 0,
  potato: 0,
};

const DIFF = {
  // 50体ごとに上限をじわっと解除する方針
  speedBase: 50,
  speedCapBase: 90,
  speedCapMax: 115,

  maxEnemiesBase: 5,
  maxEnemiesCapBase: 15,
  maxEnemiesCapMax: 24,

  spawnCooldownMin: 0.22,
  spawnCooldownMax: 0.90,
};
let spawnCooldown = 0;

let scanCooldown = 0;
let scanFx = 0;
const SCAN = { length: 150, radius: 28 };
const lastBeam = { ax: 0, ay: 0, bx: 0, by: 0 };

// =========================
// カメラ
// =========================
function updateCamera() {
  camera.x = player.x - BASE_W / 2;
  camera.y = player.y - BASE_H / 2;
  camera.x = clamp(camera.x, 0, WORLD.w - BASE_W);
  camera.y = clamp(camera.y, 0, WORLD.h - BASE_H);
}

// =========================
// 難易度（50体ごとに解除）
// =========================
function currentEnemySpeed() {
  const phase = Math.floor(killCount / 50); // 0,1,2...
  const base = DIFF.speedBase + phase * 4; // 少しずつ上がる
  const cap = Math.min(DIFF.speedCapBase + phase * 3, DIFF.speedCapMax);
  return clamp(base, DIFF.speedBase, cap);
}
function currentMaxEnemies() {
  const phase = Math.floor(killCount / 50);
  const base = DIFF.maxEnemiesBase + phase * 2;
  const cap = Math.min(DIFF.maxEnemiesCapBase + phase * 2, DIFF.maxEnemiesCapMax);
  return clamp(base, DIFF.maxEnemiesBase, cap);
}

// =========================
// リスタート
// =========================
function resetGame() {
  GAME.over = false;

  player.x = WORLD.w / 2;
  player.y = WORLD.h / 2;

  player.maxMental = 3;
  player.mental = 3;
  player.invuln = 0;

  player.aimX = 0;
  player.aimY = 1;

  score = 0;
  killCount = 0;
  money = 0;

  enemies.length = 0;
  items.length = 0;
  cats.length = 0;

  projectiles.length = 0;
  aoeBursts.length = 0;

  vacuumTimer = 0;
  scanCooldown = 0;
  scanFx = 0;
  spawnCooldown = 0;

  build.level = 0;
  build.nextCost = 500;
  build.daikon = 0;
  build.carrot = 0;
  build.potato = 0;

  weaponTimer.carrot = 0;
  weaponTimer.daikon = 0;
  weaponTimer.potato = 0;

  toast.text = "";
  toast.t = 0;

  updateCamera();
  beep(660, 80, "triangle", 0.03);
  beep(880, 60, "square", 0.03);
  showToast("リスタート！", 1.2);
}

// =========================
// 敵スポーン（画面外）
// =========================
function spawnEnemyOffscreen() {
  const margin = 80;

  const left = camera.x - margin;
  const right = camera.x + BASE_W + margin;
  const top = camera.y - margin;
  const bottom = camera.y + BASE_H + margin;

  const side = Math.floor(Math.random() * 4);
  let x, y;

  if (side === 0) { x = rand(camera.x, camera.x + BASE_W); y = top; }
  else if (side === 1) { x = rand(camera.x, camera.x + BASE_W); y = bottom; }
  else if (side === 2) { x = left; y = rand(camera.y, camera.y + BASE_H); }
  else { x = right; y = rand(camera.y, camera.y + BASE_H); }

  x = clamp(x, 0, WORLD.w);
  y = clamp(y, 0, WORLD.h);

  enemies.push({
    x, y,
    w: 72, h: 84,
    speed: currentEnemySpeed(),
  });
}

// =========================
// ドロップ（既存アイテム）
// =========================
function rollDrop() {
  const r = Math.random() * 100;
  if (r < 60) return "basket";
  if (r < 70) return "cat_orbit";
  if (r < 75) return "cat_rainbow";
  if (r < 80) return "bag";
  if (r < 81) return "injection";
  return null;
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
// お金ドロップ（50体ごとに上位が出やすい）
// =========================
function moneyDropTable() {
  const phase = Math.floor(killCount / 50);

  // 0〜50: 100円80% / 1000円15% / 10000円5%
  let p100 = 0.80;
  let p1k = 0.15;

  // 50体ごとに上位へ寄せる（暴走しない）
  p100 = Math.max(0.55, p100 - phase * 0.05);
  p1k = Math.min(0.30, p1k + phase * 0.03);
  let p10k = 1 - p100 - p1k;
  p10k = clamp(p10k, 0.05, 0.25);

  // 再正規化
  const s = p100 + p1k + p10k;
  p100 /= s; p1k /= s; p10k /= s;

  return [
    { value: 100, p: p100 },
    { value: 1000, p: p1k },
    { value: 10000, p: p10k },
  ];
}
function rollMoneyValue() {
  const t = moneyDropTable();
  const r = Math.random();
  let acc = 0;
  for (const row of t) {
    acc += row.p;
    if (r <= acc) return row.value;
  }
  return t[t.length - 1].value;
}
function spawnMoneyAt(x, y) {
  const value = rollMoneyValue();
  items.push({
    type: "money",
    value,
    x: clamp(x, 0, WORLD.w),
    y: clamp(y, 0, WORLD.h),
    w: 38,
    h: 38,
  });
}

// =========================
// 猫（∞）
// =========================
function addCat(type) {
  cats.push({ type, t: 0, x: player.x, y: player.y });
  if (type === "cat_rainbow") showToast("🌈 虹猫：敵を追って浄化！", 2.2);
  if (type === "cat_orbit") showToast("🐱 守護猫：周回バリア！", 2.2);
}

// =========================
// アイテム適用
// =========================
function applyItem(type) {
  if (type === "basket") {
    const before = player.mental;
    player.mental = Math.min(player.maxMental, player.mental + 1);
    beep(660, 60, "triangle", 0.03);
    showToast(`🧺 カゴ：メンタル +1（${before}→${player.mental}）`, 2.0);

  } else if (type === "injection") {
    const beforeMax = player.maxMental;
    player.maxMental = Math.min(6, player.maxMental + 1);
    player.mental = player.maxMental;
    beep(980, 90, "square", 0.04);
    showToast(`💉 注射：最大+1（${beforeMax}→${player.maxMental}）＆全回復`, 2.4);

  } else if (type === "bag") {
    vacuumTimer = 60;
    beep(520, 80, "sawtooth", 0.03);
    showToast("🛍 レジ袋：60秒アイテム吸引！", 2.2);

  } else if (type === "cat_rainbow") {
    addCat("cat_rainbow");
    beep(880, 60, "square", 0.03);

  } else if (type === "cat_orbit") {
    addCat("cat_orbit");
    beep(740, 60, "square", 0.03);
  }
}

// =========================
// 敵撃破（回復ON）
// =========================
function onEnemyKilled(x, y) {
  killCount += 1;
  score += 1;

  // 撃破で回復（ON）
  player.mental = Math.min(player.maxMental, player.mental + 1);

  // お金を落とす（常に）
  spawnMoneyAt(x, y);

  // 既存アイテムも抽選で落とす
  spawnDropAt(x, y);

  beep(220, 55, "sawtooth", 0.025);
  beep(160, 70, "sawtooth", 0.018);
}

// =========================
// UPGRADE：お金でレベルアップ→食材武器ランダム強化
// =========================
function buyUpgrade() {
  if (GAME.over) return;

  if (money < build.nextCost) {
    beep(220, 80, "sawtooth", 0.02);
    showToast(`お金が足りない！ ${build.nextCost}円`, 1.2);
    return;
  }

  money -= build.nextCost;
  build.level += 1;
  build.nextCost = calcNextCost(build.level);

  // ランダム強化（均等）
  const r = Math.random();
  let pick = "daikon";
  if (r < 0.34) pick = "daikon";
  else if (r < 0.67) pick = "carrot";
  else pick = "potato";

  build[pick] += 1;

  const label =
    pick === "daikon" ? "🥬 大根ロケット" :
    pick === "carrot" ? "🥕 にんじんピストル" :
                        "🥔 じゃがいも爆弾";

  beep(880, 70, "triangle", 0.03);
  showToast(`UPGRADE！ ${label} Lv.${build[pick]}`, 1.8);
}

// =========================
// SCAN
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

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    if (distPointToSegmentSq(cx, cy, ax, ay, bx, by) <= SCAN.radius * SCAN.radius) {
      enemies.splice(i, 1);
      onEnemyKilled(cx, cy);
    }
  }
}

// =========================
// 操作：SCAN / UPGRADE（GAME OVER時はSCANで即リスタ）
// =========================
function onScanPressed() {
  if (GAME.over) { resetGame(); return; }
  requestScan();
}

canvas.addEventListener("pointerdown", (e) => {
  const p = viewToBase(e.clientX, e.clientY);

  // 右下：SCAN
  if (ptInRect(p, ui.scanRect)) {
    canvas.setPointerCapture(e.pointerId);
    onScanPressed();
    return;
  }

  // 右下：UPGRADE
  if (ptInRect(p, ui.upRect)) {
    canvas.setPointerCapture(e.pointerId);
    buyUpgrade();
    return;
  }

  // 左下：ジョイスティック
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
  setJoyFromPoint(viewToBase(e.clientX, e.clientY));
});
canvas.addEventListener("pointerup", (e) => {
  if (ui.joyActive && e.pointerId === ui.joyPointerId) resetJoy();
});
canvas.addEventListener("pointercancel", (e) => {
  if (ui.joyActive && e.pointerId === ui.joyPointerId) resetJoy();
});

// PC
const keys = new Set();
window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key === " " || e.key === "Enter") onScanPressed();
  if (e.key.toLowerCase() === "u") buyUpgrade();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// =========================
// 移動ベクトル（斜めOK）
// =========================
function getMoveVector() {
  let vx = ui.joyVec.x;
  let vy = ui.joyVec.y;

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
  return { vx, vy };
}

// =========================
// 猫更新
// =========================
function updateCats(dt) {
  for (const c of cats) {
    c.t += dt;

    if (c.type === "cat_orbit") {
      const radius = 70;
      const speed = 3.2;
      const ang = c.t * speed;
      c.x = player.x + player.w / 2 + Math.cos(ang) * radius;
      c.y = player.y + player.h / 2 + Math.sin(ang) * radius;

    } else if (c.type === "cat_rainbow") {
      let target = null;
      let best = Infinity;
      for (const e of enemies) {
        const dx = (e.x + e.w / 2) - c.x;
        const dy = (e.y + e.h / 2) - c.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; target = e; }
      }

      let tx, ty;
      if (target) {
        tx = target.x + target.w / 2;
        ty = target.y + target.h / 2;
      } else {
        tx = player.x + player.w / 2;
        ty = player.y + player.h / 2;
      }

      const n = norm(tx - c.x, ty - c.y);
      const catSpeed = 210;
      c.x += n.x * catSpeed * dt;
      c.y += n.y * catSpeed * dt;

      c.x = clamp(c.x, 0, WORLD.w);
      c.y = clamp(c.y, 0, WORLD.h);
    }

    // 敵浄化（猫触れたら即死）
    const killR = 26;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const ex = e.x + e.w / 2;
      const ey = e.y + e.h / 2;
      const dx = ex - c.x;
      const dy = ey - c.y;
      if (dx * dx + dy * dy <= killR * killR) {
        enemies.splice(i, 1);
        onEnemyKilled(ex, ey);
      }
    }
  }
}

// =========================
// 武器：ターゲット取得
// =========================
function findNearestEnemy(x, y) {
  let best = null;
  let bestD2 = Infinity;
  for (const e of enemies) {
    const ex = e.x + e.w / 2;
    const ey = e.y + e.h / 2;
    const dx = ex - x;
    const dy = ey - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = e; }
  }
  return best;
}

// =========================
// 武器：自動攻撃更新
// =========================
function updateWeapons(dt) {
  const px = player.x + player.w / 2;
  const py = player.y + player.h / 2;

  // にんじんピストル：最寄りへ連射
  if (build.carrot > 0) {
    weaponTimer.carrot -= dt;
    const rate = clamp(0.55 - build.carrot * 0.05, 0.18, 0.55); // Lv上がるほど速い
    if (weaponTimer.carrot <= 0) {
      weaponTimer.carrot = rate;
      const t = findNearestEnemy(px, py);
      if (t) {
        const tx = t.x + t.w / 2;
        const ty = t.y + t.h / 2;
        const n = norm(tx - px, ty - py);
        projectiles.push({
          kind: "carrot",
          x: px, y: py,
          vx: n.x * 520,
          vy: n.y * 520,
          r: 6,
          life: 1.2,
        });
        beep(980, 22, "square", 0.01);
      }
    }
  }

  // 大根ロケット：ホーミング（ゆっくり強い）
  if (build.daikon > 0) {
    weaponTimer.daikon -= dt;
    const rate = clamp(1.2 - build.daikon * 0.08, 0.45, 1.2);
    if (weaponTimer.daikon <= 0) {
      weaponTimer.daikon = rate;
      const t = findNearestEnemy(px, py);
      if (t) {
        projectiles.push({
          kind: "daikon",
          x: px, y: py,
          vx: 0, vy: 0,
          speed: clamp(240 + build.daikon * 12, 240, 340),
          r: 10,
          life: 2.4,
          turn: 7.0, // 追尾強さ
        });
        beep(520, 35, "triangle", 0.012);
      }
    }
  }

  // じゃがいも爆弾：周囲AoE
  if (build.potato > 0) {
    weaponTimer.potato -= dt;
    const rate = clamp(2.2 - build.potato * 0.12, 0.85, 2.2);
    if (weaponTimer.potato <= 0) {
      weaponTimer.potato = rate;
      aoeBursts.push({
        x: px, y: py,
        r: clamp(70 + build.potato * 10, 70, 140),
        t: 0.18,
      });
      beep(140, 60, "sawtooth", 0.015);
    }
  }
}

// =========================
// 弾更新
// =========================
function updateProjectiles(dt) {
  // AoE
  for (let i = aoeBursts.length - 1; i >= 0; i--) {
    const a = aoeBursts[i];
    a.t -= dt;

    // 当たり判定（敵中心がAoE内）
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      const ex = e.x + e.w / 2;
      const ey = e.y + e.h / 2;
      const dx = ex - a.x;
      const dy = ey - a.y;
      if (dx * dx + dy * dy <= a.r * a.r) {
        enemies.splice(j, 1);
        onEnemyKilled(ex, ey);
      }
    }

    if (a.t <= 0) aoeBursts.splice(i, 1);
  }

  // projectile
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;

    if (p.kind === "daikon") {
      // 追尾
      const t = findNearestEnemy(p.x, p.y);
      if (t) {
        const tx = t.x + t.w / 2;
        const ty = t.y + t.h / 2;
        const n = norm(tx - p.x, ty - p.y);
        // 速度をターゲット方向へ寄せる
        const desiredVx = n.x * p.speed;
        const desiredVy = n.y * p.speed;
        const lerp = clamp(p.turn * dt, 0, 1);
        p.vx = p.vx + (desiredVx - p.vx) * lerp;
        p.vy = p.vy + (desiredVy - p.vy) * lerp;
      }
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // 画面外で消す
    if (p.x < -200 || p.y < -200 || p.x > WORLD.w + 200 || p.y > WORLD.h + 200) p.life = -1;

    // ヒット判定（弾中心が敵のAABBに入ったら）
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      const ex = e.x + e.w / 2;
      const ey = e.y + e.h / 2;
      const dx = ex - p.x;
      const dy = ey - p.y;
      if (dx * dx + dy * dy <= (p.r + 18) * (p.r + 18)) {
        enemies.splice(j, 1);
        onEnemyKilled(ex, ey);
        p.life = -1;
        break;
      }
    }

    if (p.life <= 0) projectiles.splice(i, 1);
  }
}

// =========================
// アイテム更新（お金も拾う）
// =========================
function updateItems(dt) {
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

  const pbox = getPlayerHitbox();
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (!aabb(pbox, it)) continue;

    if (it.type === "money") {
      money += it.value;
      beep(780, 35, "square", 0.012);
      showToast(`💴 +${it.value}円`, 1.1);
      items.splice(i, 1);
      continue;
    }

    applyItem(it.type);
    items.splice(i, 1);
  }
}

// =========================
// Update
// =========================
function update(dt) {
  if (toast.t > 0) toast.t -= dt;
  if (GAME.over) return;

  if (scanCooldown > 0) scanCooldown -= dt;
  if (scanFx > 0) scanFx -= dt;
  if (player.invuln > 0) player.invuln -= dt;

  // aim：スティック方向
  if (ui.joyVec.x !== 0 || ui.joyVec.y !== 0) {
    const n = norm(ui.joyVec.x, ui.joyVec.y);
    if (n.L > 0) { player.aimX = n.x; player.aimY = n.y; }
  }

  // 移動
  const mv = getMoveVector();
  player.x += mv.vx * player.speed * dt;
  player.y += mv.vy * player.speed * dt;

  player.x = clamp(player.x, 0, WORLD.w - player.w);
  player.y = clamp(player.y, 0, WORLD.h - player.h);

  updateCamera();

  // 敵スポーン
  const maxE = currentMaxEnemies();
  spawnCooldown -= dt;

  const targetCd = clamp(
    0.9 - (maxE - DIFF.maxEnemiesBase) * 0.05,
    DIFF.spawnCooldownMin,
    DIFF.spawnCooldownMax
  );

  if (enemies.length < maxE && spawnCooldown <= 0) {
    spawnEnemyOffscreen();
    spawnCooldown = targetCd;
  }

  // 敵追尾
  const psx = player.x + player.w / 2;
  const psy = player.y + player.h / 2;

  for (const e of enemies) {
    e.speed = currentEnemySpeed();
    const esx = e.x + e.w / 2;
    const esy = e.y + e.h / 2;

    const n = norm(psx - esx, psy - esy);
    e.x += n.x * e.speed * dt;
    e.y += n.y * e.speed * dt;

    e.x = clamp(e.x, 0, WORLD.w - e.w);
    e.y = clamp(e.y, 0, WORLD.h - e.h);
  }

  // 接触ダメ（小ヒットボックス）
  const pbox = getPlayerHitbox();
  for (const e of enemies) {
    if (player.invuln <= 0 && aabb(pbox, e)) {
      player.mental -= 1;
      player.invuln = 1.0;
      beep(120, 120, "square", 0.04);

      if (player.mental <= 0) {
        GAME.over = true;
        showToast("GAME OVER… SCANでリスタート", 3.0);
        break;
      }
    }
  }

  updateCats(dt);
  updateWeapons(dt);
  updateProjectiles(dt);
  updateItems(dt);
}

// =========================
// Draw：背景（残像対策）
// =========================
function drawMap() {
  ctx.clearRect(0, 0, BASE_W, BASE_H);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  if (!IMG.map || !IMG.map.complete || IMG.map.naturalWidth === 0) {
    const s = 32;
    for (let y = 0; y < BASE_H; y += s) {
      for (let x = 0; x < BASE_W; x += s) {
        ctx.fillStyle = ((x / s + y / s) % 2 === 0)
          ? "rgba(255,255,255,0.04)"
          : "rgba(255,255,255,0.02)";
        ctx.fillRect(x, y, s, s);
      }
    }
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "12px system-ui";
    ctx.fillText("map_super.png 未ロード：public/assets を確認", 10, BASE_H - 10);
    return;
  }

  const tileW = IMG.map.naturalWidth;
  const tileH = IMG.map.naturalHeight;

  const viewL = camera.x;
  const viewT = camera.y;
  const viewR = camera.x + BASE_W;
  const viewB = camera.y + BASE_H;

  const startX = Math.floor(viewL / tileW) * tileW;
  const startY = Math.floor(viewT / tileH) * tileH;

  for (let wy = startY - tileH; wy < viewB + tileH; wy += tileH) {
    for (let wx = startX - tileW; wx < viewR + tileW; wx += tileW) {
      const sx = wx - camera.x;
      const sy = wy - camera.y;
      ctx.drawImage(IMG.map, sx, sy, tileW, tileH);
    }
  }
}

// =========================
// Draw：UI
// =========================
function drawUI() {
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "16px system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`Score: ${score}`, 10, 22);

  // money
  ctx.font = "14px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillText(`Money: ${money}円`, 10, 44);

  // build
  ctx.font = "12px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.fillText(`Lv:${build.level}  次:${build.nextCost}円`, 10, 62);
  ctx.fillText(`大根:${build.daikon} にんじん:${build.carrot} じゃが:${build.potato}`, 10, 78);

  // HP
  const x0 = 10, y0 = 92;
  for (let i = 0; i < player.maxMental; i++) {
    const filled = i < player.mental;
    ctx.fillStyle = filled ? "rgba(255,80,120,0.95)" : "rgba(255,80,120,0.25)";
    ctx.fillRect(x0 + i * 18, y0, 14, 14);
  }

  if (vacuumTimer > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "12px system-ui";
    ctx.fillText(`BAG: ${Math.ceil(vacuumTimer)}s`, 10, 126);
  }

  if (toast.t > 0 && toast.text) {
    const alpha = clamp(toast.t / 2.0, 0.25, 1);
    ctx.save();
    ctx.globalAlpha = 0.9 * alpha;
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const padX = 12;
    const metrics = ctx.measureText(toast.text);
    const w = clamp(metrics.width + padX * 2, 180, BASE_W - 24);
    const h = 30;

    const x = BASE_W / 2 - w / 2;
    const y = 98;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10);
    else ctx.rect(x, y, w, h);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(toast.text, BASE_W / 2, y + h / 2);
    ctx.restore();
  }

  // ★ビルドタグ表示（右上）
  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.font = "11px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(BUILD_TAG, BASE_W - 6, 14);
  ctx.restore();
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

function drawButton(r, label, alphaFill = 0.12) {
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${alphaFill})`;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;

  ctx.beginPath();
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
  ctx.font = "16px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
  ctx.restore();
}

function drawScanFx() {
  if (scanFx <= 0) return;
  const alpha = clamp(scanFx / 0.12, 0, 1);

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
  ctx.fillText("SCANで即リスタート", BASE_W / 2, BASE_H / 2 + 22);
  ctx.restore();
}

// =========================
// Draw
// =========================
function drawWorld() {
  drawMap();

  // items
  for (const it of items) {
    const sx = it.x - camera.x;
    const sy = it.y - camera.y;

    if (it.type === "money") {
      let img = null;
      if (it.value === 100) img = IMG.money_100;
      else if (it.value === 1000) img = IMG.money_1000;
      else img = IMG.money_10000;

      const ok = drawSprite(img, sx, sy, it.w, it.h);
      if (!ok) {
        // 画像なければ代替描画
        ctx.save();
        ctx.fillStyle = it.value === 100 ? "rgba(255,240,120,0.9)"
                    : it.value === 1000 ? "rgba(170,255,170,0.9)"
                                        : "rgba(255,170,255,0.9)";
        ctx.fillRect(sx, sy, it.w, it.h);
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.font = "10px system-ui";
        ctx.fillText(String(it.value), sx + 4, sy + 14);
        ctx.restore();
      }
      continue;
    }

    let img = IMG.item_basket;
    if (it.type === "cat_rainbow") img = IMG.item_cat_rainbow;
    else if (it.type === "cat_orbit") img = IMG.item_cat_orbit;
    else if (it.type === "bag") img = IMG.item_bag;
    else if (it.type === "injection") img = IMG.item_injection;

    drawSprite(img, sx, sy, it.w, it.h);
  }

  // enemies
  for (const e of enemies) {
    drawSprite(IMG.ojisan, e.x - camera.x, e.y - camera.y, e.w, e.h);
  }

  // cats
  for (const c of cats) {
    const sx = c.x - camera.x;
    const sy = c.y - camera.y;
    const w = 30, h = 30;
    const img = (c.type === "cat_rainbow") ? IMG.item_cat_rainbow : IMG.item_cat_orbit;
    drawSprite(img, sx - w / 2, sy - h / 2, w, h);
  }

  // projectiles
  ctx.save();
  for (const p of projectiles) {
    const sx = p.x - camera.x;
    const sy = p.y - camera.y;
    ctx.fillStyle = p.kind === "carrot" ? "rgba(255,180,80,0.9)"
                : p.kind === "daikon" ? "rgba(220,255,220,0.9)"
                                     : "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(sx, sy, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  // AoE
  for (const a of aoeBursts) {
    const sx = a.x - camera.x;
    const sy = a.y - camera.y;
    ctx.globalAlpha = clamp(a.t / 0.18, 0, 1) * 0.35;
    ctx.fillStyle = "rgba(255,220,120,1)";
    ctx.beginPath();
    ctx.arc(sx, sy, a.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // player
  drawSprite(IMG.player, player.x - camera.x, player.y - camera.y, player.w, player.h);

  // beam
  drawScanFx();

  // ui
  drawUI();
  drawJoystick();

  drawButton(ui.upRect, `UPGRADE`);
  drawButton(ui.scanRect, GAME.over ? "RETRY" : "SCAN", 0.12);

  if (GAME.over) drawGameOver();
}

// =========================
// Loop
// =========================
function loop(t) {
  const now = t / 1000;
  const dt = Math.min(0.033, now - (lastTime || now));
  lastTime = now;

  update(dt);
  drawWorld();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
