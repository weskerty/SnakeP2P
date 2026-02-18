import { joinRoom } from 'https://esm.run/trystero/torrent'

// ── Config ──────────────────────────────────────────────────────────────────
const CFG      = { appId: 'snake-p2p-game-v1' }
const LOBBY    = 'snake-public-lobby-v1'
const COLS     = 30
const ROWS     = 30
const CELL     = 18
const TICK_MS  = 120
const HASH_INT = 30  // ticks entre hash check

// ── State ────────────────────────────────────────────────────────────────────
let room, sendInput, getInput, sendInit, getInit, sendHash, getHash
let myId, peerId, isHost
let tick = 0, gameLoop = null
let seed, rngState
let snakes, fruits, scores, nextDir

// ── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id)
const lobby      = $('lobby')
const gameScreen = $('game-screen')
const gameOver   = $('gameover')
const cv         = $('cv')
const ctx        = cv.getContext('2d')
const elStatus   = $('status')
const elSearching = $('searching')
const btnFind    = $('btn-find')
const btnReplay  = $('btn-replay')
const elS1       = $('score-p1')
const elS2       = $('score-p2')
const elSync     = $('sync-status')
const elGoTitle  = $('go-title')
const elGoMsg    = $('go-msg')

cv.width  = COLS * CELL
cv.height = ROWS * CELL

// ── RNG determinista (mulberry32) ────────────────────────────────────────────
const mkRng = s => () => {
  s += 0x6d2b79f5
  let t = Math.imul(s ^ s >>> 15, 1 | s)
  t ^= t + Math.imul(t ^ t >>> 7, 61 | t)
  return ((t ^ t >>> 14) >>> 0) / 4294967296
}

const rngInt = (rng, max) => Math.floor(rng() * max)

// ── Lobby / Trystero ─────────────────────────────────────────────────────────
async function connectLobby() {
  elStatus.textContent = 'Joining network...'
  room = joinRoom(CFG, LOBBY)
  myId = Math.random().toString(36).slice(2, 8)

  setupActions()

  room.onPeerJoin(id => {
    if (peerId) return  // ya tenemos oponente
    peerId = id
    elStatus.textContent = 'Opponent found! Starting...'

    // el peer con id menor es host
    isHost = myId < peerId

    if (isHost) {
      seed = Math.floor(Math.random() * 0xFFFFFFFF)
      sendInit({ seed, hostId: myId })
      startGame()
    }
  })

  room.onPeerLeave(id => {
    if (id === peerId && gameLoop) endGame(false, 'Opponent disconnected')
  })

  elStatus.textContent = 'Network ready'
  btnFind.disabled = false
}

function setupActions() {
  ;[sendInput, getInput] = room.makeAction('input')
  ;[sendInit,  getInit]  = room.makeAction('init')
  ;[sendHash,  getHash]  = room.makeAction('hash')

  getInit(({ seed: s, hostId }) => {
    if (peerId && peerId !== hostId) return
    if (!peerId) peerId = hostId
    isHost = false
    seed = s
    startGame()
  })

  getInput(({ dir }, id) => {
    if (id !== peerId) return
    // peer mueve su serpiente (idx 1 desde perspectiva del host)
    const pi = isHost ? 1 : 0
    const cur = nextDir[pi]
    if (!opposite(dir, cur)) nextDir[pi] = dir
  })

  getHash(({ h, t }, id) => {
    if (id !== peerId) return
    const mine = stateHash(t)
    if (mine !== h) {
      elSync.textContent = '⚠'
      elSync.classList.add('desynced')
    } else {
      elSync.textContent = '●'
      elSync.classList.remove('desynced')
    }
  })
}

