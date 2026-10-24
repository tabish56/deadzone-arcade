const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let player = { x: 400, y: 300, hp: 100, maxHp: 100, speed: 4, coins: 0 };
let keys = {};
let bullets = [];
let zombies = [];
let gameState = "PLAY"; 
let wave = 1;
let zombiesToKill = 5;
let zombiesKilledThisWave = 0;
let intermissionTimer = 0;
let mouse = { x: 400, y: 300 };
let isTouchDevice = false;

// --- VIRTUAL JOYSTICK STATE FOR MOBILE/TABLET ---
let joystick = { active: false, startX: 0, startY: 0, curX: 0, curY: 0, moveX: 0, moveY: 0 };

// --- SCREEN ADAPTATION SCALE HANDLERS ---
function resizeGameView() {
    // Dynamic resolution scaling calculation
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;
    
    // Scale standard coordinate grid boundaries safely
    canvas.width = 800;
    canvas.height = 600;
    
    // Force device input check parameters dynamically
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        isTouchDevice = true;
    }
}
window.addEventListener('resize', resizeGameView);
window.addEventListener('orientationchange', resizeGameView);

// --- INPUT LISTENERS (KEYBOARD & MOUSE) ---
window.addEventListener("keydown", (e) => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", (e) => keys[e.key.toLowerCase()] = false);

canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
});

canvas.addEventListener("mousedown", () => {
    if (gameState === "PLAY" && !isTouchDevice) fireManualBullet();
    if (gameState === "GAMEOVER") resetGame();
});

// --- INPUT LISTENERS (TOUCH CONTROLS FOR MOBILE/TABLET) ---
canvas.addEventListener("touchstart", (e) => {
    isTouchDevice = true;
    if (gameState === "GAMEOVER") { resetGame(); return; }
    
    const rect = canvas.getBoundingClientRect();
    for (let t of e.changedTouches) {
        let tx = (t.clientX - rect.left) * (canvas.width / rect.width);
        let ty = (t.clientY - rect.top) * (canvas.height / rect.height);
        
        if (tx < canvas.width / 2 && !joystick.active) {
            joystick.active = true;
            joystick.startX = tx;
            joystick.startY = ty;
            joystick.curX = tx;
            joystick.curY = ty;
        } else if (tx >= canvas.width / 2 && gameState === "PLAY") {
            // Touch right side of mobile screen to shoot
            let angle = Math.atan2(ty - player.y, tx - player.x);
            bullets.push({ x: player.x, y: player.y, vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8 });
        }
    }
}, { passive: true });

canvas.addEventListener("touchmove", (e) => {
    if (!joystick.active) return;
    const rect = canvas.getBoundingClientRect();
    for (let t of e.touches) {
        let tx = (t.clientX - rect.left) * (canvas.width / rect.width);
        let ty = (t.clientY - rect.top) * (canvas.height / rect.height);
        
        if (tx < canvas.width / 2 || joystick.active) {
            joystick.curX = tx;
            joystick.curY = ty;
            
            let dx = joystick.curX - joystick.startX;
            let dy = joystick.curY - joystick.startY;
            let dist = Math.hypot(dx, dy);
            
            if (dist > 50) {
                dx = (dx / dist) * 50;
                dy = (dy / dist) * 50;
            }
            joystick.moveX = dx / 50;
            joystick.moveY = dy / 50;
        }
    }
}, { passive: true });

canvas.addEventListener("touchend", () => {
    joystick.active = false;
    joystick.moveX = 0;
    joystick.moveY = 0;
});

// --- COMBAT ACTIONS ---
function fireManualBullet() {
    let angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    bullets.push({ x: player.x, y: player.y, vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8 });
}

function fireAutoBullet(targetZ) {
    let angle = Math.atan2(targetZ.y - player.y, targetZ.x - player.x);
    bullets.push({ x: player.x, y: player.y, vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8 });
}

function spawnZombie() {
    let edge = Math.floor(Math.random() * 4);
    let x, y;
    if (edge === 0) { x = Math.random() * canvas.width; y = -20; }
    else if (edge === 1) { x = canvas.width + 20; y = Math.random() * canvas.height; }
    else if (edge === 2) { x = Math.random() * canvas.width; y = canvas.height + 20; }
    else { x = -20; y = Math.random() * canvas.height; }
    zombies.push({ x, y, hp: 20 + wave * 5, speed: 1 + Math.random() * 0.8 });
}

function startIntermission() {
    gameState = "INTERMISSION";
    intermissionTimer = 5 * 60; 
}

function nextWave() {
    wave++;
    zombiesToKill = 5 + wave * 3;
    zombiesKilledThisWave = 0;
    gameState = "PLAY";
}

function resetGame() {
    player = { x: 400, y: 300, hp: 100, maxHp: 100, speed: 4, coins: 0 };
    bullets = []; zombies = [];
    wave = 1; zombiesToKill = 5; zombiesKilledThisWave = 0;
    gameState = "PLAY";
}

let autoFireCooldown = 0;

