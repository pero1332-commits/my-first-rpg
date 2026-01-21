// =========================
// JKスーパーRPG
// 真・アナログスティック + 360°スキャンビーム完全版
// =========================

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

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
// Canvas fit
// =========================
function fitCanvas() {
  dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const vw = innerWidth, vh = innerHeight;

  scale = Math.max(1, Math.floor(Math.min(vw / BASE_W, vh / BASE_H)));

  canvas.width = vw * dpr;
  canvas.height = vh * dpr;
  canvas.style.width = vw + "px";
  canvas.style.height = vh + "px";

  const ox = (vw - BASE_W * scale) / 2;
  const oy = (vh - BASE_H * scale) / 2;

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr, oy * dpr);
  ctx.imageSmoothingEnabled = false;
}
addEventListener("resize", fitCanvas);
fitCanvas();

// =========================
// Utils
// =========================
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const rand = (a,b)=>a+Math.random()*(b-a);
const aabb=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;

// 点と線分距離²（360°ビーム用）
function distToSegSq(px,py,ax,ay,bx,by){
  const abx=bx-ax, aby=by-ay;
  const apx=px-ax, apy=py-ay;
  const t=clamp((apx*abx+apy*aby)/(abx*abx+aby*aby||1),0,1);
  const cx=ax+abx*t, cy=ay+aby*t;
  return (px-cx)**2+(py-cy)**2;
}

// =========================
// Audio
// =========================
let audioCtx=null;
function beep(f=880,ms=60){
  try{
    audioCtx ||= new AudioContext();
    const o=audioCtx.createOscillator();
    const g=audioCtx.createGain();
    o.frequency.value=f;
    g.gain.value=0.03;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime+ms/1000);
  }catch{}
}

// =========================
// アナログスティック
// =========================
const joy={
  zone:{x:0,y:BASE_H*0.45,w:BASE_W*0.6,h:BASE_H*0.55},
  center:{x:80,y:BASE_H-120},
  radius:60,
  vec:{x:0,y:0},
  dead:0.12,
  active:false,
  pid:null,
};

function setJoy(p){
  const dx=p.x-joy.center.x;
  const dy=p.y-joy.center.y;
  const len=Math.hypot(dx,dy);
  const r=Math.min(len,joy.radius);
  joy.vec.x = len ? (dx/len)*(r/joy.radius) : 0;
  joy.vec.y = len ? (dy/len)*(r/joy.radius) : 0;
  if(Math.hypot(joy.vec.x,joy.vec.y)<joy.dead){
    joy.vec.x=0; joy.vec.y=0;
  }
}
function resetJoy(){
  joy.active=false;
  joy.pid=null;
  joy.vec.x=joy.vec.y=0;
}

// =========================
// 入力
// =========================
function viewToWorld(x,y){
  const r=canvas.getBoundingClientRect();
  const ox=(r.width-BASE_W*scale)/2;
  const oy=(r.height-BASE_H*scale)/2;
  return {x:(x-r.left-ox)/scale,y:(y-r.top-oy)/scale};
}

canvas.addEventListener("pointerdown",e=>{
  const p=viewToWorld(e.clientX,e.clientY);
  if(p.x>=joy.zone.x&&p.y>=joy.zone.y){
    canvas.setPointerCapture(e.pointerId);
    joy.active=true;
    joy.pid=e.pointerId;
    joy.center.x=p.x;
    joy.center.y=p.y;
    setJoy(p);
  }
});
canvas.addEventListener("pointermove",e=>{
  if(joy.active&&e.pointerId===joy.pid){
    setJoy(viewToWorld(e.clientX,e.clientY));
  }
});
canvas.addEventListener("pointerup",e=>{
  if(e.pointerId===joy.pid) resetJoy();
});

