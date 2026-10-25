
require('dotenv').config();

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e5,
  serveClient: true
});

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const MAX_PLAYERS = 4;
const rooms = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', multiplayer: true });
});

// Preserve Discord OAuth.
app.post('/api/token', async (req, res) => {
  try {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return res.status(500).json({
        error: 'server_configuration_error'
      });
    }

    const code = req.body?.code;
    if (typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code.trim()
    });

    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const data = await response.json();

    if (!response.ok || !data.access_token) {
      console.error('Discord OAuth exchange failed:', response.status);
      return res.status(502).json({ error: 'discord_auth_failed' });
    }

    res.json({ access_token: data.access_token });
  } catch (error) {
    console.error('Token exchange error:', error.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

function validRoomId(value) {
  return typeof value === 'string' &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

const upgradePool = [
  { id: 'damage', name: 'Heavy Bullets', description: '+5 bullet damage' },
  { id: 'speed', name: 'Quick Feet', description: '+0.6 movement speed' },
  { id: 'health', name: 'Extra Vitality', description: '+25 maximum health and heal 25' },
  { id: 'rapid', name: 'Rapid Fire', description: 'Shoot more frequently' },
  { id: 'armor', name: 'Tough Skin', description: 'Take less zombie damage' },
  { id: 'heal', name: 'Field Medic', description: 'Restore 40 health' }
];

function makePlayer(id, index) {
  return {
    id,
    x: 300 + index * 60,
    y: 300,
    hp: 100,
    maxHp: 100,
    speed: 4,
    coins: 0,
    damage: 10,
    fireDelay: 18,
    armor: 0,
    upgrades: [],
    input: { x: 0, y: 0 },
    cooldown: 0,
    alive: true,
    choices: []
  };
}

function makeRoom(id) {
  return {
    id,
    players: new Map(),
    zombies: [],
    bullets: [],
    wave: 1,
    kills: 0,
    totalToSpawn: 8,
    spawned: 0,
    spawnCooldown: 0,
    nextZombieId: 1,
    nextBulletId: 1,
    status: 'playing',
    upgradeTimer: 0
  };
}

function publicState(room) {
  return {
    roomId: room.id,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      hp: p.hp,
      maxHp: p.maxHp,
      coins: p.coins,
      alive: p.alive,
      speed: p.speed,
      damage: p.damage,
      fireDelay: p.fireDelay,
      armor: p.armor,
      upgrades: p.upgrades,
      choices: p.choices
    })),
    zombies: room.zombies,
    bullets: room.bullets,
    wave: room.wave,
    kills: room.kills,
    totalToSpawn: room.totalToSpawn,
    spawned: room.spawned,
    status: room.status,
    playerCount: room.players.size,
    maxPlayers: MAX_PLAYERS
  };
}

function broadcast(room) {
  io.to(room.id).emit('game:state', publicState(room));
}

function leaveRoom(socket) {
  for (const room of rooms.values()) {
    if (!room.players.has(socket.id)) continue;

    room.players.delete(socket.id);
    socket.leave(room.id);

    if (room.players.size === 0) {
      rooms.delete(room.id);
    } else {
      broadcast(room);
    }
  }
}

function spawnZombie(room) {
  const edge = Math.floor(Math.random() * 4);
  let x, y;

  if (edge === 0) {
    x = Math.random() * 800;
    y = -15;
  } else if (edge === 1) {
    x = 815;
    y = Math.random() * 600;
  } else if (edge === 2) {
    x = Math.random() * 800;
    y = 615;
  } else {
    x = -15;
    y = Math.random() * 600;
  }

  room.zombies.push({
    id: room.nextZombieId++,
    x,
    y,
    hp: 20 + room.wave * 5,
    speed: 0.7 + Math.random() * 0.35
  });

  room.spawned++;
}

function beginUpgradeBreak(room) {
  room.status = 'upgrades';
  room.upgradeTimer = 900; // 30 ticks/second = 30 seconds

  for (const player of room.players.values()) {
    player.choices = [...upgradePool]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
  }

  io.to(room.id).emit('game:upgrade-break', {
    wave: room.wave,
    durationSeconds: 30
  });
}

function applyUpgrade(player, id) {
  switch (id) {
    case 'damage':
      player.damage += 5;
      break;

    case 'speed':
      player.speed = Math.min(7, player.speed + 0.6);
      break;

    case 'health':
      player.maxHp += 25;
      player.hp = Math.min(player.maxHp, player.hp + 25);
      break;

    case 'rapid':
      player.fireDelay = Math.max(5, player.fireDelay - 3);
      break;

    case 'armor':
      player.armor = Math.min(0.65, player.armor + 0.15);
      break;

    case 'heal':
      player.hp = Math.min(player.maxHp, player.hp + 40);
      break;

    default:
      return false;
  }

  player.upgrades.push(id);
  player.choices = [];
  return true;
}