function update() {
    if (gameState === "PLAY") {
        if (keys['w'] || keys['arrowup']) player.y -= player.speed;
        if (keys['s'] || keys['arrowdown']) player.y += player.speed;
        if (keys['a'] || keys['arrowleft']) player.x -= player.speed;
        if (keys['d'] || keys['arrowright']) player.x += player.speed;

        if (joystick.active) {
            player.x += joystick.moveX * player.speed;
            player.y += joystick.moveY * player.speed;
        }

        player.x = Math.max(15, Math.min(canvas.width - 15, player.x));
        player.y = Math.max(15, Math.min(canvas.height - 15, player.y));

        if (zombies.length + zombiesKilledThisWave < zombiesToKill && Math.random() < 0.02) {
            spawnZombie();
        }

        if (isTouchDevice && zombies.length > 0) {
            autoFireCooldown++;
            if (autoFireCooldown >= 25) { 
                let nearestZ = null;
                let minDist = Infinity;
                zombies.forEach(z => {
                    let d = Math.hypot(z.x - player.x, z.y - player.y);
                    if (d < minDist) { minDist = d; nearestZ = z; }
                });
                if (nearestZ) fireAutoBullet(nearestZ);
                autoFireCooldown = 0;
            }
        }

        for (let i = bullets.length - 1; i >= 0; i--) {
            let b = bullets[i];
            b.x += b.vx; b.y += b.vy;
            if (b.x < 0 || b.x > canvas.width || b.y < 0 || b.y > canvas.height) {
                bullets.splice(i, 1);
            }
        }

        for (let i = zombies.length - 1; i >= 0; i--) {
            let z = zombies[i];
            let angle = Math.atan2(player.y - z.y, player.x - z.x);
            z.x += Math.cos(angle) * z.speed;
            z.y += Math.sin(angle) * z.speed;

            if (Math.hypot(player.x - z.x, player.y - z.y) < 22) {
                player.hp -= 0.3;
                if (player.hp <= 0) gameState = "GAMEOVER";
            }

            for (let j = bullets.length - 1; j >= 0; j--) {
                let b = bullets[j];
                if (Math.hypot(b.x - z.x, b.y - z.y) < 16) {
                    bullets.splice(j, 1);
                    z.hp -= 10;
                    if (z.hp <= 0) {
                        zombies.splice(i, 1);
                        player.coins += 5; 
                        zombiesKilledThisWave++;
                        if (zombiesKilledThisWave >= zombiesToKill && zombies.length === 0) {
                            startIntermission();
                        }
                        break;
                    }
                }
            }
        }
    } else if (gameState === "INTERMISSION") {
        intermissionTimer--;
        if (intermissionTimer <= 0) nextWave();
    }
}

function draw() {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!isTouchDevice) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 8, 0, Math.PI * 2); ctx.stroke();
    }

    // Draw Player Agent
    ctx.fillStyle = "#00ffcc";
    ctx.beginPath(); ctx.arc(player.x, player.y, 15, 0, Math.PI * 2); ctx.fill();

    // Draw Bullets
    ctx.fillStyle = "#ffcc00";
    bullets.forEach(b => { ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill(); });

    // Draw Zombies
    ctx.fillStyle = "#ff3333";
    zombies.forEach(z => { ctx.beginPath(); ctx.arc(z.x, z.y, 12, 0, Math.PI * 2); ctx.fill(); });

    // Render Virtual Touch Joystick Graphic Overlay
    if (isTouchDevice && joystick.active) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        ctx.beginPath(); ctx.arc(joystick.startX, joystick.startY, 50, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(0, 255, 204, 0.4)";
        ctx.beginPath(); ctx.arc(joystick.curX, joystick.curY, 20, 0, Math.PI * 2); ctx.fill();
    }

    // HUD Text Metrics
    ctx.fillStyle = "#fff"; ctx.font = "16px monospace";
    ctx.fillText(`WAVE: ${wave}`, 20, 30);
    ctx.fillText(`COINS: ${player.coins}`, 20, 50);
    ctx.fillText(`ZOMBIES: ${Math.max(0, zombiesToKill - zombiesKilledThisWave)}`, 20, 70);

    // Health UI Bar
    ctx.fillStyle = "#333"; ctx.fillRect(canvas.width - 170, 20, 150, 15);
    ctx.fillStyle = "#ff3333"; ctx.fillRect(canvas.width - 170, 20, (player.hp / player.maxHp) * 150, 15);

    if (gameState === "INTERMISSION") {
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#fff"; ctx.font = "30px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(`WAVE COMPLETED`, canvas.width / 2, canvas.height / 2 - 20);
        ctx.font = "20px sans-serif";
        ctx.fillText(`Next wave in: ${Math.ceil(intermissionTimer / 60)}s`, canvas.width / 2, canvas.height / 2 + 20);
        ctx.textAlign = "left";
    } 
       if (gameState === "GAMEOVER") {
        ctx.fillStyle = "rgba(139, 0, 0, 0.85)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#fff"; ctx.font = "40px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("YOU WERE OVERRUN", canvas.width / 2, canvas.height / 2 - 20);
        ctx.font = "20px sans-serif";
        ctx.fillText(isTouchDevice ? "Tap to respawn" : "Click to respawn", canvas.width / 2, canvas.height / 2 + 30);
        ctx.textAlign = "left";
    }
} // <-- THIS closing bracket finishes your draw() function!

function gameLoop() { update(); draw(); requestAnimationFrame(gameLoop); }

// --- EXTERNAL INITIALIZATION GATEWAY ---
function initGameEngine() {
    console.log("Responsive Canvas System Live.");
    resizeGameView();
    resetGame();
    gameLoop();
}


