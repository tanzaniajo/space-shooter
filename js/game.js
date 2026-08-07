(() => {
  'use strict';

  // ---------- Setup ----------
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  const hudScore = document.getElementById('hud-score');
  const hudLevel = document.getElementById('hud-level');
  const hudLives = document.getElementById('hud-lives');
  const hudGadget = document.getElementById('hud-gadget');

  const startScreen = document.getElementById('start-screen');
  const pauseScreen = document.getElementById('pause-screen');
  const gameOverScreen = document.getElementById('game-over-screen');
  const diffButtons = document.querySelectorAll('.diff-btn');
  const resumeButton = document.getElementById('resume-button');
  const restartButton = document.getElementById('restart-button');
  const finalScoreEl = document.getElementById('final-score');
  const newHighScoreEl = document.getElementById('new-high-score');
  const highScoreDisplay = document.getElementById('high-score-display');

  const HIGH_SCORE_KEY = 'starRunnerHighScore';

  let width = 0;
  let height = 0;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Audio (WebAudio beeps, no assets needed) ----------
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = AudioCtx ? new AudioCtx() : null;

  function beep({ freq = 440, duration = 0.08, type = 'square', volume = 0.08, slideTo = null }) {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (slideTo !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), audioCtx.currentTime + duration);
    }
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  }

  const sfx = {
    shoot: () => beep({ freq: 880, duration: 0.06, type: 'square', volume: 0.05, slideTo: 1200 }),
    enemyShoot: () => beep({ freq: 220, duration: 0.08, type: 'sawtooth', volume: 0.04, slideTo: 140 }),
    explosion: () => beep({ freq: 160, duration: 0.25, type: 'sawtooth', volume: 0.09, slideTo: 40 }),
    hit: () => beep({ freq: 120, duration: 0.15, type: 'square', volume: 0.1, slideTo: 30 }),
    powerup: () => beep({ freq: 520, duration: 0.18, type: 'triangle', volume: 0.08, slideTo: 1040 }),
    wave: () => beep({ freq: 300, duration: 0.3, type: 'triangle', volume: 0.07, slideTo: 600 }),
  };

  // ---------- Input ----------
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'KeyP') togglePause();
    if (e.code === 'KeyE' && state === 'playing') player.useGadget();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  function isDown(...codes) {
    return codes.some((c) => keys.has(c));
  }

  let mouseDown = false;
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouseDown = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseDown = false;
  });
  window.addEventListener('mouseleave', () => { mouseDown = false; });
  window.addEventListener('blur', () => { mouseDown = false; keys.clear(); });

  // ---------- Utility ----------
  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
  function circleHit(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const r = a.r + b.r;
    return dx * dx + dy * dy < r * r;
  }

  // ---------- Starfield background ----------
  let stars = [];
  function initStars() {
    stars = [];
    const count = Math.floor((width * height) / 6000);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: rand(0, width),
        y: rand(0, height),
        z: rand(0.3, 1.6),
        r: rand(0.5, 1.8),
      });
    }
  }

  function updateStars(dt) {
    for (const s of stars) {
      s.y += s.z * 70 * dt;
      if (s.y > height) {
        s.y = -2;
        s.x = rand(0, width);
      }
    }
  }

  function drawStars() {
    for (const s of stars) {
      ctx.globalAlpha = clamp(s.z / 1.6, 0.25, 1);
      ctx.fillStyle = '#cfe8ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Difficulty ----------
  // enemiesAttack: grunt enemies fire bullets. bossAttack: boss fires bullets (always true).
  // enemyMult scales grunt/boss hp, speed and bullet speed upward for Hard/Impossible.
  const DIFFICULTIES = {
    peaceful: { label: 'PEACEFUL', gadgetCooldown: 0, bossGadgetCooldown: 15, enemiesAttack: false, bossAttack: true, gadgetEnabled: true, bossTeleport: false, enemyMult: 1 },
    easy: { label: 'EASY', gadgetCooldown: 30, enemiesAttack: false, bossAttack: true, gadgetEnabled: true, bossTeleport: false, enemyMult: 1 },
    normal: { label: 'NORMAL', gadgetCooldown: 50, enemiesAttack: true, bossAttack: true, gadgetEnabled: true, bossTeleport: false, enemyMult: 1 },
    hard: { label: 'HARD', gadgetCooldown: 90, enemiesAttack: true, bossAttack: true, gadgetEnabled: true, bossTeleport: false, enemyMult: 1.3 },
    impossible: { label: 'IMPOSSIBLE', gadgetCooldown: 50, enemiesAttack: true, bossAttack: true, gadgetEnabled: false, bossTeleport: true, enemyMult: 1.6 },
  };
  let difficulty = DIFFICULTIES.normal;

  // ---------- Game State ----------
  let state = 'start'; // start | playing | paused | gameover
  let score = 0;
  let lives = 3;
  let wave = 1;
  let waveTimer = 0;
  let waveMessageTimer = 0;
  let waveMessage = '';
  let spawnQueue = [];
  let spawnTimer = 0;

  let player, bullets, enemyBullets, enemies, particles, powerups, boss, henchmen;

  // The further into the run (higher wave number), the faster everything moves and fires.
  function waveSpeedMult() {
    return clamp(1 + (wave - 1) * 0.018, 1, 2.2);
  }

  function getHighScore() {
    return Number(localStorage.getItem(HIGH_SCORE_KEY) || 0);
  }
  function setHighScore(v) {
    localStorage.setItem(HIGH_SCORE_KEY, String(v));
  }

  highScoreDisplay.textContent = `High Score: ${getHighScore()}`;

  // ---------- Entities ----------
  class Player {
    constructor(diff) {
      this.x = width / 2;
      this.y = height - 100;
      this.r = 14;
      this.speed = 430;
      this.cooldown = 0;
      this.fireRate = 0.15;
      this.shield = 0;
      this.spread = 0; // spread shot power level
      this.rapid = 0; // rapid fire timer
      this.invuln = 1.2; // brief spawn invulnerability
      this.blinkT = 0;
      this.gadgetCooldown = 0; // ready at start
      this.gadgetMax = diff.gadgetCooldown;
      this.gadgetEnabled = diff.gadgetEnabled;
      this.gadgetActive = 0;
      this.gadgetDuration = 2.5;
      this.gadgetFireTimer = 0;
    }

    update(dt) {
      let dx = 0;
      let dy = 0;
      if (isDown('ArrowLeft', 'KeyA')) dx -= 1;
      if (isDown('ArrowRight', 'KeyD')) dx += 1;
      if (isDown('ArrowUp', 'KeyW')) dy -= 1;
      if (isDown('ArrowDown', 'KeyS')) dy += 1;
      if (dx !== 0 && dy !== 0) {
        const inv = Math.SQRT1_2;
        dx *= inv;
        dy *= inv;
      }
      this.x = clamp(this.x + dx * this.speed * dt, this.r + 4, width - this.r - 4);
      this.y = clamp(this.y + dy * this.speed * dt, this.r + 4, height - this.r - 4);

      this.cooldown -= dt;
      const rate = this.rapid > 0 ? this.fireRate * 0.4 : this.fireRate;
      if ((isDown('Space') || mouseDown) && this.cooldown <= 0) {
        this.shoot();
        this.cooldown = rate;
      }

      if (this.rapid > 0) this.rapid -= dt;
      if (this.invuln > 0) this.invuln -= dt;
      this.blinkT += dt;

      if (this.gadgetCooldown > 0) this.gadgetCooldown -= dt;
      if (this.gadgetActive > 0) {
        this.gadgetActive -= dt;
        this.gadgetFireTimer -= dt;
        if (this.gadgetFireTimer <= 0) {
          this.gadgetFireTimer = 0.035;
          this.gadgetBurst();
        }
      }
    }

    useGadget() {
      if (!this.gadgetEnabled) return;
      if (this.gadgetCooldown > 0 || this.gadgetActive > 0) return;
      this.gadgetActive = this.gadgetDuration;
      const inBossFight = boss && difficulty.bossGadgetCooldown !== undefined;
      this.gadgetCooldown = inBossFight ? difficulty.bossGadgetCooldown : this.gadgetMax;
      this.gadgetFireTimer = 0;
      sfx.powerup();
    }

    gadgetBurst() {
      sfx.shoot();
      for (let i = 0; i < 3; i++) {
        const jitter = rand(-0.18, 0.18);
        bullets.push(new Bullet(this.x + rand(-6, 6), this.y - this.r, jitter, true, 900));
      }
    }

    shoot() {
      sfx.shoot();
      const count = this.spread + 1;
      const maxAngle = Math.min(0.14 * this.spread, 0.55);
      for (let i = 0; i < count; i++) {
        const a = count === 1 ? 0 : -maxAngle + (i / (count - 1)) * maxAngle * 2;
        bullets.push(new Bullet(this.x, this.y - this.r, a));
      }
    }

    hit() {
      if (this.invuln > 0) return false;
      if (this.shield > 0) {
        this.shield--;
        this.invuln = 1;
        sfx.hit();
        return false;
      }
      lives--;
      this.invuln = 2;
      sfx.hit();
      spawnExplosion(this.x, this.y, '#7fffd4');
      return true;
    }

    draw() {
      if (this.invuln > 0 && Math.floor(this.blinkT * 12) % 2 === 0) return;
      ctx.save();
      ctx.translate(this.x, this.y);

      // engine flame
      const flameLen = 10 + Math.random() * 6;
      const flame = ctx.createLinearGradient(0, this.r, 0, this.r + flameLen);
      flame.addColorStop(0, 'rgba(255,180,60,0.9)');
      flame.addColorStop(1, 'rgba(255,60,60,0)');
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(-5, this.r - 2);
      ctx.lineTo(5, this.r - 2);
      ctx.lineTo(0, this.r + flameLen);
      ctx.closePath();
      ctx.fill();

      // ship body
      ctx.fillStyle = '#7fffd4';
      ctx.strokeStyle = '#e8fffb';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -this.r);
      ctx.lineTo(this.r * 0.8, this.r * 0.8);
      ctx.lineTo(0, this.r * 0.4);
      ctx.lineTo(-this.r * 0.8, this.r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (this.shield > 0) {
        ctx.strokeStyle = 'rgba(120,200,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, this.r + 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  class Bullet {
    constructor(x, y, angle = 0, fromPlayer = true, speed = 700, color = null) {
      this.x = x;
      this.y = y;
      this.r = 3;
      this.speed = speed;
      this.vx = Math.sin(angle) * speed;
      this.vy = -Math.cos(angle) * speed;
      this.fromPlayer = fromPlayer;
      this.color = color;
      this.dead = false;
    }
    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.y < -20 || this.y > height + 20 || this.x < -20 || this.x > width + 20) {
        this.dead = true;
      }
    }
    draw() {
      ctx.save();
      ctx.fillStyle = this.color || (this.fromPlayer ? '#7fffd4' : '#ff5577');
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const ENEMY_TYPES = {
    drone: { r: 14, hp: 1, speed: 105, color: '#ff5577', score: 10, shootChance: 0 },
    striker: { r: 16, hp: 2, speed: 140, color: '#ffb454', score: 20, shootChance: 0.006 },
    tank: { r: 22, hp: 5, speed: 65, color: '#c86bff', score: 40, shootChance: 0.004 },
  };

  class Enemy {
    constructor(type, x) {
      const def = ENEMY_TYPES[type];
      const mult = difficulty.enemyMult;
      const speedMult = mult * waveSpeedMult();
      this.type = type;
      this.x = x;
      this.y = -40;
      this.r = def.r;
      this.hp = Math.ceil(def.hp * mult);
      this.maxHp = this.hp;
      this.speed = def.speed * speedMult;
      this.color = def.color;
      this.scoreValue = def.score;
      this.shootChance = def.shootChance * speedMult;
      this.bulletSpeed = 260 * speedMult;
      this.t = rand(0, Math.PI * 2);
      this.baseX = x;
      this.dead = false;
    }
    update(dt) {
      this.t += dt;
      this.y += this.speed * dt;
      this.x = this.baseX + Math.sin(this.t * 1.4) * 40;

      if (difficulty.enemiesAttack && this.shootChance > 0 && this.y > 0 && this.y < height - 60 && Math.random() < this.shootChance) {
        sfx.enemyShoot();
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const angle = Math.atan2(dx, -dy);
        enemyBullets.push(new Bullet(this.x, this.y + this.r, angle, false, this.bulletSpeed));
      }

      if (this.y > height + 50) this.dead = true;
    }
    hit(dmg) {
      this.hp -= dmg;
      if (this.hp <= 0) {
        this.dead = true;
        score += this.scoreValue;
        spawnExplosion(this.x, this.y, this.color);
        sfx.explosion();
        maybeDropPowerup(this.x, this.y);
      } else {
        sfx.hit();
      }
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.fillStyle = this.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, this.r);
      ctx.lineTo(this.r * 0.85, -this.r * 0.6);
      ctx.lineTo(0, -this.r * 0.15);
      ctx.lineTo(-this.r * 0.85, -this.r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (this.maxHp > 1) {
        const w = this.r * 1.8;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-w / 2, -this.r - 10, w, 4);
        ctx.fillStyle = '#7fffd4';
        ctx.fillRect(-w / 2, -this.r - 10, w * (this.hp / this.maxHp), 4);
      }
      ctx.restore();
    }
  }

  class Particle {
    constructor(x, y, color) {
      this.x = x;
      this.y = y;
      const a = rand(0, Math.PI * 2);
      const s = rand(40, 220);
      this.vx = Math.cos(a) * s;
      this.vy = Math.sin(a) * s;
      this.life = rand(0.3, 0.7);
      this.maxLife = this.life;
      this.color = color;
      this.r = rand(1, 3);
    }
    update(dt) {
      this.life -= dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= 0.94;
      this.vy *= 0.94;
    }
    draw() {
      ctx.save();
      ctx.globalAlpha = clamp(this.life / this.maxLife, 0, 1);
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const POWERUP_TYPES = ['spread', 'rapid', 'shield', 'life'];
  class PowerUp {
    constructor(x, y, kind) {
      this.x = x;
      this.y = y;
      this.r = 12;
      this.kind = kind;
      this.t = 0;
      this.dead = false;
    }
    update(dt) {
      this.y += 90 * dt;
      this.t += dt;
      if (this.y > height + 30) this.dead = true;
    }
    draw() {
      const colors = { spread: '#7fffd4', rapid: '#ffd166', shield: '#78c8ff', life: '#ff5577' };
      const glyphs = { spread: 'S', rapid: 'R', shield: '⛊', life: '+' };
      ctx.save();
      ctx.translate(this.x, this.y + Math.sin(this.t * 4) * 3);
      ctx.fillStyle = colors[this.kind];
      ctx.shadowColor = colors[this.kind];
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#05050f';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyphs[this.kind], 0, 1);
      ctx.restore();
    }
  }

  const HENCHMAN_TYPES = {
    spawnling: { r: 10, hp: 1, color: '#c86bff', score: 15, speed: 230 },
    acolyte: { r: 13, hp: 2, color: '#39ffa0', score: 20, speed: 55 },
  };

  class Henchman {
    constructor(type, x, y) {
      const def = HENCHMAN_TYPES[type];
      const mult = difficulty.enemyMult;
      const speedMult = mult * waveSpeedMult();
      this.type = type;
      this.x = x;
      this.y = y;
      this.r = def.r;
      this.hp = Math.ceil(def.hp * mult);
      this.maxHp = this.hp;
      this.color = def.color;
      this.scoreValue = def.score;
      this.speed = def.speed * speedMult;
      this.speedMult = speedMult;
      this.t = 0;
      this.shootTimer = rand(0.8, 1.6) / speedMult;
      this.dead = false;

      if (this.type === 'spawnling') {
        // dive-bombs toward the player's position at spawn time, ignores bullets
        const dx = player.x - this.x;
        const dy = height + 60 - this.y;
        const dist = Math.hypot(dx, dy) || 1;
        this.vx = (dx / dist) * this.speed;
        this.vy = (dy / dist) * this.speed;
      }
    }
    update(dt) {
      this.t += dt;
      if (this.type === 'spawnling') {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.y > height + 40 || this.x < -40 || this.x > width + 40) this.dead = true;
      } else if (this.type === 'acolyte') {
        this.y += this.speed * dt;
        this.x += Math.sin(this.t * 2.2) * 55 * dt;
        this.shootTimer -= dt;
        if (difficulty.enemiesAttack && this.shootTimer <= 0) {
          this.shootTimer = rand(1.3, 2.1) / this.speedMult;
          sfx.enemyShoot();
          enemyBullets.push(new Bullet(this.x, this.y + this.r, 0, false, 300 * this.speedMult, this.color));
        }
        if (this.y > height + 40) this.dead = true;
      }
    }
    hit(dmg) {
      this.hp -= dmg;
      if (this.hp <= 0) {
        this.dead = true;
        score += this.scoreValue;
        spawnExplosion(this.x, this.y, this.color);
        sfx.explosion();
      } else {
        sfx.hit();
      }
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.fillStyle = this.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (this.type === 'spawnling') {
        ctx.moveTo(0, -this.r);
        ctx.lineTo(this.r * 0.75, 0);
        ctx.lineTo(0, this.r);
        ctx.lineTo(-this.r * 0.75, 0);
      } else {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const px = Math.cos(a) * this.r;
          const py = Math.sin(a) * this.r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  const BOSS_KINDS = [
    { key: 'serpent', name: 'CRIMSON SERPENT', color: '#ff2f6e', hpBonus: 0, rBonus: 0, henchman: null },
    { key: 'sentinel', name: 'AZURE SENTINEL', color: '#39c5ff', hpBonus: -10, rBonus: -4, henchman: null },
    { key: 'swarmqueen', name: 'VIOLET SWARM QUEEN', color: '#c86bff', hpBonus: -20, rBonus: -6, henchman: { type: 'spawnling', interval: 3.2, count: 2 } },
    { key: 'juggernaut', name: 'AMBER JUGGERNAUT', color: '#ff8c1a', hpBonus: 40, rBonus: 10, henchman: null },
    { key: 'overmind', name: 'EMERALD OVERMIND', color: '#39ffa0', hpBonus: 20, rBonus: 4, henchman: { type: 'acolyte', interval: 4.5, count: 2 } },
  ];

  class Boss {
    constructor(tier, diff) {
      const kindDef = BOSS_KINDS[(tier - 1) % BOSS_KINDS.length];
      this.tier = tier;
      this.mult = diff.enemyMult;
      this.speedMult = this.mult * waveSpeedMult();
      this.kindKey = kindDef.key;
      this.name = kindDef.name;
      this.color = kindDef.color;
      this.r = 46 + Math.min(tier, 5) * 4 + kindDef.rBonus;
      this.maxHp = Math.ceil((70 + tier * 45 + kindDef.hpBonus) * this.mult);
      this.hp = this.maxHp;
      this.centerX = width / 2;
      this.x = width / 2;
      this.y = -this.r * 2;
      this.baseY = 130;
      this.targetY = 130;
      this.phase = 'entering';
      this.enterSpeed = 140 * this.speedMult;
      this.t = 0;
      this.spinAngle = 0;
      this.shootTimer = 1.2;
      this.hitFlash = 0;
      this.dead = false;
      this.scoreValue = 300 + tier * 100;
      this.teleportEnabled = diff.bossTeleport;
      this.teleportTimer = rand(3, 5) / this.speedMult;
      this.teleportFlash = 0;
      this.waypointX = width / 2;
      this.waypointY = 130;
      this.waypointTimer = 0;
      this.henchmanCfg = kindDef.henchman;
      this.henchTimer = this.henchmanCfg ? rand(2, 3.5) / this.speedMult : Infinity;
      this.regenDelay = 0;
    }
    teleport() {
      spawnExplosion(this.x, this.y, '#c86bff');
      const nx = rand(width * 0.25, width * 0.75);
      const ny = rand(90, 220);
      this.centerX = nx;
      this.x = nx;
      this.y = ny;
      this.waypointX = nx;
      this.waypointY = ny;
      this.t = 0;
      spawnExplosion(nx, ny, '#c86bff');
      this.teleportFlash = 0.25;
      sfx.powerup();
    }
    updateMovement(dt) {
      switch (this.kindKey) {
        case 'serpent': {
          const ampX = width * 0.28;
          this.x = clamp(this.centerX + Math.sin(this.t * 0.7) * ampX, this.r + 10, width - this.r - 10);
          this.y = clamp(this.baseY + Math.sin(this.t * 0.35) * 40, 60, height * 0.5);
          break;
        }
        case 'sentinel': {
          const ampX = width * 0.22;
          this.x = clamp(this.centerX + Math.cos(this.t * 0.5) * ampX, this.r + 10, width - this.r - 10);
          this.y = clamp(this.baseY + Math.sin(this.t * 0.5) * 70, 60, height * 0.5);
          break;
        }
        case 'swarmqueen': {
          this.waypointTimer -= dt;
          const closeEnough = Math.abs(this.x - this.waypointX) < 8 && Math.abs(this.y - this.waypointY) < 8;
          if (this.waypointTimer <= 0 || closeEnough) {
            this.waypointTimer = rand(1.2, 2.2);
            this.waypointX = rand(width * 0.2, width * 0.8);
            this.waypointY = rand(80, height * 0.42);
          }
          const dx = this.waypointX - this.x;
          const dy = this.waypointY - this.y;
          const dist = Math.hypot(dx, dy) || 1;
          const spd = 170 * this.speedMult;
          this.x = clamp(this.x + (dx / dist) * spd * dt, this.r + 10, width - this.r - 10);
          this.y = clamp(this.y + (dy / dist) * spd * dt, 60, height * 0.5);
          break;
        }
        case 'juggernaut': {
          const ampX = width * 0.24;
          this.x = clamp(this.centerX + Math.sin(this.t * 0.35) * ampX, this.r + 10, width - this.r - 10);
          this.y = clamp(this.baseY + Math.sin(this.t * 0.7) * 110, 60, height * 0.5);
          break;
        }
        case 'overmind': {
          this.x = clamp(this.x + (player.x - this.x) * 1.4 * this.speedMult * dt, this.r + 10, width - this.r - 10);
          this.y = clamp(this.baseY + Math.sin(this.t * 0.6) * 90, 60, height * 0.5);
          break;
        }
      }
    }
    attackInterval(enraged) {
      const base = {
        serpent: enraged ? 0.5 : 0.9,
        sentinel: enraged ? 0.35 : 0.55,
        swarmqueen: enraged ? 0.9 : 1.4,
        juggernaut: enraged ? 0.8 : 1.2,
        overmind: enraged ? 0.4 : 0.65,
      }[this.kindKey];
      return base / this.speedMult;
    }
    performAttack() {
      sfx.enemyShoot();
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      switch (this.kindKey) {
        case 'serpent': {
          const baseAngle = Math.atan2(dx, -dy);
          for (const off of [-0.35, -0.15, 0, 0.15, 0.35]) {
            enemyBullets.push(new Bullet(this.x, this.y + this.r * 0.6, baseAngle + off, false, 240 * this.speedMult, this.color));
          }
          break;
        }
        case 'sentinel': {
          const count = 6;
          for (let i = 0; i < count; i++) {
            const angle = this.spinAngle + (i / count) * Math.PI * 2;
            enemyBullets.push(new Bullet(this.x, this.y, angle, false, 200 * this.speedMult, this.color));
          }
          this.spinAngle += 0.35;
          break;
        }
        case 'swarmqueen': {
          const angle = Math.atan2(dx, -dy);
          enemyBullets.push(new Bullet(this.x, this.y + this.r * 0.6, angle, false, 150 * this.speedMult, this.color));
          break;
        }
        case 'juggernaut': {
          const baseAngle = Math.atan2(dx, -dy);
          const count = 7;
          for (let i = 0; i < count; i++) {
            const angle = baseAngle + (i / (count - 1) - 0.5) * Math.PI * 0.6;
            const b = new Bullet(this.x, this.y + this.r * 0.6, angle, false, 150 * this.speedMult, this.color);
            b.r = 6;
            enemyBullets.push(b);
          }
          break;
        }
        case 'overmind': {
          const arms = 3;
          for (let i = 0; i < arms; i++) {
            const angle = this.spinAngle + (i / arms) * Math.PI * 2;
            enemyBullets.push(new Bullet(this.x, this.y, angle, false, 220 * this.speedMult, this.color));
          }
          this.spinAngle += 0.5;
          break;
        }
      }
    }
    update(dt) {
      this.t += dt * this.speedMult;
      if (this.hitFlash > 0) this.hitFlash -= dt;
      if (this.teleportFlash > 0) this.teleportFlash -= dt;

      if (this.phase === 'entering') {
        this.y += this.enterSpeed * dt;
        if (this.y >= this.targetY) {
          this.y = this.targetY;
          this.phase = 'fighting';
          this.t = 0;
        }
        return;
      }

      this.updateMovement(dt);
      const enraged = this.hp < this.maxHp * 0.35;

      if (this.regenDelay > 0) {
        this.regenDelay -= dt;
      } else if (this.hp < this.maxHp) {
        this.hp = clamp(this.hp + this.maxHp * 0.02 * dt, 0, this.maxHp);
      }

      if (this.teleportEnabled) {
        this.teleportTimer -= dt;
        if (this.teleportTimer <= 0) {
          this.teleportTimer = (enraged ? rand(2.5, 3.5) : rand(3.5, 5.5)) / this.speedMult;
          this.teleport();
        }
      }

      if (difficulty.bossAttack) {
        this.shootTimer -= dt;
        if (this.shootTimer <= 0) {
          this.shootTimer = this.attackInterval(enraged);
          this.performAttack();
        }
      }

      if (this.henchmanCfg) {
        this.henchTimer -= dt;
        if (this.henchTimer <= 0) {
          this.henchTimer = this.henchmanCfg.interval / this.speedMult;
          for (let i = 0; i < this.henchmanCfg.count; i++) {
            henchmen.push(new Henchman(this.henchmanCfg.type, this.x + rand(-70, 70), this.y + this.r + 10));
          }
        }
      }
    }
    hit(dmg) {
      if (this.dead) return;
      this.hp -= dmg;
      this.hitFlash = 0.08;
      this.regenDelay = 3;
      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        score += this.scoreValue;
        sfx.explosion();
        for (let i = 0; i < 8; i++) {
          spawnExplosion(this.x + rand(-40, 40), this.y + rand(-30, 30), this.color);
        }
        const dropCount = 6;
        for (let i = 0; i < dropCount; i++) {
          const angle = (i / dropCount) * Math.PI * 2;
          const dist = rand(20, 55);
          const kind = POWERUP_TYPES[Math.floor(rand(0, POWERUP_TYPES.length))];
          powerups.push(new PowerUp(this.x + Math.cos(angle) * dist, this.y + Math.sin(angle) * dist, kind));
        }
      } else {
        sfx.hit();
      }
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : this.teleportFlash > 0 ? '#c86bff' : this.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      switch (this.kindKey) {
        case 'serpent':
          ctx.moveTo(0, this.r);
          ctx.lineTo(this.r, -this.r * 0.3);
          ctx.lineTo(this.r * 0.55, -this.r * 0.9);
          ctx.lineTo(0, -this.r * 0.4);
          ctx.lineTo(-this.r * 0.55, -this.r * 0.9);
          ctx.lineTo(-this.r, -this.r * 0.3);
          ctx.closePath();
          break;
        case 'sentinel':
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const px = Math.cos(a) * this.r;
            const py = Math.sin(a) * this.r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          break;
        case 'swarmqueen':
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const rad = i % 2 === 0 ? this.r : this.r * 0.5;
            const px = Math.cos(a) * rad;
            const py = Math.sin(a) * rad;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          break;
        case 'juggernaut':
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const px = Math.cos(a) * this.r;
            const py = Math.sin(a) * this.r * 0.85;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          break;
        case 'overmind':
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2;
            const rad = i % 2 === 0 ? this.r : this.r * 0.62;
            const px = Math.cos(a) * rad;
            const py = Math.sin(a) * rad;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          break;
      }
      ctx.fill();
      ctx.stroke();
      if (this.kindKey === 'sentinel') {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, this.r * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      const barW = 340;
      const barX = width / 2 - barW / 2;
      const barY = 46;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(barX, barY, barW, 14);
      ctx.fillStyle = this.color;
      ctx.fillRect(barX, barY, barW * (this.hp / this.maxHp), 14);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(barX, barY, barW, 14);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.name, width / 2, barY - 5);
      ctx.restore();
    }
  }

  function spawnExplosion(x, y, color) {
    for (let i = 0; i < 18; i++) particles.push(new Particle(x, y, color));
  }

  function maybeDropPowerup(x, y) {
    if (Math.random() < 0.14) {
      const kind = POWERUP_TYPES[Math.floor(rand(0, POWERUP_TYPES.length))];
      powerups.push(new PowerUp(x, y, kind));
    }
  }

  function applyPowerup(kind) {
    sfx.powerup();
    switch (kind) {
      case 'spread':
        player.spread = clamp(player.spread + 1, 0, 7);
        break;
      case 'rapid':
        player.rapid = 6;
        break;
      case 'shield':
        player.shield = clamp(player.shield + 1, 0, 3);
        break;
      case 'life':
        lives = clamp(lives + 1, 0, 15);
        break;
    }
  }

  // ---------- Wave spawning ----------
  function buildWave(n) {
    const queue = [];
    const rows = 3 + Math.min(4, Math.floor(n / 2));
    const cols = 5;
    const marginX = width * 0.12;
    const gapX = (width - marginX * 2) / (cols - 1);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let type = 'drone';
        const roll = Math.random();
        if (n >= 2 && roll > 0.8) type = 'striker';
        if (n >= 4 && roll > 0.93) type = 'tank';
        queue.push({
          delay: r * 0.5 + c * 0.08,
          type,
          x: marginX + c * gapX,
        });
      }
    }
    return queue.sort((a, b) => a.delay - b.delay);
  }

  function startWave(n) {
    wave = n;
    if (n % 10 === 0) {
      spawnQueue = [];
      spawnTimer = 0;
      boss = new Boss(Math.floor(n / 10), difficulty);
      waveMessage = 'WARNING: BOSS INCOMING';
      waveMessageTimer = 2.2;
    } else {
      spawnQueue = buildWave(n);
      spawnTimer = 0;
      waveMessage = `WAVE ${n}`;
      waveMessageTimer = 1.6;
    }
    sfx.wave();
  }

  // ---------- Game lifecycle ----------
  function resetGame() {
    score = 0;
    lives = 3;
    wave = 0;
    player = new Player(difficulty);
    bullets = [];
    enemyBullets = [];
    enemies = [];
    particles = [];
    powerups = [];
    boss = null;
    henchmen = [];
    initStars();
    startWave(1);
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      pauseScreen.classList.remove('hidden');
    } else if (state === 'paused') {
      state = 'playing';
      pauseScreen.classList.add('hidden');
    }
  }

  function gameOver() {
    state = 'gameover';
    const hs = getHighScore();
    const isNew = score > hs;
    if (isNew) setHighScore(score);
    finalScoreEl.textContent = `SCORE: ${score}`;
    newHighScoreEl.classList.toggle('hidden', !isNew);
    highScoreDisplay.textContent = `High Score: ${getHighScore()}`;
    gameOverScreen.classList.remove('hidden');
  }

  diffButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      difficulty = DIFFICULTIES[btn.dataset.diff];
      startScreen.classList.add('hidden');
      resetGame();
      state = 'playing';
    });
  });
  resumeButton.addEventListener('click', togglePause);
  restartButton.addEventListener('click', () => {
    gameOverScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
    state = 'start';
  });

  // ---------- Update ----------
  function update(dt) {
    updateStars(dt);

    if (state !== 'playing') return;

    player.update(dt);

    // spawn queued enemies for this wave
    spawnTimer += dt;
    while (spawnQueue.length && spawnQueue[0].delay <= spawnTimer) {
      const s = spawnQueue.shift();
      enemies.push(new Enemy(s.type, s.x));
    }
    if (waveMessageTimer > 0) waveMessageTimer -= dt;

    // advance to next wave once cleared (grunt wave empty, or boss + henchmen defeated)
    if (spawnQueue.length === 0 && enemies.length === 0 && !boss && henchmen.length === 0) {
      startWave(wave + 1);
    }

    for (const b of bullets) b.update(dt);
    for (const b of enemyBullets) b.update(dt);
    for (const e of enemies) e.update(dt);
    for (const p of particles) p.update(dt);
    for (const pu of powerups) pu.update(dt);
    for (const h of henchmen) h.update(dt);
    if (boss) boss.update(dt);

    // player bullets vs enemies
    for (const b of bullets) {
      if (b.dead) continue;
      for (const e of enemies) {
        if (e.dead) continue;
        if (circleHit(b, e)) {
          b.dead = true;
          e.hit(1);
          break;
        }
      }
    }

    // player bullets vs henchmen
    for (const b of bullets) {
      if (b.dead) continue;
      for (const h of henchmen) {
        if (h.dead) continue;
        if (circleHit(b, h)) {
          b.dead = true;
          h.hit(1);
          break;
        }
      }
    }

    // player bullets vs boss
    if (boss && !boss.dead) {
      for (const b of bullets) {
        if (b.dead) continue;
        if (circleHit(b, boss)) {
          b.dead = true;
          boss.hit(1);
        }
      }
    }

    // enemy bullets vs player
    for (const b of enemyBullets) {
      if (b.dead) continue;
      if (circleHit(b, player)) {
        b.dead = true;
        player.hit();
      }
    }

    // enemies vs player (collision)
    for (const e of enemies) {
      if (e.dead) continue;
      if (circleHit(e, player)) {
        e.dead = true;
        spawnExplosion(e.x, e.y, e.color);
        sfx.explosion();
        player.hit();
      }
    }

    // henchmen vs player (collision)
    for (const h of henchmen) {
      if (h.dead) continue;
      if (circleHit(h, player)) {
        h.dead = true;
        spawnExplosion(h.x, h.y, h.color);
        sfx.explosion();
        player.hit();
      }
    }

    // boss vs player (contact damage)
    if (boss && !boss.dead && boss.phase === 'fighting' && circleHit(boss, player)) {
      player.hit();
    }

    // powerups vs player
    for (const pu of powerups) {
      if (pu.dead) continue;
      if (circleHit(pu, player)) {
        pu.dead = true;
        applyPowerup(pu.kind);
      }
    }

    bullets = bullets.filter((b) => !b.dead);
    enemyBullets = enemyBullets.filter((b) => !b.dead);
    enemies = enemies.filter((e) => !e.dead);
    particles = particles.filter((p) => p.life > 0);
    powerups = powerups.filter((p) => !p.dead);
    henchmen = henchmen.filter((h) => !h.dead);
    if (boss && boss.dead) boss = null;

    if (lives <= 0) {
      gameOver();
    }

    hudScore.textContent = `SCORE: ${score}`;
    hudLevel.textContent = boss ? `BOSS WAVE ${wave}` : `WAVE ${wave}`;
    hudLives.textContent = `LIVES: ${'❤'.repeat(clamp(lives, 0, 15))}`;

    if (!player.gadgetEnabled) {
      hudGadget.classList.remove('firing', 'ready');
      hudGadget.classList.add('disabled');
      hudGadget.textContent = 'GADGET: DISABLED';
    } else {
      hudGadget.classList.remove('disabled');
      hudGadget.classList.toggle('firing', player.gadgetActive > 0);
      hudGadget.classList.toggle('ready', player.gadgetActive <= 0 && player.gadgetCooldown <= 0);
      if (player.gadgetActive > 0) {
        hudGadget.textContent = 'GADGET: FIRING!';
      } else if (player.gadgetCooldown > 0) {
        hudGadget.textContent = `GADGET: ${Math.ceil(player.gadgetCooldown)}s`;
      } else {
        hudGadget.textContent = 'GADGET: READY (E)';
      }
    }
  }

  // ---------- Draw ----------
  function draw() {
    ctx.clearRect(0, 0, width, height);
    drawStars();

    if (state === 'start') return;

    for (const pu of powerups) pu.draw();
    for (const b of bullets) b.draw();
    for (const b of enemyBullets) b.draw();
    for (const e of enemies) e.draw();
    for (const h of henchmen) h.draw();
    if (boss) boss.draw();
    for (const p of particles) p.draw();
    if (state !== 'gameover') player.draw();

    if (waveMessageTimer > 0 && state === 'playing') {
      ctx.save();
      ctx.globalAlpha = clamp(waveMessageTimer, 0, 1);
      ctx.fillStyle = boss ? '#ff5577' : '#7fffd4';
      ctx.textAlign = 'center';
      ctx.font = 'bold 34px monospace';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 16;
      ctx.fillText(waveMessage, width / 2, height / 2);
      ctx.restore();
    }
  }

  // ---------- Main loop ----------
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  initStars();
  requestAnimationFrame(loop);
})();
