import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { AssessmentController } from './assessment.js';
import { TelemetryStore } from './telemetry.js';

/* =========================================================
   SKYLINE PROTOCOL · 3D
   Response-inhibition field task with Three.js
   ========================================================= */

const canvas = document.getElementById('gameCanvas');
const $ = id => document.getElementById(id);
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const rand  = (a,b) => Math.random()*(b-a)+a;
const randInt = (a,b) => Math.floor(rand(a,b+1));

/* ---------- Config ---------- */
const assessment = new AssessmentController();
const telemetry = new TelemetryStore(assessment.sessionId);
let activeTrial;

const SPECIES = {
  crow:    { color:0x2e333b, r:0.38, speed:[6.5,9.0],   wingRate:12, scoreHit:35,  scoreMiss:-10, noGo:false, risk:false, label:'crow'    },
  owl:     { color:0x8c6b55, r:0.46, speed:[1.8,3.2],  wingRate:7,  scoreHit:-15, scoreMiss:-10, noGo:true,  risk:false, label:'owl'     },
  eagle:   { color:0x6b4a2a, r:0.58, speed:[11.0,16.0], wingRate:8,  scoreHit:100, scoreMiss:-10, noGo:false, risk:true,  label:'eagle'   },
};

const PLAYABLE_AREA = {
  minDistance: 8,
  maxDistance: 34,
  minHeightOffset: 1,
  maxHeightOffset: 15,
  minZ: -20,
  maxZ: -8,
};
const PROJECTILE = {
  speed: 90,
  gravity: 18,
  drag: 0.02,
  maxRange: 48,
  aimAssistStrength: 0.5,
  aimAssistRadius: 8,
  fireCooldownMs: 140,
};

const state = {
  trial: 0,
  score: 0,
  choice: null,
  rewardChoice: null,
  paused: true,
  completed: false,
  level: 1,
  startedAt: 0,
  trialStart: 0,
  aimYaw: 0,
  aimPitch: 0,
  aimTarget: new THREE.Vector3(-7, 10, -31),
  moveX: 0,
  moveZ: 0,
  walkTime: 0,
  shotsLeft: 0,
  maxShots: 0,
  events: [],
  timerH: 0,

  premature: 0,
  commission: 0,
  noGo: 0,
  successfulInhibition: 0,
  riskChoices: 0,
  riskAttempts: 0,
  immediate: 0,
  delayed: 0,
  delayAccepted: 0,
  arrowsLoosed: 0,
  trialSuccess: false,
  trialDeadline: 0,
  trialTimedOut: false,
  targetSpecies: null,
  wrongTargetHits: 0,
  responseTimes: [],
  crowHits: 0, crowAttempts: 0,
  eagleHits: 0, eagleAttempts: 0,
  vrMoveX: 0,
  vrMoveZ: 0,
  immersiveMode: false,
};

/* =========================================================
   RENDERER / SCENE / CAMERA
   ========================================================= */
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc4d9d4, 70, 280);

const camera = new THREE.PerspectiveCamera(55, 16/9, 0.1, 900);
camera.position.set(-24, 9, 22);
camera.lookAt(-3, 4.2, -14);

const clock = new THREE.Clock();
const aimMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.16, 10, 8),
  new THREE.MeshBasicMaterial({ color:0xff8068, transparent:true, opacity:0.75 })
);
aimMarker.visible = false;
scene.add(aimMarker);