// =========================
// Game state
// =========================
const player={
  x:120,y:200,w:54,h:70,
  speed:185,
  mental:3,
  aim:{x:0,y:1}, // ★常に更新される照準
};
const enemies=[], drops=[];
let spawn=0, score=0;
let scanCd=0, scanFx=0;
let beam={ax:0,ay:0,bx:0,by:0};

// =========================
// Scan（360°）
const SCAN_LEN=150, SCAN_RAD=28;

function scan(){
  if(scanCd>0) return;
  scanCd=0.35; scanFx=0.12;
  beep(880);

  const cx=player.x+player.w/2;
  const cy=player.y+player.h/2;
  beam.ax=cx; beam.ay=cy;
  beam.bx=cx+player.aim.x*SCAN_LEN;
  beam.by=cy+player.aim.y*SCAN_LEN;

  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];
    const ex=e.x+e.w/2, ey=e.y+e.h/2;
    if(distToSegSq(ex,ey,beam.ax,beam.ay,beam.bx,beam.by)<=SCAN_RAD**2){
      drops.push({x:e.x,y:e.y,w:48,h:48});
      enemies.splice(i,1);
      player.mental=Math.min(3,player.mental+1);
    }
  }
}

// =========================
// Update
// =========================
function update(dt){
  scanCd=Math.max(0,scanCd-dt);
  scanFx=Math.max(0,scanFx-dt);

  // ★照準は「移動してなくても」更新
  if(joy.vec.x||joy.vec.y){
    const l=Math.hypot(joy.vec.x,joy.vec.y);
    player.aim.x=joy.vec.x/l;
    player.aim.y=joy.vec.y/l;
  }

  // 移動
  player.x+=joy.vec.x*player.speed*dt;
  player.y+=joy.vec.y*player.speed*dt;
  player.x=clamp(player.x,0,BASE_W-player.w);
  player.y=clamp(player.y,0,BASE_H-player.h);

  // 敵湧き
  spawn-=dt;
  if(spawn<=0){
    spawn=1.8;
    enemies.push({
      x:rand(0,BASE_W),y:-60,w:56,h:66,speed:55
    });
  }

  // 敵追尾
  for(const e of enemies){
    const dx=player.x-e.x, dy=player.y-e.y;
    const l=Math.hypot(dx,dy)||1;
    e.x+=dx/l*e.speed*dt;
    e.y+=dy/l*e.speed*dt;
  }
}

// =========================
// Draw
// =========================
function draw(){
  ctx.clearRect(0,0,BASE_W,BASE_H);

  // beam
  if(scanFx>0){
    ctx.globalAlpha=0.3*(scanFx/0.12);
    ctx.strokeStyle="#7ff";
    ctx.lineWidth=SCAN_RAD*2;
    ctx.lineCap="round";
    ctx.beginPath();
    ctx.moveTo(beam.ax,beam.ay);
    ctx.lineTo(beam.bx,beam.by);
    ctx.stroke();
    ctx.globalAlpha=1;
  }

  for(const e of enemies) ctx.drawImage(IMG.ojisan,e.x,e.y,e.w,e.h);
  ctx.drawImage(IMG.player,player.x,player.y,player.w,player.h);

  // joystick
  ctx.globalAlpha=0.25;
  ctx.beginPath();
  ctx.arc(joy.center.x,joy.center.y,joy.radius,0,Math.PI*2);
  ctx.fill();
  ctx.globalAlpha=0.6;
  ctx.beginPath();
  ctx.arc(
    joy.center.x+joy.vec.x*joy.radius,
    joy.center.y+joy.vec.y*joy.radius,
    22,0,Math.PI*2
  );
  ctx.fill();
  ctx.globalAlpha=1;
}

// =========================
// Loop
// =========================
function loop(t){
  const dt=Math.min(0.033,(t-lastTime)/1000||0);
  lastTime=t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// SCANタップ
canvas.addEventListener("dblclick",scan);
canvas.addEventListener("touchstart",()=>beep(),{once:true});
