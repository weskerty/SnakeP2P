import { joinRoom, selfId } from 'https://esm.run/trystero@0.20.1'

const CFG     = { appId: 'snake-p2p-game-v1', relayRedundancy: 2 }
const ROOM    = 'snake-public-lobby-v1'
const COLS    = 30
const ROWS    = 30
const TICK_MS = 120
const HASH_IV = 30

let room, sendInput, getInput, sendInit, getInit, sendHash, getHash
let peerId, isHost, myIdx
let tick = 0, loopId = null, seed
let snakes, fruits, scores, nextDir

// voz
let localStream = null
let peerAudio   = null
let micMuted    = false
let peerMuted   = false

const $          = id => document.getElementById(id)
const lobby      = $('lobby')
const gScreen    = $('game-screen')
const gOver      = $('gameover')
const cv         = $('cv')
const ctx        = cv.getContext('2d')
const elSt       = $('status')
const elSrch     = $('searching')
const btnFind    = $('btn-find')
const btnRply    = $('btn-replay')
const elS1       = $('score-p1')
const elS2       = $('score-p2')
const elSync     = $('sync-status')
const elGoT      = $('go-title')
const elGoM      = $('go-msg')
const btnMuteSelf = $('btn-mute-self')
const btnMutePeer = $('btn-mute-peer')

// ── Microfono — pedir al cargar ─────
async function initMic() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    // silenciar hasta que empiece partida — no transmitir en lobby
    localStream.getAudioTracks().forEach(t => t.enabled = false)
  } catch(e) {
    // sin micro — voz deshabilitada silenciosamente
    localStream = null
  }
}

function startVoice() {
  if (!room) return
  micMuted  = false
  peerMuted = false
  btnMuteSelf.classList.remove('muted')
  btnMutePeer.classList.remove('muted')
  btnMuteSelf.textContent = '🎤'
  btnMutePeer.textContent = '🔊'

  if (localStream) {
    localStream.getAudioTracks().forEach(t => t.enabled = true)
    room.addStream(localStream)
  }

  room.onPeerStream((stream) => {
    if (peerAudio) { peerAudio.srcObject = null }
    peerAudio = new Audio()
    peerAudio.srcObject = stream
    peerAudio.autoplay  = true
    peerAudio.muted     = false
  })
}

function stopVoice() {
  if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = false)
  if (peerAudio)  { peerAudio.srcObject = null; peerAudio = null }
}

// ── Canvas sizing
let CELL = 18

function resizeCanvas() {
  const hud  = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hud-h'))  || 44
  const dpad = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--dpad-h')) || 160
  const avW  = window.innerWidth
  const avH  = window.innerHeight - hud - dpad - 2
  CELL = Math.floor(Math.min(avW / COLS, avH / ROWS))
  cv.width  = COLS * CELL
  cv.height = ROWS * CELL
}

resizeCanvas()
window.addEventListener('resize', () => { resizeCanvas(); if (snakes) render() })

// ── RNG determinista
const rng32  = s => () => {
  s = s + 0x6d2b79f5 | 0
  let t = Math.imul(s ^ s >>> 15, 1 | s)
  t ^= t + Math.imul(t ^ t >>> 7, 61 | t)
  return ((t ^ t >>> 14) >>> 0) / 4294967296
}
const rngInt = (r, n) => Math.floor(r() * n)

// ── Trystero─────
function joinLobby() {
  room = joinRoom(CFG, ROOM)

  const a0 = room.makeAction('input')
  const a1 = room.makeAction('init')
  const a2 = room.makeAction('hash')
  ;[sendInput, getInput] = a0
  ;[sendInit,  getInit]  = a1
  ;[sendHash,  getHash]  = a2

  getInit(({ seed: s, hostId }) => {
    if (peerId && peerId !== hostId) return
    if (!peerId) peerId = hostId
    isHost = false
    seed   = s
    startGame()
  })

  getInput(({ dir }) => {
    if (!snakes) return
    const ri = isHost ? 1 : 0
    if (!opp(dir, nextDir[ri])) nextDir[ri] = dir
  })

  getHash(({ h, t }) => {
    const ok = stateHash(t) === h
    elSync.textContent = ok ? '●' : '⚠'
    elSync.classList.toggle('desynced', !ok)
  })

  room.onPeerJoin(id => {
    if (peerId) return
    peerId = id
    elSt.textContent = 'Opponent found!'
    isHost = selfId < peerId
    myIdx  = isHost ? 0 : 1
    if (isHost) {
      seed = Math.random() * 0xFFFFFFFF | 0
      sendInit({ seed, hostId: selfId })
      startGame()
    }
  })

  room.onPeerLeave(id => {
    if (id !== peerId) return
    if (loopId) { clearInterval(loopId); loopId = null }
    stopVoice()
    showEnd(null, 'Opponent disconnected')
  })
}