/* ---------- Sky ---------- */
{
  const skyGeo = new THREE.SphereGeometry(420, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms:{
      top:{value:new THREE.Color(0x2f6f8e)},
      mid:{value:new THREE.Color(0xcfe6e2)},
      bot:{value:new THREE.Color(0xf0e0c2)},
    },
    vertexShader:`varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`
      varying vec3 vPos; uniform vec3 top,mid,bot;
      void main(){
        float h = normalize(vPos).y*0.5+0.5;
        vec3 c = mix(bot, mid, smoothstep(0.0,0.5,h));
        c = mix(c, top, smoothstep(0.5,1.0,h));
        gl_FragColor = vec4(c,1.0);
      }`
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

/* ---------- Lights ---------- */
scene.add(new THREE.HemisphereLight(0xdff0ec, 0x556b55, 0.95));

const sun = new THREE.DirectionalLight(0xfff0d0, 2.1);
sun.position.set(60, 80, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left = -90;
sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90;
sun.shadow.camera.bottom = -90;
sun.shadow.camera.far = 300;
scene.add(sun);

/* =========================================================
   TERRAIN
   ========================================================= */
function makeTerrain(){
  const group = new THREE.Group();

  const groundMat = new THREE.MeshStandardMaterial({ color:0x6b8f56, roughness:1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800, 1, 1), groundMat);
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  group.add(ground);

  const mountainMat = new THREE.MeshStandardMaterial({ color:0x5c7a6e, flatShading:true, roughness:.9 });
  const snowMat     = new THREE.MeshStandardMaterial({ color:0xeaf2ee, flatShading:true, roughness:.85 });

  for (let i=0;i<28;i++){
    const h = rand(20,60);
    const r = rand(18,42);
    const coneGeo = new THREE.ConeGeometry(r, h, 5, 1);
    const pos = coneGeo.attributes.position;
    for(let v=0; v<pos.count; v++){
      pos.setX(v, pos.getX(v)+rand(-1.2,1.2));
      pos.setZ(v, pos.getZ(v)+rand(-1.2,1.2));
    }
    coneGeo.computeVertexNormals();

    const m = new THREE.Mesh(coneGeo, mountainMat);
    const angle = rand(0, Math.PI*2);
    const dist  = rand(130, 240);
    m.position.set(Math.cos(angle)*dist, h/2 - 5, Math.sin(angle)*dist);
    m.rotation.y = rand(0, Math.PI*2);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(r*0.32, h*0.28, 5, 1), snowMat);
    cap.position.copy(m.position); cap.position.y += h*0.34;
    cap.rotation.y = m.rotation.y;
    group.add(cap);
  }
  return group;
}
scene.add(makeTerrain());

/* ---------- Visible mountain ridgeline ---------- */
const ridgeGroup = new THREE.Group();
const ridgeMat = new THREE.MeshStandardMaterial({ color:0x496d67, roughness:1, flatShading:true });
const ridgeSnowMat = new THREE.MeshStandardMaterial({ color:0xdbe9e3, roughness:.9, flatShading:true });
for (let i = 0; i < 11; i++){
  const height = rand(28, 58);
  const radius = rand(16, 28);
  const mountain = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 7), ridgeMat);
  mountain.position.set(-90 + i * 18 + rand(-4, 4), height / 2 - 4, -105 + rand(-8, 8));
  mountain.rotation.y = rand(0, Math.PI);
  mountain.castShadow = true;
  mountain.receiveShadow = true;
  ridgeGroup.add(mountain);

  const snow = new THREE.Mesh(new THREE.ConeGeometry(radius * .28, height * .25, 7), ridgeSnowMat);
  snow.position.set(mountain.position.x, mountain.position.y + height * .31, mountain.position.z - .4);
  snow.rotation.y = mountain.rotation.y;
  ridgeGroup.add(snow);
}
scene.add(ridgeGroup);

/* ---------- Lake and shoreline ---------- */
const lake = new THREE.Mesh(
  new THREE.PlaneGeometry(150, 48, 1, 1),
  new THREE.MeshPhongMaterial({ color:0x4f9ca2, shininess:90, transparent:true, opacity:.86 })
);
lake.rotation.x = -Math.PI / 2;
lake.position.set(0, .035, -58);
lake.receiveShadow = true;
scene.add(lake);

const shoreline = new THREE.Mesh(
  new THREE.PlaneGeometry(155, 5),
  new THREE.MeshStandardMaterial({ color:0x9a9a62, roughness:1 })
);
shoreline.rotation.x = -Math.PI / 2;
shoreline.position.set(0, .045, -35);
scene.add(shoreline);

const reeds = new THREE.Group();
const reedMat = new THREE.MeshStandardMaterial({ color:0x607f46, roughness:1 });
for (let i = 0; i < 70; i++){
  const reed = new THREE.Mesh(new THREE.CylinderGeometry(.018, .035, rand(.5, 1.2), 5), reedMat);
  reed.position.set(rand(-72, 72), .45, rand(-42, -34));
  reed.rotation.z = rand(-.25, .25);
  reeds.add(reed);
}
scene.add(reeds);

/* =========================================================
   TREES + PERCHES
   ========================================================= */
const perchPoints = [];

function makeTree(x, z, scale=1){
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color:0x5b3f2a, roughness:1, flatShading:true });
  const leafA = new THREE.MeshStandardMaterial({ color:0x3f7a4a, roughness:1, flatShading:true });
  const leafB = new THREE.MeshStandardMaterial({ color:0x4b8f56, roughness:1, flatShading:true });

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.35*scale,.55*scale, 4*scale, 6), trunkMat);
  trunk.position.y = 2*scale;
  trunk.castShadow = true;
  g.add(trunk);

  for (let i=0;i<3;i++){
    const r = (2.1 - i*0.35)*scale;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), i%2?leafB:leafA);
    crown.position.set((i % 2 ? .25 : -.2) * scale, (4.1 + i*1.35)*scale, (i - 1) * .18 * scale);
    crown.scale.y = .9;
    crown.castShadow = true;
    g.add(crown);

    const branch = new THREE.Mesh(new THREE.CylinderGeometry(.08*scale, .14*scale, 2.4*scale, 6), trunkMat);
    branch.rotation.z = Math.PI / 2;
    branch.position.set(0, crown.position.y - 0.35 * scale, 0);
    branch.castShadow = true;
    g.add(branch);

    perchPoints.push({
      pos: new THREE.Vector3(x, crown.position.y - 0.2, z),
      occupied: false
    });
  }
  g.position.set(x, 0, z);
  return g;
}

const treePositions = [
  [-16,-48],[-7,-54],[5,-56],[14,-52],[22,-46],
  [-22,-40],[-26,-30],[-24,-20],[-18,-12],
  [24,-36],[28,-26],[26,-16],[20,-10],
  [-12,-4],[0,-2],[12,-6],[18,-12],
];
treePositions.forEach(([x,z])=> scene.add(makeTree(x, z, rand(.85,1.25))));

/* ---------- Clouds + ground vegetation ---------- */
const clouds = [];
for (let i = 0; i < 9; i++){
  const cloud = new THREE.Group();
  const cloudMat = new THREE.MeshLambertMaterial({ color:0xf4fbf6, transparent:true, opacity:.72, depthWrite:false });
  for (let puff = 0; puff < 4; puff++){
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(rand(2.5, 4.5), 12, 8), cloudMat);
    mesh.position.set(puff * 2.8 - 4, rand(-.5, .5), rand(-1, 1));
    cloud.add(mesh);
  }
  cloud.position.set(rand(-80, 80), rand(38, 62), rand(-130, -40));
  cloud.scale.setScalar(rand(.7, 1.5));
  cloud.userData.speed = rand(.6, 1.5);
  scene.add(cloud);
  clouds.push(cloud);
}

const grass = new THREE.Group();
const grassMat = new THREE.MeshStandardMaterial({ color:0x789b59, roughness:1, flatShading:true });
for (let i = 0; i < 180; i++){
  const blade = new THREE.Mesh(new THREE.ConeGeometry(.04, rand(.25, .7), 4), grassMat);
  blade.position.set(rand(-55, 55), .25, rand(-55, 35));
  blade.rotation.z = rand(-.25, .25);
  grass.add(blade);
}
scene.add(grass);

/* ---------- Ambient dust ---------- */
let dust;
{
  const N = 400;
  const geo = new THREE.BufferGeometry();
  const pts = new Float32Array(N*3);
  for (let i=0;i<N;i++){
    pts[i*3]   = rand(-140,140);
    pts[i*3+1] = rand(2, 50);
    pts[i*3+2] = rand(-140,140);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pts,3));
  const mat = new THREE.PointsMaterial({ color:0xfff4d8, size:0.28, transparent:true, opacity:.35, depthWrite:false });
  dust = new THREE.Points(geo, mat);
  scene.add(dust);
}

/* =========================================================
   HUNTER + CROSSBOW
   ========================================================= */
const hunter = new THREE.Group();
let bowPivot;
{
  const skinMat  = new THREE.MeshStandardMaterial({ color:0xcaa177, roughness:.85 });
  const clothMat = new THREE.MeshStandardMaterial({ color:0x3e5448, roughness:1, flatShading:true });
  const woodMat  = new THREE.MeshStandardMaterial({ color:0x8b4f25, roughness:.9, flatShading:true });
  const metalMat = new THREE.MeshStandardMaterial({ color:0xd8e1e3, metalness:.7, roughness:.3 });
  const leatherMat = new THREE.MeshStandardMaterial({ color:0x2b2020, roughness:1 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.55,1.0,4,8), clothMat);
  torso.position.y = 1.6; torso.castShadow = true;
  hunter.add(torso);

  const cloak = new THREE.Mesh(new THREE.ConeGeometry(.85, 1.9, 5), clothMat);
  cloak.position.set(0, 1.25, .2);
  cloak.scale.z = .7;
  cloak.castShadow = true;
  hunter.add(cloak);

  const head = new THREE.Mesh(new THREE.SphereGeometry(.42,12,10), skinMat);
  head.position.y = 2.65; head.castShadow = true;
  hunter.add(head);

  const hat = new THREE.Mesh(new THREE.CylinderGeometry(.55,.42,.3,10), woodMat);
  hat.position.y = 2.95; hat.castShadow = true;
  hunter.add(hat);

  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(.78,.78,.08,10), woodMat);
  hatBrim.position.y = 2.82;
  hatBrim.castShadow = true;
  hunter.add(hatBrim);

  [-0.28, 0.28].forEach(dx=>{
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.16,.9,4,6), clothMat);
    leg.position.set(dx, .55, 0); leg.castShadow = true;
    leg.userData.isLeg = true;
    leg.userData.side = dx < 0 ? -1 : 1;
    hunter.add(leg);
  });

  [-0.75, 0.75].forEach(dx=>{
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.14,.7,4,6), skinMat);
    arm.position.set(dx, 1.85, -0.15);
    arm.rotation.x = -Math.PI/2.4;
    arm.castShadow = true;
    hunter.add(arm);
  });

  bowPivot = new THREE.Group();
  bowPivot.position.set(.82, 2.12, -.72);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(.28,.3,2.15), woodMat);
  stock.position.z = -0.72; stock.castShadow = true;
  bowPivot.add(stock);

  const bowArc = new THREE.Mesh(new THREE.TorusGeometry(.82,.1,7,18, Math.PI), woodMat);
  bowArc.position.z = -1.55;
  bowArc.rotation.z = Math.PI/2;
  bowArc.rotation.y = Math.PI/2;
  bowArc.castShadow = true;
  bowPivot.add(bowArc);

  const strung = new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,1.35,5), metalMat);
  strung.position.z = -1.55;
  strung.rotation.x = Math.PI/2;
  bowPivot.add(strung);

  const forkMat = new THREE.MeshStandardMaterial({ color:0x54331f, roughness:.85 });
  [-.42, .42].forEach(side => {
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(.1, .13, .9, 7), forkMat);
    fork.position.set(side, .32, -1.18);
    fork.rotation.z = side < 0 ? -.28 : .28;
    fork.castShadow = true;
    bowPivot.add(fork);
  });
  const pouch = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 6), leatherMat);
  pouch.position.set(0, .1, -1.2);
  bowPivot.add(pouch);

  hunter.add(bowPivot);
  bowPivot.scale.setScalar(.72);
  hunter.position.set(-7, 0, 12);
  hunter.rotation.y = Math.PI * 0.12;
  hunter.scale.setScalar(1.5);
}
scene.add(hunter);

/* =========================================================
   BIRD FACTORY
   ========================================================= */
const birds = [];

function isPlayableBird(bird){
  const distance = hunter.position.distanceTo(bird.position);
  const heightOffset = bird.position.y - hunter.position.y;
  return distance >= PLAYABLE_AREA.minDistance
    && distance <= PLAYABLE_AREA.maxDistance
    && heightOffset >= PLAYABLE_AREA.minHeightOffset
    && heightOffset <= PLAYABLE_AREA.maxHeightOffset
    && bird.position.z >= PLAYABLE_AREA.minZ
    && bird.position.z <= PLAYABLE_AREA.maxZ;
}

function canProjectileReach(target, origin){
  return origin.distanceTo(target) <= PROJECTILE.maxRange;
}

function closestPlayableBird(origin, direction, requiredSpecies = null){
  let candidate = null;
  let bestDistance = Infinity;
  for (const bird of birds){
    if (!bird.visible || bird.userData.hit || bird.userData.mode === 'gone' || !isPlayableBird(bird)) continue;
    if (requiredSpecies && bird.userData.species !== requiredSpecies) continue;
    if (!canProjectileReach(bird.position, origin)) continue;
    const toBird = bird.position.clone().sub(origin).normalize();
    if (direction.dot(toBird) < 0.985) continue;
    const distance = origin.distanceTo(bird.position);
    if (distance < bestDistance){
      candidate = bird;
      bestDistance = distance;
    }
  }
  return candidate;
}

function makeBird(species, opts={}){
  const s = SPECIES[species];
  const g = new THREE.Group();
  const displayScale = species === 'eagle' ? 3.2 : species === 'owl' ? 2.8 : 3;
  g.scale.setScalar(displayScale);

  const bodyMat = new THREE.MeshStandardMaterial({ color:s.color, roughness:.9, flatShading:true });
  const headMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(s.color).multiplyScalar(1.15), roughness:.9, flatShading:true });
  const beakMat = new THREE.MeshStandardMaterial({ color:0xffd76b, roughness:.7 });
  const wingMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(s.color).multiplyScalar(.85), roughness:1, flatShading:true });

  const body = new THREE.Mesh(new THREE.SphereGeometry(s.r*1.15, 10, 8), bodyMat);
  body.scale.set(1, .85, 1.35);
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(s.r*.72,10,8), headMat);
  head.position.set(0, s.r*.6, s.r*1.05);
  head.castShadow = true;
  g.add(head);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(s.r*.18, s.r*.55, 6), beakMat);
  beak.position.set(0, s.r*.5, s.r*1.6);
  beak.rotation.x = Math.PI/2;
  g.add(beak);

  // eyes (tiny white dots)
  const eyeMat = new THREE.MeshBasicMaterial({ color:0x111111 });
  [-1,1].forEach(side=>{
    const eyeSize = species === 'owl' ? s.r*.16 : s.r*.11;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeSize, 6, 6), eyeMat);
    eye.position.set(side*s.r*.32, s.r*.85, s.r*1.45);
    g.add(eye);
  });

  // Layered feather wings make the wingbeats readable at field distance.
  const wingL = new THREE.Mesh(new THREE.SphereGeometry(s.r * .95, 8, 6), wingMat);
  wingL.scale.set(1.3, .16, .7);
  if (species === 'eagle') wingL.scale.x = 1.75;
  if (species === 'owl') wingL.scale.y = .28;
  wingL.position.set(-s.r*1.05, s.r*.15, 0);
  wingL.castShadow = true;
  g.add(wingL);

  const wingR = wingL.clone();
  wingR.position.x = s.r*1.1;
  g.add(wingR);

  const feathers = [];
  [-1, 1].forEach(side => {
    for (let featherIndex = 0; featherIndex < 3; featherIndex++){
      const feather = new THREE.Mesh(new THREE.ConeGeometry(s.r * .16, s.r * .9, 5), wingMat);
      feather.rotation.z = side * (Math.PI / 2.7);
      feather.position.set(side * s.r * (1.35 + featherIndex * .2), .02 - featherIndex * .04, -featherIndex * s.r * .18);
      feather.castShadow = true;
      g.add(feather);
      feathers.push(feather);
    }
  });

  g.userData = {
    species,
    cfg: s,
    wings:{ l:wingL, r:wingR, feathers },
    wingPhase: rand(0, Math.PI*2),
    // motion
    speed: rand(s.speed[0], s.speed[1]) * (opts.speedScale ?? 1),
    heading: rand(0, Math.PI*2),
    altitude: opts.y ?? rand(6, 22),
    x: opts.x ?? rand(-90, -40),
    z: opts.z ?? rand(-40, 40),
    // state machine
    mode: 'fly',        // fly | dive | perch | fall | gone
    perchedOn: null,
    perchUntil: 0,
    landingTarget: null,
    hit: false,
    missed: false,
    diveTarget: null,
    bobT: rand(0, 10),
    spawnAt: opts.spawnAt ?? performance.now(),
    noGo: s.noGo,
    risk: s.risk,
  };

  g.position.set(g.userData.x, g.userData.altitude, g.userData.z);
  scene.add(g);
  birds.push(g);
  return g;
}

function pickSpecies(){
  const r = Math.random();
  if (r < 0.20) return 'owl'; // 20% no-go
  if (r < 0.35) return 'eagle';   // 15% risk
  return 'crow';                  // 65% target
}

function buildBirdSpecies(targetSpecies, requestedCount){
  const otherSpecies = ['crow', 'owl', 'eagle'].filter(species => species !== targetSpecies);
  const species = [targetSpecies, ...otherSpecies, ...otherSpecies];
  const totalCount = Math.max(requestedCount, species.length);
  const baseCount = species.length;

  for (let i = baseCount; i < totalCount; i++){
    species.push(otherSpecies[(i - baseCount) % otherSpecies.length]);
  }

  return species;
}

/* =========================================================
   BIRD BEHAVIOR UPDATE
   ========================================================= */
function updateBird(b, dt, now){
  const u = b.userData;
  if (u.mode === 'gone') return;
  if (now < u.spawnAt){ b.visible = false; return; }
  b.visible = true;

  u.bobT += dt;

  // ---- wing animation ----
  const flap = Math.sin(u.bobT * (u.mode === 'dive' ? u.cfg.wingRate * 1.5 : u.cfg.wingRate) + u.wingPhase) * 0.8;
  u.wings.l.rotation.z =  flap;
  u.wings.r.rotation.z = -flap;
  u.wings.feathers.forEach((feather, index) => {
    feather.rotation.x = flap * (index % 3 === 0 ? .8 : .55);
  });

  if (u.mode === 'fall'){
    u.fallVel = (u.fallVel || 0) - 22 * dt;
    b.position.y += u.fallVel * dt;
    b.rotation.z += dt * 4.5;
    b.rotation.x += dt * 1.5;
    if (b.position.y < 0.4){
      b.position.y = 0.4;
      u.mode = 'gone';
      scene.remove(b);
    }
    return;
  }

  if (u.mode === 'perch'){
    const p = u.perchedOn;
    if (p){
      b.position.lerp(p.pos.clone().add(new THREE.Vector3(0, u.cfg.r*0.6, 0)), 0.08);
      b.rotation.y = Math.sin(u.bobT*0.6)*0.15 + Math.PI;
      b.rotation.x = Math.sin(u.bobT*1.2)*0.03;
      if (now >= u.perchUntil){
        p.occupied = false;
        u.perchedOn = null;
        u.mode = 'fly';
        u.heading = rand(0, Math.PI * 2);
        u.speed = rand(u.cfg.speed[0], u.cfg.speed[1]);
      }
    }
    return;
  }

  // ---- flight ----
  const targetY = u.mode === 'dive' ? 5 : u.altitude;

  // wander heading
  u.heading += Math.sin(u.bobT * 0.6) * 0.6 * dt;

  // vertical: dive mode descends, otherwise smooth to altitude
  b.position.y += (targetY - b.position.y) * dt * (u.mode === 'dive' ? 2.4 : 1.1);
  b.position.y += Math.sin(u.bobT * 2.2 + u.wingPhase) * 0.2;

  // horizontal motion
  b.position.x += Math.cos(u.heading) * u.speed * dt;
  b.position.z += Math.sin(u.heading) * u.speed * dt;

  // Keep active flight inside the measured hunting corridor instead of letting
  // a target leave the playable space before the participant can respond.
  if (b.position.x < -22 || b.position.x > 16) u.heading = Math.PI - u.heading;
  if (b.position.z < PLAYABLE_AREA.minZ || b.position.z > PLAYABLE_AREA.maxZ) u.heading = -u.heading;
  b.position.x = clamp(b.position.x, -22, 16);
  b.position.z = clamp(b.position.z, PLAYABLE_AREA.minZ, PLAYABLE_AREA.maxZ);
  b.position.y = clamp(b.position.y, hunter.position.y + PLAYABLE_AREA.minHeightOffset, hunter.position.y + PLAYABLE_AREA.maxHeightOffset);

  // face direction of travel
  b.rotation.y = -u.heading + Math.PI/2;
  b.rotation.z = -Math.cos(u.bobT*1.4) * 0.12;

  // choose a perch sometimes if not risk species
  if (!u.risk && !u.hit && Math.random() < 0.0016){
    const free = perchPoints.filter(p => !p.occupied);
    if (free.length){
      const p = free[randInt(0, free.length-1)];
      p.occupied = true;
      u.perchedOn = p;
      u.perchUntil = now + rand(1800, 5200);
      u.mode = 'perch';
    }
  }

  // eagles occasionally dive
  if (u.species === 'eagle' && u.mode === 'fly' && Math.random() < 0.0012){
    u.mode = 'dive';
    setTimeout(()=>{ if(!u.hit) u.mode = 'fly'; }, 2400);
  }

  // fly off screen → miss
  if (b.position.x > 120 || b.position.x < -140 || Math.abs(b.position.z) > 120){
      if (!u.hit && !u.missed){
      u.missed = true;
        if (!u.noGo) scoreBirdMiss(b);
    }
    u.mode = 'gone';
    scene.remove(b);
  }
}

/* =========================================================
   ARROWS
   ========================================================= */
const arrows = [];
let bowRecoil = 0;
let cameraShake = 0;
let lastShotAt = -Infinity;
const vrControllers = [renderer.xr.getController(0), renderer.xr.getController(1)];

vrControllers.forEach(controller => {
  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -18),
    ]),
    new THREE.LineBasicMaterial({ color:0xff8068, transparent:true, opacity:.65 })
  );
  controller.add(ray);
  controller.addEventListener('selectstart', () => {
    if (!state.paused && !state.completed) spawnArrow();
  });
  scene.add(controller);
});

const vrGripControllers = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
vrGripControllers.forEach(grip => scene.add(grip));

function updateVrAim(){
  const controller = vrControllers.find(item => item.visible) || vrControllers[0];
  const origin = controller.getWorldPosition(new THREE.Vector3());
  const direction = controller.getWorldDirection(new THREE.Vector3());
  const targetPlaneZ = hunter.position.z - 22;
  const distance = (targetPlaneZ - origin.z) / direction.z;
  if (!isFinite(distance) || distance <= 0) return;
  const hitPt = origin.addScaledVector(direction, distance);
  state.aimTarget.copy(hitPt);
  aimMarker.position.copy(hitPt);
  aimMarker.visible = true;
}

function spawnArrow(){
  const now = performance.now();
  if (now - lastShotAt < PROJECTILE.fireCooldownMs) return;
  if (state.shotsLeft <= 0){
    record('over-limit-fire');
    flash('NO BOLTS LEFT');
    return;
  }
  lastShotAt = now;
  state.responseTimes.push(now - activeTrial.stimulusOnset);
  state.shotsLeft -= 1;
  $('shotsLeft').textContent = state.shotsLeft + ' / ' + state.maxShots;
  state.arrowsLoosed += 1;
  $('arrowCount').textContent = state.arrowsLoosed;
  assessment.recordResponse({
    responseType: 'projectile',
    prematureResponse: performance.now() - activeTrial.stimulusOnset < activeTrial.responseWindowMs * 0.2,
    aimDuration: performance.now() - activeTrial.stimulusOnset,
    responseCategory: performance.now() - activeTrial.stimulusOnset < 1000 ? 'very-quick' : performance.now() - activeTrial.stimulusOnset < 3000 ? 'normal' : 'delayed',
    aimingDirection: { x: state.aimTarget.x, y: state.aimTarget.y, z: state.aimTarget.z },
  });

  // origin = bow tip world position
  const origin = bowPivot.localToWorld(new THREE.Vector3(0, 0, -1.7));
  const launchSpeed = PROJECTILE.speed;
  telemetry.event('projectile-launch', {
    trialId: activeTrial.trialId,
    projectileSpeed: launchSpeed,
    projectileGravity: PROJECTILE.gravity,
    origin: { x: origin.x, y: origin.y, z: origin.z },
  });

  // Fire from the bow to the exact world point under the cursor.
    // Compensate for gravity so the arrow passes through the visible aim point.
    const flightTime = origin.distanceTo(state.aimTarget) / launchSpeed;
    const ballisticTarget = state.aimTarget.clone();
    ballisticTarget.y += 0.5 * PROJECTILE.gravity * flightTime * flightTime;
    let dir = ballisticTarget.sub(origin).normalize();
    const assistTarget = closestPlayableBird(origin, dir, activeTrial.targetSpecies);
    if (assistTarget && origin.distanceTo(assistTarget.position) <= PROJECTILE.aimAssistRadius + origin.distanceTo(state.aimTarget)){
      dir.lerp(assistTarget.position.clone().sub(origin).normalize(), PROJECTILE.aimAssistStrength).normalize();
    }

  // Arrow mesh
  const g = new THREE.Group();
  const shaftMat = new THREE.MeshStandardMaterial({ color:0x6b4423 });
  const tipMat   = new THREE.MeshStandardMaterial({ color:0xb8bec2, metalness:.8, roughness:.3 });
  const fletch   = new THREE.MeshStandardMaterial({ color:0xd93b3b, side:THREE.DoubleSide });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,2.15,8), shaftMat);
  shaft.rotation.x = Math.PI/2;
  g.add(shaft);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(.11,.42,8), tipMat);
  tip.position.z = -1.28;
  tip.rotation.x = -Math.PI/2;
  g.add(tip);

  const f1 = new THREE.Mesh(new THREE.PlaneGeometry(.24,.16), fletch);
  f1.position.z = .95;
  g.add(f1);
  const f2 = f1.clone(); f2.rotation.z = Math.PI/2; g.add(f2);
  const f3 = f1.clone(); f3.rotation.y = Math.PI/2; g.add(f3);

  g.position.copy(origin);
  g.lookAt(origin.clone().add(dir));
  scene.add(g);

  arrows.push({
    mesh: g,
    vel: dir.clone().multiplyScalar(launchSpeed),
    origin: origin.clone(),
    previousPosition: origin.clone(),
    life: 4.5,
    trail: []
  });

  bowRecoil = 0.12;
  cameraShake = 0.08;

  // Premature check: no visible birds
  const anyVisible = birds.some(b => b.visible && b.userData.mode !== 'gone');
  if (!anyVisible){
    state.premature += 1;
    state.score -= 5;
    record('premature-response');
    flash('PREMATURE · −5');
  }
}

function updateArrows(dt){
  for (let i = arrows.length-1; i >= 0; i--){
    const a = arrows[i];
    a.life -= dt;
    const previousPosition = a.mesh.position.clone();

    // gravity + slight drag
    a.vel.y -= PROJECTILE.gravity * dt;
    a.vel.multiplyScalar(1 - PROJECTILE.drag * dt);
    a.mesh.position.addScaledVector(a.vel, dt);
    a.mesh.lookAt(a.mesh.position.clone().add(a.vel));

    // collision vs birds
    let hitSomething = false;
    for (const b of birds){
      if (!b.visible) continue;
      const u = b.userData;
      if (u.mode === 'gone' || u.hit || !isPlayableBird(b)) continue;
      const visualScale = u.species === 'eagle' ? 3.2 : u.species === 'owl' ? 2.8 : 3;
      const r = u.cfg.r * visualScale * 1.9;
      const flightSegment = new THREE.Line3(previousPosition, a.mesh.position);
      const closestPoint = flightSegment.closestPointToPoint(b.position, true, new THREE.Vector3());
      if (closestPoint.distanceTo(b.position) < r){
        onArrowHit(a, b);
        hitSomething = true;
        break;
      }
    }
    if (hitSomething){ arrows.splice(i,1); scene.remove(a.mesh); continue; }

    // ground hit
    if (a.mesh.position.y <= 0.05){
      registerArrowMiss();
      spawnDust(a.mesh.position.clone());
      scene.remove(a.mesh);
      arrows.splice(i,1);
      continue;
    }
    // timeout / out of bounds
    if (a.life <= 0 || a.mesh.position.distanceTo(a.origin) > PROJECTILE.maxRange || Math.abs(a.mesh.position.x) > 200 || Math.abs(a.mesh.position.z) > 200){
      registerArrowMiss();
      scene.remove(a.mesh);
      arrows.splice(i,1);
    }
  }
}

function onArrowHit(a, b){
  const u = b.userData;
  const rt = performance.now() - state.startedAt;
  u.hit = true;
  const isRequiredTarget = u.species === activeTrial.targetSpecies;
  if (isRequiredTarget) state.trialSuccess = true;

  if (!isRequiredTarget){
    state.wrongTargetHits += 1;
    state.commission += 1;
    state.score -= 25;
    record('wrong-target', b, {
      requiredSpecies: activeTrial.targetSpecies,
      responseTime: Math.round(rt),
      commissionError: true,
      failedInhibition: true,
      accuracy: false,
    });
    telemetry.event('wrong-target-response', {
      trialId: activeTrial.trialId,
      requiredSpecies: activeTrial.targetSpecies,
      actualSpecies: u.species,
      responseTime: Math.round(rt),
      hit: true,
      accuracy: false,
    });
    flash(`WRONG TARGET · ${u.species.toUpperCase()} · -25`);
    spawnFeathers(b.position.clone(), 0x9b806d);
    u.mode = 'fall'; u.fallVel = 1.5;
    updateScore();
    updateMetrics();
    return;
  }

  if (u.noGo){
    state.score += 20;
    record('required-target-hit', b, {
      requiredSpecies: activeTrial.targetSpecies,
      responseTime: Math.round(rt),
      accuracy: true,
    });
    flash(`${u.species.toUpperCase()} · +20`);
    spawnFeathers(b.position.clone(), 0xc9a87c);
    u.mode = 'fall'; u.fallVel = 1.5;
    updateScore();
    updateMetrics();
    return;
  }

  if (u.noGo){
    // commission error
    state.commission += 1;
    state.score -= 15;
    record('commission-error', b, { rt: Math.round(rt) });
    flash('OWL HIT · −15');
    spawnFeathers(b.position.clone(), 0xc9a87c);
    u.mode = 'fall'; u.fallVel = 1.5;
  } else if (u.risk){
    state.score += 100;
    state.eagleHits += 1; state.eagleAttempts += 1;
    state.riskAttempts += 1;
    record('hit', b, { rt: Math.round(rt), riskLevel:3 });
    flash('EAGLE · +100');
    spawnFeathers(b.position.clone(), 0x6b4a2a);
    cameraShake = 0.18;
    u.mode = 'fall'; u.fallVel = 2;
  } else {
    state.score += 35;
    state.crowHits += 1; state.crowAttempts += 1;
    record('hit', b, { rt: Math.round(rt), riskLevel:1 });
    flash('CROW · +35');
    spawnFeathers(b.position.clone(), 0x2e333b);
    u.mode = 'fall'; u.fallVel = 1.2;
  }
  telemetry.event('projectile-hit', {
    trialId: activeTrial.trialId,
    birdType: u.species,
    birdSpeed: u.speed,
    projectileLaunchTime: state.startedAt,
    hitTime: performance.now(),
    responseTime: rt,
    hit: true,
    accuracy: true,
  });
  updateScore();
  updateMetrics();
}

/* =========================================================
   SCORING HELPERS
   ========================================================= */
function scoreBirdMiss(b){
  const u = b.userData;
  state.score -= 10;
  if (u.risk) state.riskAttempts += 1;
  record('miss', b, { riskLevel:u.risk ? 3 : 1 });
  flash(u.risk ? 'EAGLE ESCAPED · −10' : 'BIRD ESCAPED · −10');
  updateScore();
  updateMetrics();
}

function registerArrowMiss(){
  state.score -= 10;
  record('missed-shot');
  flash('MISSED · −10');
  updateScore();
  updateMetrics();
}

function spawnDust(position){
  const burst = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 6, 4),
    new THREE.MeshBasicMaterial({ color:0xd8c39a, transparent:true, opacity:0.65 })
  );
  burst.position.copy(position);
  scene.add(burst);
  setTimeout(() => scene.remove(burst), 280);
}

function spawnFeathers(position, color){
  for (let i = 0; i < 8; i++){
    const feather = new THREE.Mesh(
      new THREE.TetrahedronGeometry(.08, 0),
      new THREE.MeshBasicMaterial({ color, transparent:true, opacity:.9 })
    );
    feather.position.copy(position);
    feather.userData.velocity = new THREE.Vector3(rand(-2, 2), rand(1, 4), rand(-2, 2));
    scene.add(feather);
    const startedAt = performance.now();
    const animateFeather = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      feather.position.addScaledVector(feather.userData.velocity, .016);
      feather.userData.velocity.y -= 5 * .016;
      feather.rotation.x += .12;
      feather.rotation.z += .08;
      feather.material.opacity = Math.max(0, 1 - elapsed / .8);
      if (elapsed < .8) requestAnimationFrame(animateFeather);
      else scene.remove(feather);
    };
    requestAnimationFrame(animateFeather);
  }
}

function record(type, bird=null, extra={}){
  const record = {
    sessionId: assessment.sessionId,
    trial: state.trial + 1,
    trialId: activeTrial?.trialId,
    type,
    species: bird ? bird.userData.species : null,
    birdSpeed: bird ? bird.userData.speed : null,
    birdState: bird ? bird.userData.mode : null,
    birdPosition: bird ? { x: bird.position.x, y: bird.position.y, z: bird.position.z } : null,
    risk: bird ? !!bird.userData.risk : false,
    time: Math.round(performance.now() - state.startedAt),
    ...extra
  };
  state.events.push(record);
  telemetry.event(type, record);
}

function flash(text){
  const el = $('flash');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flash._t);
  flash._t = setTimeout(()=> el.classList.remove('show'), 700);
}

function updateScore(){
  $('score').textContent = String(Math.max(0, state.score)).padStart(3,'0');
}

/* =========================================================
   TRIAL FLOW
   ========================================================= */
function setupTrial(){
  activeTrial = assessment.trial || (assessment.trialIndex === 0
    ? assessment.startLevel(state.level - 1)
    : assessment.startTrial());
  state.level = activeTrial.level;
  state.trial = assessment.trialIndex;

  // clear birds + arrows
  birds.slice().forEach(b => scene.remove(b));
  birds.length = 0;
  arrows.slice().forEach(a => scene.remove(a.mesh));
  arrows.length = 0;
  perchPoints.forEach(p => p.occupied = false);

  state.choice = state.rewardChoice;
  state.trialSuccess = false;
  state.trialTimedOut = false;
  state.responseTimes = [];
  state.targetSpecies = activeTrial.targetSpecies;
  state.trialDeadline = 0;
  state.paused = true;
  state.trialStart = performance.now();

  const isRisk = activeTrial.condition === 'risk';
  const birdSpecies = buildBirdSpecies(activeTrial.targetSpecies, activeTrial.birdCount);
  const progressionBonus = assessment.trialIndex;
  state.maxShots = isRisk
    ? Math.max(5 + progressionBonus, Math.ceil(birdSpecies.length * 0.75))
    : Math.max(6 + progressionBonus, Math.ceil(birdSpecies.length * 0.9));
  state.shotsLeft = state.maxShots;

  // spawn flock
  for (let i=0;i<birdSpecies.length;i++){
    const sp = birdSpecies[i];
    makeBird(sp, {
      x: rand(-18, 14),
      z: rand(-20, -10),
      y: rand(5, 16),
      spawnAt: performance.now() + i * 520
      ,speedScale: assessment.level.speedScale
    });
  }

  $('trialNumber').textContent = String(state.trial+1).padStart(2,'0');
  $('trialTotal').textContent = assessment.level.trials;
  $('levelNumber').textContent = String(state.level).padStart(2,'0');
  $('levelName').textContent = assessment.level.name;
  $('birdCount').textContent = birds.length;
  $('shotsLeft').textContent = state.shotsLeft + ' / ' + state.maxShots;
  $('roundType').textContent = `${activeTrial.condition.toUpperCase()} · TARGET ${activeTrial.targetSpecies.toUpperCase()} · ${Math.round(activeTrial.timeLimitMs / 1000)}s`;
  $('targetSpecies').textContent = activeTrial.targetSpecies.toUpperCase();
  $('roundTimer').textContent = `${Math.ceil(activeTrial.timeLimitMs / 1000)}s`;
  $('levelPrompt').textContent = `LEVEL ${String(state.level).padStart(2,'0')} · ${assessment.level.name}`;
  $('choiceHeading').textContent = state.rewardChoice ? `TRIAL ${String(state.trial + 1).padStart(2,'0')} READY` : 'Choose your reward timing';
  $('choiceDescription').textContent = state.rewardChoice
    ? 'Your reward timing is already selected for this level.'
    : assessment.level.description;
  $('immediateReward').textContent = `+${assessment.level.reward.immediate} baseline · 120s level 1 style pace`;
  $('delayedReward').textContent = `+${assessment.level.reward.delayed} after delay · level time limit applies`;
  $('sessionStatus').textContent = state.rewardChoice ? `TRIAL ${String(state.trial + 1).padStart(2,'0')} READY` : 'AWAITING CHOICE';
  if (state.rewardChoice){
    $('choicePanel').classList.add('hidden');
    flash(`TRIAL ${String(state.trial + 1).padStart(2,'0')} READY`);
    setTimeout(() => beginChoice(state.rewardChoice), 650);
  } else {
    $('choicePanel').classList.remove('hidden');
  }
  $('completePanel').classList.add('hidden');
  $('restartPanel').classList.add('hidden');
  updateScore();
  updateMetrics();
}

function beginChoice(choice){
  const firstLevelChoice = state.rewardChoice === null;
  state.rewardChoice = choice;
  state.choice = choice;
  if (firstLevelChoice){
    telemetry.event('reward-choice', {
      trialId: activeTrial.trialId,
      choice,
      decisionTime: performance.now() - activeTrial.stimulusOnset,
      rewardValue: choice === 'immediate' ? assessment.level.reward.immediate : assessment.level.reward.delayed,
      selectionScope: 'level',
    });
    if (choice === 'immediate') state.immediate += 1;
    else state.delayed += 1;
  }

  if (activeTrial.condition === 'risk'){
    state.riskChoices += choice === 'immediate' ? 1 : 0;
  }

  // reset spawn timers to now
  const now = performance.now();
  birds.forEach((b, i)=> b.userData.spawnAt = now + i * 520);

  $('choicePanel').classList.add('hidden');

  if (choice === 'delayed'){
    state.delayAccepted += 1;
    state.paused = true;
    $('sessionStatus').textContent = 'DELAY ACCEPTED';
    setTimeout(()=>{
      state.score += assessment.level.reward.delayed;
      state.trialDeadline = performance.now() + activeTrial.timeLimitMs;
      state.paused = false;
      state.startedAt = performance.now();
      $('sessionStatus').textContent = state.immersiveMode ? 'IMMERSIVE FIELD' : 'IN FIELD';
      updateScore();
    }, 2000);
  } else {
    state.score += assessment.level.reward.immediate;
    state.paused = false;
    state.startedAt = performance.now();
    state.trialDeadline = performance.now() + activeTrial.timeLimitMs;
    $('sessionStatus').textContent = state.immersiveMode ? 'IMMERSIVE FIELD' : 'IN FIELD';
    updateScore();
  }
  updateMetrics();
}

function checkTrialEnd(now){
  if (state.paused || state.completed) return;

  const remainingMs = Math.max(0, state.trialDeadline - now);
  $('roundTimer').textContent = `${(remainingMs / 1000).toFixed(1)}s`;
  if (!state.trialSuccess && state.trialDeadline && remainingMs <= 0){
    state.trialTimedOut = true;
    state.paused = true;
    record('omission-timeout', null, {
      requiredSpecies: activeTrial.targetSpecies,
      timeLimitMs: activeTrial.timeLimitMs,
      omissionError: true,
      responseInhibition: true,
    });
    telemetry.trial(assessment.finishTrial({
      outcome: 'timeout',
      omissionError: true,
      requiredSpecies: activeTrial.targetSpecies,
      timeLimitMs: activeTrial.timeLimitMs,
    }));
    $('sessionStatus').textContent = 'TIME EXPIRED';
    $('choicePanel').classList.add('hidden');
    $('completePanel').classList.add('hidden');
    $('restartPanel').classList.remove('hidden');
    return;
  }

  const arrowsInFlight = arrows.length > 0;

  if (state.trialSuccess && !arrowsInFlight){
    birds.forEach(b => {
      if (!b.userData.hit){
        b.userData.mode = 'gone';
        scene.remove(b);
      }
    });
    state.paused = true;

    const trialRecord = assessment.finishTrial({
      outcome: 'complete',
      successfulInhibition: activeTrial.condition === 'inhibit' && !state.events.some(event => event.trialId === activeTrial.trialId && event.type === 'projectile-launch'),
      condition: activeTrial.condition,
      responseConsistencyMs: state.responseTimes.length > 1
        ? Math.round(Math.sqrt(state.responseTimes.reduce((sum, value) => sum + (value - state.responseTimes.reduce((a, b) => a + b, 0) / state.responseTimes.length) ** 2, 0) / state.responseTimes.length))
        : null,
    });
    telemetry.trial(trialRecord);

    // tally no-go survivals
    birds.forEach(b => {
      if (b.userData.noGo && !b.userData.hit) state.successfulInhibition += 1;
    });
    state.noGo += birds.filter(b => b.userData.noGo).length;

    setTimeout(()=>{
      if (assessment.isLevelComplete()) {
        if (state.level < 5){
          assessment.nextLevel();
          state.level += 1;
          state.rewardChoice = null;
          setupTrial();
        } else finish();
      } else setupTrial();
    }, 900);
    return;
  }

  if (!state.trialSuccess && state.shotsLeft <= 0 && !arrowsInFlight){
    state.paused = true;
    $('sessionStatus').textContent = 'NO SUCCESSFUL HUNT';
    $('choicePanel').classList.add('hidden');
    $('completePanel').classList.add('hidden');
    $('restartPanel').classList.remove('hidden');
  }
}

function finish(){
  state.completed = true;
  state.paused = true;
  $('sessionStatus').textContent = 'COMPLETE';
  $('nextLevelButton').textContent = state.level < 5 ? `Continue to level ${state.level + 1}` : 'Assessment complete';
  $('nextLevelButton').disabled = state.level >= 5;
  $('completePanel').classList.remove('hidden');
  updateMetrics();
}

/* =========================================================
   METRICS
   ========================================================= */
function pct(n,d){ return d ? Math.round(n/Math.max(1,d)*100)+'%' : '--'; }

function updateMetrics(){
  const hits = state.events.filter(e => e.type === 'hit').length;
  const responses = state.events.filter(e => ['hit','miss','commission-error'].includes(e.type)).length;
  const rts = state.events.filter(e => e.rt !== undefined).map(e => e.rt);
  const mean = rts.length ? rts.reduce((a,b)=>a+b,0)/rts.length : 0;
  const sorted = [...rts].sort((a,b)=>a-b);
  const median = sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
  const variance = rts.length ? rts.reduce((a,b)=>a+(b-mean)**2,0)/rts.length : 0;

  const inhibitionOpportunities = state.noGo + state.wrongTargetHits;
  $('commissionRate').textContent     = pct(state.commission, inhibitionOpportunities);
  $('failedInhibition').textContent   = pct(state.commission, inhibitionOpportunities);
  $('successfulInhibition').textContent = pct(state.successfulInhibition, inhibitionOpportunities);
  $('prematureRate').textContent      = pct(state.premature, state.events.length);
  $('prematureFrequency').textContent = state.premature ? state.premature.toFixed(1) : '0.0';
  $('riskyRate').textContent          = pct(state.riskChoices, Math.max(1, state.trial+1));
  $('riskLevel').textContent          = state.riskAttempts ? (state.riskAttempts/Math.max(1,state.trial+1)).toFixed(1)+'/3' : '--';
  $('delayChoices').textContent       = state.immediate + ' / ' + state.delayed;
  $('meanRt').textContent             = mean ? Math.round(mean)+'ms' : '--';
  $('medianRt').textContent           = median ? Math.round(median)+'ms' : '--';
  $('rtVariability').textContent      = rts.length ? Math.round(Math.sqrt(variance))+'ms' : '--';
  $('responseConsistency').textContent = rts.length > 1 ? Math.round(Math.sqrt(variance))+'ms' : '--';
  $('speedAccuracy').textContent      = rts.length ? Math.round(hits/Math.max(1,responses)*100)+'%' : '--';

  $('crowAcc').textContent  = pct(state.crowHits,  state.crowAttempts);
  $('eagleAcc').textContent = pct(state.eagleHits, state.eagleAttempts);
}

/* =========================================================
   INPUT
   ========================================================= */
let mouseNDC = new THREE.Vector2(0, 0);
const pressedKeys = new Set();

window.addEventListener('keydown', e => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space'].includes(e.code)) {
    e.preventDefault();
    pressedKeys.add(e.code);
    if (e.code === 'Space' && !e.repeat && !state.paused && !state.completed) spawnArrow();
  }
});

window.addEventListener('keyup', e => pressedKeys.delete(e.code));

function updateHunter(dt){
  const keyboardMoveX = Number(pressedKeys.has('ArrowRight') || pressedKeys.has('KeyD')) - Number(pressedKeys.has('ArrowLeft') || pressedKeys.has('KeyA'));
  const keyboardMoveZ = Number(pressedKeys.has('ArrowDown') || pressedKeys.has('KeyS')) - Number(pressedKeys.has('ArrowUp') || pressedKeys.has('KeyW'));
  if (renderer.xr.isPresenting){
    const source = renderer.xr.getSession()?.inputSources.find(item => item.gamepad);
    const axes = source?.gamepad?.axes || [];
    state.vrMoveX = Math.abs(axes[2] || 0) > .15 ? axes[2] : 0;
    state.vrMoveZ = Math.abs(axes[3] || 0) > .15 ? axes[3] : 0;
  }
  state.moveX = renderer.xr.isPresenting ? state.vrMoveX : keyboardMoveX;
  state.moveZ = renderer.xr.isPresenting ? state.vrMoveZ : keyboardMoveZ;
  const moving = state.moveX !== 0 || state.moveZ !== 0;

  if (moving){
    const length = Math.hypot(state.moveX, state.moveZ);
    const speed = 7 * dt;
    hunter.position.x = clamp(hunter.position.x + state.moveX / length * speed, -18, 8);
    hunter.position.z = clamp(hunter.position.z + state.moveZ / length * speed, 5, 18);
    state.walkTime += dt * 12;
  }

  if (renderer.xr.isPresenting) updateVrAim();
  const targetLocal = hunter.worldToLocal(state.aimTarget.clone());
  hunter.rotation.y = Math.PI * 0.12;

  const localHorizontal = Math.hypot(targetLocal.x, targetLocal.z);
  const bowYaw = clamp(Math.atan2(targetLocal.x, -targetLocal.z), -.9, .9);
  const bowPitch = clamp(Math.atan2(targetLocal.y, localHorizontal), -.45, .55);
  bowPivot.rotation.set(bowPitch, bowYaw, 0);
  bowRecoil = Math.max(0, bowRecoil - dt * 1.8);
  bowPivot.position.z = -0.35 + bowRecoil;

  const stride = moving ? Math.sin(state.walkTime) * 0.12 : 0;
  hunter.children.forEach(child => {
    if (child.userData.isLeg) child.rotation.z = stride * child.userData.side;
  });
}

function setDesktopImmersiveMode(enabled){
  state.immersiveMode = enabled;
  document.body.classList.toggle('immersive-mode', enabled);
  $('desktopVrButton').textContent = enabled ? 'EXIT IMMERSIVE' : 'PLAY IMMERSIVE MODE';
  $('immersiveGuide').classList.toggle('hidden', !enabled);
  if (enabled){
    $('sessionStatus').textContent = state.paused ? 'IMMERSIVE READY' : 'IMMERSIVE FIELD';
    flash('IMMERSIVE MODE READY');
  } else if (!state.completed){
    $('sessionStatus').textContent = state.paused ? 'READY' : 'IN FIELD';
  }
}

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - r.left) / r.width)  * 2 - 1;
  mouseNDC.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  $('crosshair').style.left = `${e.clientX - r.left}px`;
  $('crosshair').style.top = `${e.clientY - r.top}px`;

  // Project the cursor onto the birds' flight corridor, not an arbitrary far point.
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouseNDC, camera);
  const targetPlaneZ = hunter.position.z - 22;
  const distance = (targetPlaneZ - ray.ray.origin.z) / ray.ray.direction.z;
  if (isFinite(distance) && distance > 0){
    const hitPt = ray.ray.origin.clone().add(ray.ray.direction.clone().multiplyScalar(distance));
    state.aimTarget.copy(hitPt);
    aimMarker.position.copy(hitPt);
    aimMarker.visible = true;
    const aimVec = hitPt.clone().sub(hunter.position).normalize();
    state.aimYaw = Math.atan2(aimVec.x, -aimVec.z);
    state.aimPitch = Math.asin(clamp(aimVec.y, -1, 1));
  }
});

canvas.addEventListener('click', e => {
  if (state.paused || state.completed) return;
  spawnArrow();
}); 

document.querySelectorAll('.choice-button').forEach(button => {
  button.addEventListener('click', () => beginChoice(button.dataset.choice));
});

function resizeRenderer(){
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function exportSession(){
  const blob = new Blob([JSON.stringify(telemetry.exportPayload({
    summary: {
      score: state.score,
      trials: state.trial,
      premature: state.premature,
      commission: state.commission,
      successfulInhibition: state.successfulInhibition,
      immediate: state.immediate,
      delayed: state.delayed,
      arrowsLoosed: state.arrowsLoosed,
    },
  }), null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'skyline-protocol-session.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

function animate(){
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  updateHunter(dt);
  birds.forEach(bird => updateBird(bird, dt, now));
  updateArrows(dt);
  if (!state.paused && !state.completed) checkTrialEnd(now);
  dust.rotation.y += dt * 0.01;
  clouds.forEach(cloud => {
    cloud.position.x += cloud.userData.speed * dt;
    if (cloud.position.x > 110) cloud.position.x = -110;
  });
  grass.rotation.z = Math.sin(now * 0.0008) * 0.012;

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

const vrButton = VRButton.createButton(renderer);
vrButton.id = 'vrButton';
vrButton.classList.add('hidden');
document.querySelector('.topbar-actions').appendChild(vrButton);
$('desktopVrButton').addEventListener('click', () => setDesktopImmersiveMode(!state.immersiveMode));

if (navigator.xr?.isSessionSupported){
  navigator.xr.isSessionSupported('immersive-vr').then(supported => {
    if (supported) vrButton.classList.remove('hidden');
  }).catch(() => {});
}

renderer.xr.addEventListener('sessionstart', () => {
  setDesktopImmersiveMode(false);
  state.vrMoveX = 0;
  state.vrMoveZ = 0;
  $('crosshair').classList.add('vr-hidden');
  $('sessionStatus').textContent = 'VR READY';
});
renderer.xr.addEventListener('sessionend', () => {
  state.vrMoveX = 0;
  state.vrMoveZ = 0;
  $('crosshair').classList.remove('vr-hidden');
  if (!state.completed) $('sessionStatus').textContent = state.paused ? 'READY' : 'IN FIELD';
});

renderer.xr.addEventListener('inputsourceschange', () => {
  const source = renderer.xr.getSession()?.inputSources[0];
  const axes = source?.gamepad?.axes || [];
  state.vrMoveX = Math.abs(axes[2] || 0) > .15 ? axes[2] : 0;
  state.vrMoveZ = Math.abs(axes[3] || 0) > .15 ? axes[3] : 0;
});

window.addEventListener('resize', resizeRenderer);
$('resetButton').addEventListener('click', () => window.location.reload());
$('exportButton').addEventListener('click', exportSession);
$('exportButtonBottom').addEventListener('click', exportSession);
$('restartButton').addEventListener('click', () => {
  assessment.startLevel(state.level - 1);
  state.score = 0;
  state.completed = false;
  state.rewardChoice = null;
  setupTrial();
});
$('nextLevelButton').addEventListener('click', () => {
  if (state.level >= 5) return;
  state.completed = false;
  state.score = 0;
  state.rewardChoice = null;
  assessment.nextLevel();
  setupTrial();
});

resizeRenderer();
setupTrial();
animate();
$('loading').classList.add('hidden');