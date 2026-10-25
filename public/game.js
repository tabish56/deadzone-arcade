
(() => {
  "use strict";

  // DEADZONE: LAST SURVIVOR — multiplayer client
  // Auto-shoots at the nearest living zombie.
  // Discord authentication remains in index.html.

  const W = 900;
  const H = 650;

  const $ = (tag, styles = {}, text = "") => {
    const el = document.createElement(tag);
    Object.assign(el.style, styles);
    if (text) el.textContent = text;
    return el;
  };

  let socket = null;
  let canvas = null;
  let ctx = null;
  let menu = null;
  let roomInput = null;
  let statusText = null;
  let started = false;
  let joined = false;
  let roomId = "";
  let lastInput = 0;
  let lastShot = 0;
  let joystick = { active: false, x: 0, y: 0, dx: 0, dy: 0 };
  let upgradeOpen = false;
  let upgradeChoices = [];
  let gameStatus = "waiting";

  const keys = new Set();

  const game = {
    players: [],
    zombies: [],
    bullets: [],
    wave: 1,
    kills: 0,
    totalToSpawn: 8,
    status: "waiting"
  };

  function status(message, error = false) {
    if (!statusText) return;
    statusText.textContent = message;
    statusText.style.color = error ? "#ff7070" : "#ddd";
  }

  function makeMenu() {
    menu = $("div", {
      position: "fixed",
      inset: "0",
      zIndex: "9999",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "radial-gradient(circle, #261010, #080808 70%)",
      color: "#fff",
      fontFamily: "Arial,sans-serif"
    });

    const panel = $("div", {
      width: "min(390px,88vw)",
      padding: "28px",
      background: "#171717",
      border: "1px solid #8e2525",
      borderRadius: "12px",
      boxShadow: "0 0 35px #55000066",
      textAlign: "center"
    });

    const heading = $("h1", {
      margin: "0 0 8px",
      color: "#ff4545",
      letterSpacing: "3px",
      fontSize: "28px"
    }, "DEADZONE");

    const subtitle = $("p", {
      margin: "0 0 24px",
      color: "#bbb",
      letterSpacing: "2px",
      fontSize: "12px"
    }, "LAST SURVIVOR · MULTIPLAYER");

    roomInput = $("input", {
      boxSizing: "border-box",
      width: "100%",
      padding: "13px",
      marginBottom: "12px",
      background: "#080808",
      border: "1px solid #444",
      borderRadius: "5px",
      color: "#fff",
      fontSize: "17px",
      textAlign: "center",
      textTransform: "uppercase",
      outline: "none"
    });

    roomInput.id = "deadzone-room-code";
    roomInput.name = "roomCode";
    roomInput.placeholder = "ENTER ROOM CODE";
    roomInput.maxLength = 24;
    roomInput.autocomplete = "off";
    roomInput.spellcheck = false;

    function makeButton(label) {
      const button = $("button", {
        width: "100%",
        padding: "13px",
        marginTop: "8px",
        border: "0",
        borderRadius: "5px",
        background: "#b32626",
        color: "#fff",
        fontSize: "14px",
        fontWeight: "bold",
        letterSpacing: "1px",
        cursor: "pointer"
      }, label);

      button.type = "button";
      button.addEventListener("mouseenter", () => {
        button.style.background = "#e13838";
      });
      button.addEventListener("mouseleave", () => {
        button.style.background = "#b32626";
      });

      return button;
    }

    const createButton = makeButton("CREATE NEW ROOM");
    const joinButton = makeButton("JOIN ROOM");

    statusText = $("p", {
      minHeight: "36px",
      margin: "18px 0 0",
      color: "#ddd",
      fontSize: "13px",
      lineHeight: "1.5",
      overflowWrap: "anywhere"
    }, "Connecting to multiplayer server…");

    createButton.addEventListener("click", () => {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      roomInput.value = code;
      joinRoom(code);
    });

    joinButton.addEventListener("click", () => {
      joinRoom(roomInput.value.trim().toUpperCase());
    });

    roomInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        joinRoom(roomInput.value.trim().toUpperCase());
      }
    });

    panel.append(heading, subtitle, roomInput, createButton, joinButton, statusText);
    menu.appendChild(panel);
    document.body.appendChild(menu);
  }

  function connectSocket() {
    if (typeof window.io !== "function") {
      status("Socket.IO failed to load. Check /socket.io/socket.io.js.", true);
      return;
    }

    socket = window.io({
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000
    });

    socket.on("connect", () => {
      console.log("[DEADZONE] Socket.IO connected:", socket.id);
      status("Connected. Create a room or enter a room code.");

      if (joined && roomId) {
        socket.emit("room:join", { roomId }, (response) => {
          if (response?.room) applyState(response.room);
          if (response?.error) status(response.error, true);
        });
      }
    });

    socket.on("connect_error", (error) => {
      console.error("[DEADZONE] Socket.IO error:", error.message);
      status("Cannot connect to the game server. Check npm start.", true);
    });

    socket.on("disconnect", (reason) => {
      console.warn("[DEADZONE] Disconnected:", reason);
      keys.clear();
      status("Disconnected. Reconnecting…", true);
    });

    socket.on("game:state", (data) => {
      if (!data || typeof data !== "object") return;

      applyState(data);

      if (!started) startGame();
      if (menu) menu.style.display = "none";
      draw();
    });

    socket.on("game:upgrade-break", () => {
      const me = getMyPlayer();
      upgradeChoices = Array.isArray(me?.choices) ? me.choices : [];
      upgradeOpen = true;
      gameStatus = "upgrades";
      draw();
    });
  }

  function joinRoom(code) {
    if (!code || !/^[A-Z0-9_-]{1,24}$/.test(code)) {
      status("Enter a valid room code.", true);
      return;
    }

    if (!socket || !socket.connected) {
      status("Connecting to the server. Please wait and try again.", true);
      return;
    }

    roomId = code;
    status("Joining room " + code + "…");

    socket.emit("room:join", { roomId: code }, (response) => {
      console.log("[DEADZONE] Room join response:", response);

      if (!response || response.ok === false || response.error) {
        status(response?.error || "Could not join room.", true);
        return;
      }

      joined = true;
      roomId = code;

      if (response.room) {
        applyState(response.room);
        if (!started) startGame();
        if (menu) menu.style.display = "none";
        draw();
      }

      status("Joined room " + code);
    });
  }

  function applyState(data) {
    game.players = Array.isArray(data.players) ? data.players : [];
    game.zombies = Array.isArray(data.zombies) ? data.zombies : [];
    game.bullets = Array.isArray(data.bullets) ? data.bullets : [];
    game.wave = Number(data.wave) || 1;
    game.kills = Number(data.kills) || 0;
    game.totalToSpawn = Number(data.totalToSpawn) || 0;
    game.status = data.status || "playing";
    gameStatus = game.status;

    if (data.roomId) roomId = data.roomId;

    const me = getMyPlayer();
    upgradeChoices = Array.isArray(me?.choices) ? me.choices : [];

    if (gameStatus === "upgrades" && upgradeChoices.length) {
      upgradeOpen = true;
    } else if (gameStatus !== "upgrades") {
      upgradeOpen = false;
    }
  }

  function getMyPlayer() {
    if (!socket) return null;
    return game.players.find((player) => player.id === socket.id) || null;
  }

  function startGame() {
    if (started) return;
    started = true;

    canvas = $("canvas", {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      background: "#101010",
      touchAction: "none",
      outline: "none",
      cursor: "crosshair"
    });

    canvas.width = W;
    canvas.height = H;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "DEADZONE game area");
    ctx = canvas.getContext("2d");

    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    document.body.appendChild(canvas);

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearControls);

    requestAnimationFrame(gameLoop);
  }

  function onKeyDown(event) {
    const key = event.key.toLowerCase();
    const movementKeys = [
      "w", "a", "s", "d",
      "arrowup", "arrowdown", "arrowleft", "arrowright"
    ];

    if (movementKeys.includes(key)) {
      keys.add(key);
      event.preventDefault();
    }

    if (key === " " && upgradeOpen) {
      event.preventDefault();
      chooseUpgrade(0);
    }

    if (upgradeOpen && /^[1-3]$/.test(key)) {
      chooseUpgrade(Number(key) - 1);
    }
  }

  function onKeyUp(event) {
    keys.delete(event.key.toLowerCase());
  }

  function clearControls() {
    keys.clear();
    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;
  }

  function onPointerMove(event) {
    if (joystick.active) updateJoystick(event);
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;

    canvas.focus();

    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * W / rect.width;
    const y = (event.clientY - rect.top) * H / rect.height;

    if (upgradeOpen) {
      chooseUpgradeAt(x, y);
      return;
    }

    if (event.pointerType === "touch" && x < W * 0.45) {
      joystick.active = true;
      joystick.x = x;
      joystick.y = y;
      joystick.dx = 0;
      joystick.dy = 0;
      updateJoystick(event);
    }

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (_) {}
  }

  function onPointerUp() {
    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;
  }

  function updateJoystick(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * W / rect.width;
    const y = (event.clientY - rect.top) * H / rect.height;
    const dx = x - joystick.x;
    const dy = y - joystick.y;
    const length = Math.hypot(dx, dy);
    const scale = length > 55 ? 55 / length : 1;

    joystick.dx = dx * scale / 55;
    joystick.dy = dy * scale / 55;
  }

  function sendMovement() {
    if (!socket?.connected || !joined || !started) return;

    let x = 0;
    let y = 0;

    if (keys.has("w") || keys.has("arrowup")) y -= 1;
    if (keys.has("s") || keys.has("arrowdown")) y += 1;
    if (keys.has("a") || keys.has("arrowleft")) x -= 1;
    if (keys.has("d") || keys.has("arrowright")) x += 1;

    if (joystick.active) {
      x = joystick.dx;
      y = joystick.dy;
    }

    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }

    const now = performance.now();
    if (now - lastInput < 33) return;
    lastInput = now;

    socket.emit("player:input", { x, y });
  }

  // Automatically shoots at the nearest living zombie.
  function shootAtNearestZombie() {
    if (!socket?.connected || !joined || !started) return;
    if (gameStatus !== "playing") return;

    const now = performance.now();

    // Client pacing; server-side cooldown still controls actual firing.
    if (now - lastShot < 140) return;

    const me = getMyPlayer();
    if (!me || me.alive === false || Number(me.hp) <= 0) return;
    if (!Array.isArray(game.zombies) || game.zombies.length === 0) return;

    let target = null;
    let nearestDistanceSquared = Infinity;

    for (const zombie of game.zombies) {
      if (!zombie || zombie.alive === false || Number(zombie.hp) <= 0) {
        continue;
      }

      const zx = Number(zombie.x);
      const zy = Number(zombie.y);

      if (!Number.isFinite(zx) || !Number.isFinite(zy)) continue;

      const dx = zx - Number(me.x);
      const dy = zy - Number(me.y);
      const distanceSquared = dx * dx + dy * dy;

      if (distanceSquared < nearestDistanceSquared) {
        nearestDistanceSquared = distanceSquared;
        target = { x: zx, y: zy };
      }
    }

    if (!target) return;

    const dx = target.x - Number(me.x);
    const dy = target.y - Number(me.y);

    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (dx === 0 && dy === 0) return;

    lastShot = now;
    socket.emit("player:shoot", { dx, dy });
  }

  function chooseUpgrade(index) {
    if (!upgradeOpen || !socket?.connected) return;

    const choice = upgradeChoices[index];
    if (!choice?.id) return;

    socket.emit("player:upgrade", { id: choice.id });
    upgradeOpen = false;
  }

  function chooseUpgradeAt(x, y) {
    if (!upgradeOpen || !upgradeChoices.length) return;

    const count = upgradeChoices.length;
    const cardWidth = Math.min(220, (W - 60) / count);
    const gap = 14;
    const totalWidth = count * cardWidth + (count - 1) * gap;
    const startX = (W - totalWidth) / 2;
    const cardHeight = 210;
    const top = H / 2 - 85;

    for (let i = 0; i < count; i++) {
      const left = startX + i * (cardWidth + gap);

      if (
        x >= left && x <= left + cardWidth &&
        y >= top && y <= top + cardHeight
      ) {
        chooseUpgrade(i);
        return;
      }
    }
  }

  function gameLoop() {
    if (started) {
      sendMovement();
      shootAtNearestZombie();
      draw();
    }

    requestAnimationFrame(gameLoop);
  }

  function drawGrid() {
    ctx.fillStyle = "#101010";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "#202020";
    ctx.lineWidth = 1;

    for (let x = 0; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    for (let y = 0; y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#5d1b1b";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
  }

  function drawPlayer(player, isMe) {
    const x = Number(player.x) || 0;
    const y = Number(player.y) || 0;
    const radius = 15;

    ctx.beginPath();
    ctx.fillStyle = isMe ? "#45a6ff" : "#bd7aff";
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isMe ? "#9bd4ff" : "#ead1ff";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(isMe ? "YOU" : "ALLY", x, y - radius - 9);

    const hp = Math.max(0, Number(player.hp) || 0);
    const maxHp = Math.max(1, Number(player.maxHp) || 100);

    ctx.fillStyle = "#333";
    ctx.fillRect(x - 16, y + radius + 5, 32, 4);

    ctx.fillStyle = hp > maxHp * 0.3 ? "#45ed75" : "#ff4545";
    ctx.fillRect(
      x - 16,
      y + radius + 5,
      32 * Math.min(1, hp / maxHp),
      4
    );
  }

  function drawZombie(zombie) {
    ctx.beginPath();
    ctx.fillStyle = "#69a34b";
    ctx.arc(Number(zombie.x) || 0, Number(zombie.y) || 0, 13, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#b8e69a";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawBullet(bullet) {
    ctx.beginPath();
    ctx.fillStyle = "#ffd54a";
    ctx.arc(Number(bullet.x) || 0, Number(bullet.y) || 0, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHud() {
    const me = getMyPlayer();
    const hp = me ? Math.max(0, Number(me.hp) || 0) : 0;
    const maxHp = me ? Math.max(1, Number(me.maxHp) || 100) : 100;
    const coins = me ? Number(me.coins) || 0 : 0;
    const alive = game.players.filter((p) => p.alive !== false).length;

    ctx.textAlign = "left";
    ctx.fillStyle = "#f4f4f4";
    ctx.font = "bold 14px monospace";

    ctx.fillText("WAVE: " + game.wave, 22, 30);
    ctx.fillText("ROOM: " + (roomId || "------"), 22, 52);
    ctx.fillText("PLAYERS: " + alive + "/" + game.players.length, 22, 74);
    ctx.fillText("KILLS: " + game.kills + "/" + game.totalToSpawn, 22, 96);
    ctx.fillText("COINS: " + coins, 22, 118);

    const barWidth = 170;
    const barX = W - barWidth - 22;
    const barY = 22;

    ctx.fillStyle = "#333";
    ctx.fillRect(barX, barY, barWidth, 16);

    ctx.fillStyle = hp > maxHp * 0.3 ? "#45ed75" : "#ff4545";
    ctx.fillRect(barX, barY, barWidth * Math.min(1, hp / maxHp), 16);

    ctx.fillStyle = "#eee";
    ctx.font = "bold 12px Arial";
    ctx.fillText("HP " + hp + "/" + maxHp, barX, barY + 33);

    if (gameStatus === "waiting") {
      centerMessage("WAITING FOR GAME");
    } else if (gameStatus === "gameover") {
      centerMessage("GAME OVER");
    } else if (gameStatus === "upgrades") {
      centerMessage("CHOOSE AN UPGRADE");
    } else if (game.zombies.length === 0 && game.status === "playing") {
      ctx.fillStyle = "#ccc";
      ctx.font = "13px monospace";
      ctx.fillText("NEXT WAVE…", W / 2 - 45, 28);
    }
  }

  function centerMessage(message) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px Arial";
    ctx.fillText(message, W / 2, H / 2 - 35);
  }

  function drawJoystick() {
    if (!joystick.active) return;

    ctx.globalAlpha = 0.6;

    ctx.beginPath();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.arc(joystick.x, joystick.y, 55, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = "#ddd";
    ctx.arc(
      joystick.x + joystick.dx * 45,
      joystick.y + joystick.dy * 45,
      18,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  function upgradeDetails(choice, me) {
    if (!choice || !me) return { current: "", result: "" };

    const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

    switch (choice.id) {
      case "damage": {
        const before = n(me.damage);
        return {
          current: `Damage: ${before}`,
          result: `After: ${before + 5} (+5)`
        };
      }

      case "speed": {
        const before = n(me.speed);
        const after = Math.min(7, before + 0.6);
        return {
          current: `Speed: ${before.toFixed(1)}`,
          result: `After: ${after.toFixed(1)} (+${(after - before).toFixed(1)})`
        };
      }

      case "health": {
        const beforeMax = n(me.maxHp) || 100;
        const beforeHp = n(me.hp);
        const afterMax = beforeMax + 25;
        const afterHp = Math.min(afterMax, beforeHp + 25);
        return {
          current: `Max HP: ${beforeMax} · HP: ${Math.ceil(beforeHp)}`,
          result: `After: Max ${afterMax} · HP ${Math.ceil(afterHp)}`
        };
      }

      case "rapid": {
        const before = n(me.fireDelay) || 18;
        const after = Math.max(5, before - 3);
        return {
          current: `Fire delay: ${before} ticks`,
          result: `After: ${after} ticks (-${before - after})`
        };
      }

      case "armor": {
        const before = n(me.armor);
        const after = Math.min(0.65, before + 0.15);
        return {
          current: `Damage reduction: ${Math.round(before * 100)}%`,
          result: `After: ${Math.round(after * 100)}% (+${Math.round((after - before) * 100)}%)`
        };
      }

      case "heal": {
        const hp = n(me.hp);
        const maxHp = n(me.maxHp) || 100;
        const after = Math.min(maxHp, hp + 40);
        return {
          current: `HP: ${Math.ceil(hp)} / ${maxHp}`,
          result: `After: ${Math.ceil(after)} / ${maxHp} (+${Math.ceil(after - hp)} HP)`
        };
      }

      default:
        return { current: "", result: "" };
    }
  }

  function drawUpgrades() {
    ctx.fillStyle = "rgba(0,0,0,0.88)";
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ff5151";
    ctx.font = "bold 28px Arial";
    ctx.fillText("WAVE BREAK", W / 2, 75);

    ctx.fillStyle = "#fff";
    ctx.font = "16px Arial";
    ctx.fillText("Choose one upgrade — see exactly what changes", W / 2, 105);

    const count = upgradeChoices.length;

    if (!count) {
      ctx.fillText("Waiting for upgrade choices…", W / 2, H / 2);
      return;
    }

    const me = getMyPlayer();
    const cardWidth = Math.min(220, (W - 60) / count);
    const cardHeight = 210;
    const gap = 14;
    const totalWidth = count * cardWidth + (count - 1) * gap;
    const startX = (W - totalWidth) / 2;
    const top = H / 2 - 85;

    upgradeChoices.forEach((choice, index) => {
      const x = startX + index * (cardWidth + gap);
      const details = upgradeDetails(choice, me);

      ctx.fillStyle = "#1e1e1e";
      ctx.fillRect(x, top, cardWidth, cardHeight);

      ctx.strokeStyle = "#a32c2c";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, top, cardWidth, cardHeight);

      ctx.fillStyle = "#ff7777";
      ctx.font = "bold 15px Arial";
      ctx.fillText(
        String(choice.name || choice.id || "UPGRADE").toUpperCase(),
        x + cardWidth / 2,
        top + 28,
        cardWidth - 12
      );

      ctx.fillStyle = "#ddd";
      ctx.font = "13px Arial";
      drawWrappedText(
        String(choice.description || "Improve your survivor."),
        x + cardWidth / 2,
        top + 54,
        cardWidth - 20,
        17
      );

      ctx.fillStyle = "#b9c7d8";
      ctx.font = "12px monospace";

      if (details.current) {
        ctx.fillText(
          details.current,
          x + cardWidth / 2,
          top + 119,
          cardWidth - 12
        );
      }

      ctx.fillStyle = "#65f09a";
      ctx.font = "bold 12px monospace";

      if (details.result) {
        ctx.fillText(
          details.result,
          x + cardWidth / 2,
          top + 143,
          cardWidth - 12
        );
      }

      ctx.fillStyle = "#aaa";
      ctx.font = "12px monospace";
      ctx.fillText(
        "PRESS " + (index + 1),
        x + cardWidth / 2,
        top + 188
      );
    });

    ctx.fillStyle = "#aaa";
    ctx.font = "12px Arial";
    ctx.fillText("Click a card or press 1, 2, or 3", W / 2, H - 20);
  }

  function drawWrappedText(text, x, y, maxWidth, lineHeight) {
    const words = text.split(/\s+/);
    let line = "";
    let lineY = y;

    for (const word of words) {
      const test = line ? line + " " + word : word;

      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, lineY, maxWidth);
        line = word;
        lineY += lineHeight;
      } else {
        line = test;
      }
    }

    if (line) ctx.fillText(line, x, lineY, maxWidth);
  }

  function draw() {
    if (!ctx || !canvas) return;

    drawGrid();
    game.bullets.forEach(drawBullet);
    game.zombies.forEach(drawZombie);

    const me = getMyPlayer();

    game.players.forEach((player) => {
      drawPlayer(player, !!me && player.id === me.id);
    });

    drawHud();
    drawJoystick();

    if (upgradeOpen || gameStatus === "upgrades") {
      drawUpgrades();
    }
  }

  function init() {
    makeMenu();
    connectSocket();
  }

  // Required by index.html after Discord authentication succeeds.
  window.initGameEngine = function () {
    if (!menu) init();
  };

  init();

  window.addEventListener("beforeunload", () => {
    if (socket) socket.disconnect();
  });
})();