// ── Game─────────
function startGame() {
  tick = 0
  const rng = rng32(seed)
  snakes = [
    { body: [{x:5,y:14},{x:4,y:14},{x:3,y:14}], alive: true },
    { body: [{x:24,y:15},{x:25,y:15},{x:26,y:15}], alive: true }
  ]
  nextDir = [{x:1,y:0},{x:-1,y:0}]
  scores  = [0,0]
  fruits  = []
  for (let i = 0; i < 3; i++) spawnFruit(rng)

  lobby.classList.add('hidden')
  gOver.classList.add('hidden')
  gScreen.classList.remove('hidden')
  resizeCanvas()
  startVoice()

  loopId = setInterval(() => gameTick(rng), TICK_MS)
}

function gameTick(rng) {
  for (let i = 0; i < 2; i++) {
    if (!snakes[i].alive) continue
    const s    = snakes[i]
    const head = { x: s.body[0].x + nextDir[i].x, y: s.body[0].y + nextDir[i].y }

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) { s.alive = false; continue }
    if (s.body.some(c => c.x === head.x && c.y === head.y))             { s.alive = false; continue }
    if (snakes[1-i].body.some(c => c.x === head.x && c.y === head.y))   { s.alive = false; continue }

    s.body.unshift(head)
    const fi = fruits.findIndex(f => f.x === head.x && f.y === head.y)
    if (fi !== -1) { scores[i]++; fruits.splice(fi, 1); spawnFruit(rng) }
    else s.body.pop()
  }

  tick++
  sendInput({ dir: nextDir[myIdx] })
  if (tick % HASH_IV === 0) sendHash({ h: stateHash(tick), t: tick })

  elS1.textContent = scores[myIdx]
  elS2.textContent = scores[1 - myIdx]
  render()

  if (!snakes[0].alive || !snakes[1].alive) {
    clearInterval(loopId); loopId = null
    const tie = !snakes[0].alive && !snakes[1].alive
    setTimeout(() => showEnd(tie ? null : snakes[myIdx].alive), 400)
  }
}

function spawnFruit(rng) {
  let p, t = 0
  do { p = { x: rngInt(rng, COLS), y: rngInt(rng, ROWS) }
  } while (++t < 20 && (
    snakes.some(s => s.body.some(c => c.x === p.x && c.y === p.y)) ||
    fruits.some(f => f.x === p.x && f.y === p.y)
  ))
  fruits.push(p)
}

const opp = (a, b) => a.x === -b.x && a.y === -b.y

function stateHash(t) {
  const d = JSON.stringify({ b: snakes.map(s => s.body), f: fruits, s: scores, t })
  let h = 0
  for (let i = 0; i < d.length; i++) h = Math.imul(31, h) + d.charCodeAt(i) | 0
  return h >>> 0
}

// ── Render───────
const COL = ['#00ffaa', '#ff2d6b']