// ── Game init ────────────────────────────────────────────────────────────────
function startGame() {
  room.leaveRoom?.()  // salir lobby para no agarrar mas peers (opcional, trystero no lo expone directo)

  tick = 0
  rngState = seed
  const rng = mkRng(rngState)

  // host = serpiente 0 (verde, izq), guest = serpiente 1 (roja, der)
  snakes = [
    { body: [{x:5, y:14}, {x:4,y:14}, {x:3,y:14}], alive: true },
    { body: [{x:24,y:15}, {x:25,y:15}, {x:26,y:15}], alive: true }
  ]
  nextDir = [ {x:1,y:0}, {x:-1,y:0} ]
  scores  = [0, 0]
  fruits  = []

  // frutas iniciales
  const rng2 = mkRng(seed)
  for (let i = 0; i < 3; i++) spawnFruit(rng2)

  // guardar rng consistente
  rngState = rng2  // referencia — usamos closure

  lobby.classList.add('hidden')
  gameOver.classList.add('hidden')
  gameScreen.classList.remove('hidden')

  gameLoop = setInterval(gameTick, TICK_MS)
}

// ── Tick ─────────────────────────────────────────────────────────────────────
function gameTick() {
  const rng = mkRng(seed + tick * 1337)  // rng determinista por tick para frutas

  // mover ambas serpientes
  for (let i = 0; i < 2; i++) {
    if (!snakes[i].alive) continue
    const s = snakes[i]
    const head = { x: s.body[0].x + nextDir[i].x, y: s.body[0].y + nextDir[i].y }

    // choque pared
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      s.alive = false; continue
    }

    // choque consigo mismo
    if (s.body.some(c => c.x === head.x && c.y === head.y)) {
      s.alive = false; continue
    }

    // choque con rival
    const rival = snakes[1 - i]
    if (rival.body.some(c => c.x === head.x && c.y === head.y)) {
      s.alive = false; continue
    }

    s.body.unshift(head)

    // comer fruta
    const fi = fruits.findIndex(f => f.x === head.x && f.y === head.y)
    if (fi !== -1) {
      scores[i]++
      fruits.splice(fi, 1)
      spawnFruit(rng)
    } else {
      s.body.pop()
    }
  }

  tick++

  // enviar input propio
  const myIdx = isHost ? 0 : 1
  sendInput({ dir: nextDir[myIdx] })

  // hash check periodico
  if (tick % HASH_INT === 0) {
    sendHash({ h: stateHash(tick), t: tick })
  }

  // actualizar HUD
  const [s0, s1] = isHost ? scores : [scores[1], scores[0]]
  elS1.textContent = s0
  elS2.textContent = s1

  render()

  // fin de partida
  if (!snakes[0].alive || !snakes[1].alive) {
    clearInterval(gameLoop)
    gameLoop = null

    const myIdx2 = isHost ? 0 : 1
    const iWon = snakes[myIdx2].alive || (!snakes[0].alive && !snakes[1].alive ? false : snakes[myIdx2].alive)
    const tie   = !snakes[0].alive && !snakes[1].alive

    setTimeout(() => showGameOver(tie ? null : iWon), 500)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function spawnFruit(rng) {
  let pos, tries = 0
  do {
    pos = { x: rngInt(rng, COLS), y: rngInt(rng, ROWS) }
    tries++
  } while (tries < 20 && (
    snakes.some(s => s.body.some(c => c.x === pos.x && c.y === pos.y)) ||
    fruits.some(f => f.x === pos.x && f.y === pos.y)
  ))
  fruits.push(pos)
}

function opposite(a, b) {
  return a.x === -b.x && a.y === -b.y
}

function stateHash(t) {
  // hash simple del estado del juego
  const data = JSON.stringify({ snakes: snakes.map(s => s.body), fruits, scores, t })
  let h = 0
  for (let i = 0; i < data.length; i++) {
    h = Math.imul(31, h) + data.charCodeAt(i) | 0
  }
  return h >>> 0
}

// ── Render ───────────────────────────────────────────────────────────────────
const COLORS = ['#00ff88', '#ff3366']

function render() {
  ctx.fillStyle = '#0a0a0f'
  ctx.fillRect(0, 0, cv.width, cv.height)

  // grid sutil
  ctx.strokeStyle = '#12121a'
  ctx.lineWidth = .5
  for (let x = 0; x < COLS; x++) {
    ctx.beginPath(); ctx.moveTo(x*CELL,0); ctx.lineTo(x*CELL,cv.height); ctx.stroke()
  }
  for (let y = 0; y < ROWS; y++) {
    ctx.beginPath(); ctx.moveTo(0,y*CELL); ctx.lineTo(cv.width,y*CELL); ctx.stroke()
  }

  // frutas
  ctx.fillStyle = '#ffcc00'
  for (const f of fruits) {
    ctx.beginPath()
    ctx.arc(f.x*CELL + CELL/2, f.y*CELL + CELL/2, CELL/2 - 2, 0, Math.PI*2)
    ctx.fill()
  }

  // serpientes
  for (let i = 0; i < 2; i++) {
    const s = snakes[i]
    const col = COLORS[i]
    ctx.fillStyle = col
    for (let j = 0; j < s.body.length; j++) {
      const c = s.body[j]
      const alpha = j === 0 ? 1 : 0.5 + 0.5 * (1 - j / s.body.length)
      ctx.globalAlpha = alpha
      const pad = j === 0 ? 1 : 3
      ctx.fillRect(c.x*CELL+pad, c.y*CELL+pad, CELL-pad*2, CELL-pad*2)
    }
    ctx.globalAlpha = 1

    // cabeza con borde brillante
    if (s.alive) {
      ctx.strokeStyle = col
      ctx.lineWidth = 2
      ctx.shadowColor = col
      ctx.shadowBlur = 8
      ctx.strokeRect(s.body[0].x*CELL+1, s.body[0].y*CELL+1, CELL-2, CELL-2)
      ctx.shadowBlur = 0
    }
  }
}

// ── UI ───────────────────────────────────────────────────────────────────────
function showGameOver(won) {
  gameScreen.classList.add('hidden')
  gameOver.classList.remove('hidden')

  if (won === null) {
    elGoTitle.textContent = 'DRAW'
    gameOver.classList.remove('win')
  } else if (won) {
    elGoTitle.textContent = 'YOU WIN'
    gameOver.classList.add('win')
  } else {
    elGoTitle.textContent = 'YOU LOSE'
    gameOver.classList.remove('win')
  }

  elGoMsg.textContent = `Score: ${isHost ? scores[0] : scores[1]}`
}

function resetToLobby() {
  peerId = null
  snakes = null
  if (gameLoop) { clearInterval(gameLoop); gameLoop = null }
  gameOver.classList.add('hidden')
  elSearching.classList.add('hidden')
  lobby.classList.remove('hidden')
  elStatus.textContent = 'Network ready'
  btnFind.disabled = false
  connectLobby()
}

// ── Input teclado ─────────────────────────────────────────────────────────────
const DIRS = {
  ArrowUp:    {x:0,  y:-1},
  ArrowDown:  {x:0,  y:1},
  ArrowLeft:  {x:-1, y:0},
  ArrowRight: {x:1,  y:0},
  w: {x:0,y:-1}, s: {x:0,y:1}, a: {x:-1,y:0}, d: {x:1,y:0}
}

document.addEventListener('keydown', e => {
  if (!snakes) return
  const d = DIRS[e.key]
  if (!d) return
  const myIdx = isHost ? 0 : 1
  if (!opposite(d, nextDir[myIdx])) nextDir[myIdx] = d
  e.preventDefault()
})

// ── Botones ──────────────────────────────────────────────────────────────────
btnFind.addEventListener('click', () => {
  btnFind.disabled = true
  elSearching.classList.remove('hidden')
  elStatus.textContent = 'Searching...'
})

btnReplay.addEventListener('click', resetToLobby)

// ── Boot ──────────────────────────────────────────────────────────────────────
connectLobby()