io.on('connection', socket => {
  console.log('Client connected:', socket.id);

  socket.on('room:join', (payload, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    const roomId = payload?.roomId;

    if (!validRoomId(roomId)) {
      return reply({ ok: false, error: 'Invalid room ID.' });
    }

    leaveRoom(socket);

    let room = rooms.get(roomId);
    if (!room) {
      room = makeRoom(roomId);
      rooms.set(roomId, room);
    }

    if (room.players.size >= MAX_PLAYERS) {
      return reply({ ok: false, error: 'Room is full (4 players maximum).' });
    }

    if (room.status === 'gameover') {
      return reply({
        ok: false,
        error: 'This game has ended. Create a new room.'
      });
    }

    const player = makePlayer(socket.id, room.players.size);
    room.players.set(socket.id, player);
    socket.join(roomId);

    reply({
      ok: true,
      playerId: socket.id,
      room: publicState(room)
    });

    broadcast(room);
    console.log(`Player joined ${roomId}: ${room.players.size}/${MAX_PLAYERS}`);
  });

  socket.on('player:input', payload => {
    for (const room of rooms.values()) {
      const player = room.players.get(socket.id);
      if (!player) continue;

      const x = Number(payload?.x);
      const y = Number(payload?.y);

      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const length = Math.hypot(x, y) || 1;
      player.input.x = Math.max(-1, Math.min(1, x / Math.max(1, length)));
      player.input.y = Math.max(-1, Math.min(1, y / Math.max(1, length)));
      break;
    }
  });

  socket.on('player:shoot', payload => {
    for (const room of rooms.values()) {
      const player = room.players.get(socket.id);
      if (!player || !player.alive || room.status !== 'playing') continue;
      if (player.cooldown > 0) return;

      const dx = Number(payload?.dx);
      const dy = Number(payload?.dy);

      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;

      const length = Math.hypot(dx, dy);
      if (length < 0.01) return;

      room.bullets.push({
        id: room.nextBulletId++,
        ownerId: player.id,
        x: player.x,
        y: player.y,
        vx: dx / length * 8,
        vy: dy / length * 8,
        damage: player.damage
      });

      player.cooldown = player.fireDelay;
      break;
    }
  });

  socket.on('player:upgrade', payload => {
    for (const room of rooms.values()) {
      const player = room.players.get(socket.id);
      if (!player || room.status !== 'upgrades') return;
      if (!player.choices.some(choice => choice.id === payload?.id)) return;

      if (!applyUpgrade(player, payload.id)) return;

      const everyoneChosen = [...room.players.values()]
        .every(p => p.choices.length === 0);

      if (everyoneChosen) {
        room.wave++;
        room.kills = 0;
        room.spawned = 0;
        room.totalToSpawn = 8 + room.wave * 3;
        room.zombies = [];
        room.bullets = [];
        room.status = 'playing';
      }

      broadcast(room);
      break;
    }
  });

  socket.on('room:leave', () => leaveRoom(socket));

  socket.on('disconnect', () => {
    leaveRoom(socket);
    console.log('Client disconnected:', socket.id);
  });
});

// Shared simulation for every room.
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status === 'playing') {
      const livingPlayers = [...room.players.values()].filter(p => p.alive);

      if (livingPlayers.length === 0) {
        room.status = 'gameover';
        broadcast(room);
        continue;
      }

      for (const player of livingPlayers) {
        player.x = Math.max(
          15,
          Math.min(785, player.x + player.input.x * player.speed)
        );

        player.y = Math.max(
          15,
          Math.min(585, player.y + player.input.y * player.speed)
        );

        if (player.cooldown > 0) player.cooldown--;
      }

      if (room.spawned < room.totalToSpawn) {
        room.spawnCooldown--;

        if (room.spawnCooldown <= 0) {
          spawnZombie(room);
          room.spawnCooldown = Math.max(12, 45 - room.wave);
        }
      }

      for (const zombie of room.zombies) {
        const target = livingPlayers.reduce((best, p) => {
          const d = Math.hypot(p.x - zombie.x, p.y - zombie.y);
          return !best || d < best.d ? { player: p, d } : best;
        }, null);

        if (!target) continue;

        const dx = target.player.x - zombie.x;
        const dy = target.player.y - zombie.y;
        const d = Math.hypot(dx, dy) || 1;

        if (d > 22) {
          zombie.x += dx / d * zombie.speed;
          zombie.y += dy / d * zombie.speed;
        } else {
          target.player.hp -= 0.25 * (1 - target.player.armor);

          if (target.player.hp <= 0) {
            target.player.hp = 0;
            target.player.alive = false;
          }
        }
      }

      for (let i = room.bullets.length - 1; i >= 0; i--) {
        const bullet = room.bullets[i];
        bullet.x += bullet.vx;
        bullet.y += bullet.vy;

        if (
          bullet.x < 0 || bullet.x > 800 ||
          bullet.y < 0 || bullet.y > 600
        ) {
          room.bullets.splice(i, 1);
          continue;
        }

        const zombie = room.zombies.find(z =>
          Math.hypot(z.x - bullet.x, z.y - bullet.y) < 16
        );

        if (zombie) {
          zombie.hp -= bullet.damage;
          room.bullets.splice(i, 1);

          if (zombie.hp <= 0) {
            room.zombies = room.zombies.filter(z => z.id !== zombie.id);
            room.kills++;

            const owner = room.players.get(bullet.ownerId);
            if (owner) owner.coins += 5;
          }
        }
      }

      if (
        room.spawned >= room.totalToSpawn &&
        room.zombies.length === 0
      ) {
        beginUpgradeBreak(room);
      }
    } else if (room.status === 'upgrades') {
      room.upgradeTimer--;

      if (room.upgradeTimer <= 0) {
        // Players who didn't choose keep their current build.
        for (const player of room.players.values()) {
          player.choices = [];
        }

        room.wave++;
        room.kills = 0;
        room.spawned = 0;
        room.totalToSpawn = 8 + room.wave * 3;
        room.zombies = [];
        room.bullets = [];
        room.status = 'playing';
      }
    }

    broadcast(room);
  }
}, 1000 / 30);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DEADZONE server listening on port ${PORT}`);
});