function render() {
  ctx.fillStyle = '#070710'
  ctx.fillRect(0, 0, cv.width, cv.height)

  ctx.strokeStyle = '#0e0e1a'
  ctx.lineWidth   = .5
  for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x*CELL,0); ctx.lineTo(x*CELL,cv.height); ctx.stroke() }
  for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0,y*CELL); ctx.lineTo(cv.width,y*CELL); ctx.stroke() }

  ctx.fillStyle = '#ffd700'
  for (const f of fruits) {
    ctx.beginPath()
    ctx.arc(f.x*CELL + CELL/2, f.y*CELL + CELL/2, CELL/2 - 2, 0, Math.PI*2)
    ctx.fill()
  }

  for (let i = 0; i < 2; i++) {
    const s = snakes[i]
    for (let j = 0; j < s.body.length; j++) {
      const c   = s.body[j]
      const pad = j === 0 ? 1 : 3
      ctx.globalAlpha = j === 0 ? 1 : Math.max(0.15, 1 - j / s.body.length)
      ctx.fillStyle   = COL[i]
      ctx.fillRect(c.x*CELL + pad, c.y*CELL + pad, CELL - pad*2, CELL - pad*2)
    }
    ctx.globalAlpha = 1
    if (s.alive) {
      ctx.strokeStyle = COL[i]
      ctx.lineWidth   = 2
      ctx.shadowColor = COL[i]
      ctx.shadowBlur  = 10
      ctx.strokeRect(s.body[0].x*CELL + 1, s.body[0].y*CELL + 1, CELL - 2, CELL - 2)
      ctx.shadowBlur  = 0
    }
  }
}

// ── UI───────────
function showEnd(won, msg) {
  stopVoice()
  gScreen.classList.add('hidden')
  gOver.classList.remove('hidden')
  gOver.classList.remove('win')

  if (msg)            elGoT.textContent = msg
  else if (won === null) elGoT.textContent = 'DRAW'
  else if (won)       { elGoT.textContent = 'YOU WIN';  gOver.classList.add('win') }
  else                  elGoT.textContent = 'YOU LOSE'

  elGoM.textContent = `Score: ${scores?.[myIdx] ?? 0}`
}

function resetToLobby() {
  if (loopId) { clearInterval(loopId); loopId = null }
  stopVoice()
  try { room?.leave() } catch(e) {}
  room = null; peerId = null; snakes = null
  gOver.classList.add('hidden')
  elSrch.classList.add('hidden')
  lobby.classList.remove('hidden')
  elSt.textContent = 'Press Find Match'
  btnFind.disabled = false
}

// ── Botones voz──
btnMuteSelf.addEventListener('click', () => {
  if (!localStream) return
  micMuted = !micMuted
  localStream.getAudioTracks().forEach(t => t.enabled = !micMuted)
  btnMuteSelf.classList.toggle('muted', micMuted)
  btnMuteSelf.textContent = micMuted ? '🔇' : '🎤'
})

btnMutePeer.addEventListener('click', () => {
  peerMuted = !peerMuted
  if (peerAudio) peerAudio.muted = peerMuted
  btnMutePeer.classList.toggle('muted', peerMuted)
  btnMutePeer.textContent = peerMuted ? '🔈' : '🔊'
})

// ── Input teclado
const DIRS = {
  ArrowUp:{x:0,y:-1}, ArrowDown:{x:0,y:1},
  ArrowLeft:{x:-1,y:0}, ArrowRight:{x:1,y:0},
  w:{x:0,y:-1}, s:{x:0,y:1}, a:{x:-1,y:0}, d:{x:1,y:0}
}

document.addEventListener('keydown', e => {
  if (!snakes || myIdx === undefined) return
  const d = DIRS[e.key]
  if (!d) return
  if (!opp(d, nextDir[myIdx])) nextDir[myIdx] = d
  e.preventDefault()
})

// ── Botones tactiles
const DMAP = { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} }

document.querySelectorAll('.dp').forEach(btn => {
  const fire = () => {
    if (!snakes || myIdx === undefined) return
    const d = DMAP[btn.dataset.dir]
    if (d && !opp(d, nextDir[myIdx])) nextDir[myIdx] = d
  }
  btn.addEventListener('touchstart', e => { e.preventDefault(); fire() }, { passive: false })
  btn.addEventListener('mousedown', fire)
})

// ── Botones UI───
btnFind.addEventListener('click', () => {
  btnFind.disabled = true
  elSrch.classList.remove('hidden')
  elSt.textContent = 'Searching...'
  joinLobby()
})

btnRply.addEventListener('click', resetToLobby)

// ── Boot─────────
initMic()
elSt.textContent = 'Press Find Match'
btnFind.disabled = false
