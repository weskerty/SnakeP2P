import{joinRoom,selfId}from'https://esm.run/trystero@0.22.0'

const T_FB={findMatch:'FIND MATCH',searching:'Searching...',found:'Rival found!',
  disconnected:'Rival disconnected',pressFind:'Press Find Match',youWin:'YOU WIN',
  youLose:'YOU LOSE',draw:'DRAW',score:'Score',you:'YOU',rival:'RIVAL',
  muteMe:'Mute mic',mutePeer:'Mute rival',newMatch:'NEW MATCH',
  hacked:'Hack detected — match cancelled'}
let T=T_FB
try{
  const lang=navigator.language?.toLowerCase().startsWith('es')?'es':'en'
  const r=await fetch(lang+'.json')
  if(r.ok)T=await r.json()
}catch(e){}

const CFG={appId:'snake-p2p-v3'}
const LOBBY='snake-lobby-v3'
const COLS=30,ROWS=30,TICK_MS=120,HASH_IV=20,START_DELAY=4500

const $=id=>document.getElementById(id)
const elLobby=$('lobby'),elGame=$('game-screen'),elOver=$('gameover')
const cv=$('cv'),ctx=cv.getContext('2d')
const elSt=$('status'),elSrch=$('searching'),btnFind=$('btn-find'),btnRply=$('btn-replay')
const elS1=$('score-p1'),elS2=$('score-p2'),elSync=$('sync-status')
const elGoT=$('go-title'),elGoM=$('go-msg')
const btnMS=$('btn-mute-self'),btnMP=$('btn-mute-peer')
const elLog=$('conn-log')

btnFind.textContent=T.findMatch
$('txt-searching').textContent=T.searching
$('lbl-you').textContent=T.you
$('lbl-rival').textContent=T.rival
btnRply.textContent=T.newMatch
btnMS.title=T.muteMe
btnMP.title=T.mutePeer
elSt.textContent=T.pressFind

function log(msg){
  if(!elLog)return
  const d=document.createElement('div')
  d.textContent='> '+msg
  elLog.appendChild(d)
  elLog.scrollTop=elLog.scrollHeight
}

let CELL=18
function resizeCanvas(){
  const hud=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hud-h'))||44
  const dpad=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--dpad-h'))||160
  CELL=Math.floor(Math.min(window.innerWidth/COLS,(window.innerHeight-hud-dpad-2)/ROWS))
  cv.width=COLS*CELL;cv.height=ROWS*CELL
}
resizeCanvas()
window.addEventListener('resize',()=>{resizeCanvas();if(snakes)render()})

const rng32=s=>()=>{
  s=s+0x6d2b79f5|0
  let t=Math.imul(s^s>>>15,1|s)
  t^=t+Math.imul(t^t>>>7,61|t)
  return((t^t>>>14)>>>0)/4294967296
}
const rngInt=(r,n)=>Math.floor(r()*n)
const opp=(a,b)=>a.x===-b.x&&a.y===-b.y

let room=null
let sendInv,getInv,sendAcc,getAcc,sendInit,getInit
let sendInput,getInput,sendHash,getHash

let lobbyPeers=[]
let matchPeer=null
let isHost=false
let myIdx=0
let loopId=null

let tick=0,seed=0
let snakes=null,fruits=null,scores=null,nextDir=null
let shadowSnakes=null,shadowFruits=null,shadowScores=null,shadowNextDir=null,shadowRng=null
let lastSentDir=null

let ls=null,ra=null,mm=false,pm=false

async function initMic(){
  try{
    const s=await navigator.mediaDevices.getUserMedia({audio:1})
    s.getTracks().forEach(t=>t.stop())
    ls=1
  }catch(e){ls=null}
}

async function startVoice(){
  if(!room||ls===null)return
  mm=pm=false
  btnMS.classList.remove('muted');btnMP.classList.remove('muted')
  btnMS.textContent='🫵🎤';btnMP.textContent='🔊👆'
  if(ls===1){
    try{ls=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:1,noiseSuppression:1,autoGainControl:1},video:0})}
    catch(e){ls=null;return}
  }
  room.addStream(ls)
  room.onPeerJoin(id=>{if(id===matchPeer)room.addStream(ls,id)})
  room.onPeerStream((s,id)=>{
    if(id!==matchPeer)return
    if(ra){ra.pause();ra.srcObject=null;ra.remove()}
    ra=document.createElement('audio')
    ra.srcObject=s;ra.autoplay=1;ra.playsInline=1;ra.volume=.6;ra.muted=pm
    document.body.appendChild(ra)
  })
}

function stopVoice(){
  if(ls&&ls!==1){ls.getTracks().forEach(t=>t.stop());ls=1}
  if(ra){ra.pause();ra.srcObject=null;ra.remove();ra=null}
}

btnMS.onclick=()=>{
  if(!ls||ls===1)return
  mm=!mm
  ls.getAudioTracks().forEach(t=>t.enabled=!mm)
  btnMS.classList.toggle('muted',mm)
  btnMS.textContent=mm?'🤫':'🎤'
}
btnMP.onclick=()=>{
  pm=!pm
  if(ra)ra.muted=pm
  btnMP.classList.toggle('muted',pm)
  btnMP.textContent=pm?'🔇':'🔊'
}

function tryInvite(){
  if(matchPeer)return
  const target=lobbyPeers.filter(id=>selfId<id)[0]
  if(!target)return
  matchPeer=target
  isHost=true;myIdx=0
  log('Inviting '+target.slice(0,6))
  sendInv({from:selfId},[target])
}

function joinLobby(){
  room=joinRoom(CFG,LOBBY)
  log('Lobby — me: '+selfId.slice(0,6))

  ;[sendInv,getInv]=room.makeAction('inv')
  ;[sendAcc,getAcc]=room.makeAction('acc')
  ;[sendInit,getInit]=room.makeAction('ini')
  ;[sendInput,getInput]=room.makeAction('inp')
  ;[sendHash,getHash]=room.makeAction('hsh')

  getInv((d,from)=>{
    if(matchPeer)return
    matchPeer=from;isHost=false;myIdx=1
    log('Invited by '+from.slice(0,6))
    elSt.textContent=T.found
    sendAcc({ok:1},[from])
  })

  getAcc((d,from)=>{
    if(!matchPeer||from!==matchPeer||!isHost)return
    log(from.slice(0,6)+' accepted')
    elSt.textContent=T.found
    seed=Math.random()*0xFFFFFFFF|0
    const ts=Date.now()+START_DELAY
    sendInit({seed,hostId:selfId,ts},[from])
    scheduleStart(ts)
  })

  getInit(({seed:s,hostId,ts},from)=>{
    if(matchPeer&&matchPeer!==from)return
    if(!matchPeer){matchPeer=from;isHost=false;myIdx=1}
    if(isHost)return
    seed=s
    log('Init rx — delta '+(ts-Date.now())+'ms')
    scheduleStart(ts)
  })

  getInput(({dir},from)=>{
    if(from!==matchPeer||!snakes)return
    const ri=isHost?1:0
    if(!opp(dir,nextDir[ri]))nextDir[ri]=dir
    if(shadowNextDir&&!opp(dir,shadowNextDir[myIdx]))shadowNextDir[myIdx]=dir
  })

  getHash(({selfH,peerH,t},from)=>{
    if(from!==matchPeer||!snakes)return
    const mySelfH=calcHash(snakes,fruits,scores,t)
    const myShadowH=calcHash(shadowSnakes,shadowFruits,shadowScores,t)
    const ok=mySelfH===peerH&&myShadowH===selfH
    elSync.textContent=ok?'●':'⚠'
    elSync.classList.toggle('desynced',!ok)
    if(!ok){
      log('HACK DETECTED at tick '+t)
      endGame(null,T.hacked)
    }
  })

  room.onPeerJoin(id=>{
    if(id===selfId)return
    if(!lobbyPeers.includes(id))lobbyPeers.push(id)
    log('Joined: '+id.slice(0,6)+' ('+lobbyPeers.length+')')
    tryInvite()
  })

  room.onPeerLeave(id=>{
    lobbyPeers=lobbyPeers.filter(p=>p!==id)
    log('Left: '+id.slice(0,6)+' ('+lobbyPeers.length+')')
    if(id!==matchPeer)return
    if(loopId){clearInterval(loopId);loopId=null}
    stopVoice()
    matchPeer=null
    if(snakes)showEnd(null,T.disconnected)
    else tryInvite()
  })
}

function scheduleStart(ts){
  tick=0
  const rng=rng32(seed)
  snakes=[
    {body:[{x:5,y:14},{x:4,y:14},{x:3,y:14}],alive:true},
    {body:[{x:24,y:15},{x:25,y:15},{x:26,y:15}],alive:true}
  ]
  nextDir=[{x:1,y:0},{x:-1,y:0}]
  scores=[0,0];fruits=[]
  for(let i=0;i<3;i++)spawnFruit(rng)

  const srng=rng32(seed)
  shadowSnakes=[
    {body:[{x:5,y:14},{x:4,y:14},{x:3,y:14}],alive:true},
    {body:[{x:24,y:15},{x:25,y:15},{x:26,y:15}],alive:true}
  ]
  shadowNextDir=[{x:1,y:0},{x:-1,y:0}]
  shadowScores=[0,0];shadowFruits=[]
  shadowRng=srng
  for(let i=0;i<3;i++)spawnFruitShadow()

  lastSentDir=null

  elLobby.classList.add('hidden')
  elOver.classList.add('hidden')
  elGame.classList.remove('hidden')
  resizeCanvas()
  startVoice()

  const delay=ts-Date.now()
  let cdVal=Math.ceil(delay/1000)
  render();drawCountdown(cdVal)

  const cdId=setInterval(()=>{
    const rem=ts-Date.now()
    cdVal=Math.ceil(rem/1000)
    render()
    if(rem>0){drawCountdown(cdVal);return}
    clearInterval(cdId)
    loopId=setInterval(()=>gameTick(rng),TICK_MS)
  },250)
}

function gameTick(rng){
  for(let i=0;i<2;i++){
    if(!snakes[i].alive)continue
    const s=snakes[i]
    const head={x:s.body[0].x+nextDir[i].x,y:s.body[0].y+nextDir[i].y}
    if(head.x<0||head.x>=COLS||head.y<0||head.y>=ROWS){s.alive=false;continue}
    if(s.body.some(c=>c.x===head.x&&c.y===head.y)){s.alive=false;continue}
    if(snakes[1-i].body.some(c=>c.x===head.x&&c.y===head.y)){s.alive=false;continue}
    s.body.unshift(head)
    const fi=fruits.findIndex(f=>f.x===head.x&&f.y===head.y)
    if(fi!==-1){scores[i]++;fruits.splice(fi,1);spawnFruit(rng)}
    else s.body.pop()
  }

  shadowTick()

  tick++

  const curDir=nextDir[myIdx]
  if(!lastSentDir||curDir.x!==lastSentDir.x||curDir.y!==lastSentDir.y){
    sendInput({dir:curDir},[matchPeer])
    lastSentDir={...curDir}
  }

  if(tick%HASH_IV===0){
    const selfH=calcHash(snakes,fruits,scores,tick)
    const peerH=calcHash(shadowSnakes,shadowFruits,shadowScores,tick)
    sendHash({selfH,peerH,t:tick},[matchPeer])
  }

  elS1.textContent=scores[myIdx]
  elS2.textContent=scores[1-myIdx]
  render()

  if(!snakes[0].alive||!snakes[1].alive){
    clearInterval(loopId);loopId=null
    const tie=!snakes[0].alive&&!snakes[1].alive
    setTimeout(()=>showEnd(tie?null:snakes[myIdx].alive),400)
  }
}

function shadowTick(){
  for(let i=0;i<2;i++){
    if(!shadowSnakes[i].alive)continue
    const s=shadowSnakes[i]
    const head={x:s.body[0].x+shadowNextDir[i].x,y:s.body[0].y+shadowNextDir[i].y}
    if(head.x<0||head.x>=COLS||head.y<0||head.y>=ROWS){s.alive=false;continue}
    if(s.body.some(c=>c.x===head.x&&c.y===head.y)){s.alive=false;continue}
    if(shadowSnakes[1-i].body.some(c=>c.x===head.x&&c.y===head.y)){s.alive=false;continue}
    s.body.unshift(head)
    const fi=shadowFruits.findIndex(f=>f.x===head.x&&f.y===head.y)
    if(fi!==-1){shadowScores[i]++;shadowFruits.splice(fi,1);spawnFruitShadow()}
    else s.body.pop()
  }
}

function spawnFruit(rng){
  let p,t=0
  do{p={x:rngInt(rng,COLS),y:rngInt(rng,ROWS)}}
  while(++t<20&&(
    snakes.some(s=>s.body.some(c=>c.x===p.x&&c.y===p.y))||
    fruits.some(f=>f.x===p.x&&f.y===p.y)
  ))
  fruits.push(p)
}

function spawnFruitShadow(){
  let p,t=0
  do{p={x:rngInt(shadowRng,COLS),y:rngInt(shadowRng,ROWS)}}
  while(++t<20&&(
    shadowSnakes.some(s=>s.body.some(c=>c.x===p.x&&c.y===p.y))||
    shadowFruits.some(f=>f.x===p.x&&f.y===p.y)
  ))
  shadowFruits.push(p)
}

function calcHash(sn,fr,sc,t){
  if(!sn)return 0
  const d=JSON.stringify({b:sn.map(s=>s.body),f:fr,s:sc,t})
  let h=0
  for(let i=0;i<d.length;i++)h=Math.imul(31,h)+d.charCodeAt(i)|0
  return h>>>0
}

const COL=['#00ffaa','#ff2d6b']
function render(){
  if(!snakes)return
  ctx.fillStyle='#070710';ctx.fillRect(0,0,cv.width,cv.height)
  ctx.strokeStyle='#0e0e1a';ctx.lineWidth=.5
  for(let x=0;x<=COLS;x++){ctx.beginPath();ctx.moveTo(x*CELL,0);ctx.lineTo(x*CELL,cv.height);ctx.stroke()}
  for(let y=0;y<=ROWS;y++){ctx.beginPath();ctx.moveTo(0,y*CELL);ctx.lineTo(cv.width,y*CELL);ctx.stroke()}
  ctx.fillStyle='#ffd700'
  for(const f of fruits){
    ctx.beginPath()
    ctx.arc(f.x*CELL+CELL/2,f.y*CELL+CELL/2,CELL/2-2,0,Math.PI*2)
    ctx.fill()
  }
  for(let i=0;i<2;i++){
    const s=snakes[i]
    for(let j=0;j<s.body.length;j++){
      const c=s.body[j],pad=j===0?1:3
      ctx.globalAlpha=j===0?1:Math.max(0.15,1-j/s.body.length)
      ctx.fillStyle=COL[i]
      ctx.fillRect(c.x*CELL+pad,c.y*CELL+pad,CELL-pad*2,CELL-pad*2)
    }
    ctx.globalAlpha=1
    if(s.alive){
      ctx.strokeStyle=COL[i];ctx.lineWidth=2
      ctx.shadowColor=COL[i];ctx.shadowBlur=10
      ctx.strokeRect(s.body[0].x*CELL+1,s.body[0].y*CELL+1,CELL-2,CELL-2)
      ctx.shadowBlur=0
    }
  }
}

function drawCountdown(n){
  const cx=cv.width/2,cy=cv.height/2,r=CELL*3
  ctx.save()
  ctx.fillStyle='#070710cc'
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill()
  ctx.font='bold '+CELL*3+'px "Orbitron",monospace'
  ctx.textAlign='center';ctx.textBaseline='middle'
  ctx.fillStyle='#00ffaa';ctx.shadowColor='#00ffaa';ctx.shadowBlur=24
  ctx.fillText(n>0?n:'GO',cx,cy)
  ctx.restore()
}

function showEnd(won,msg){
  stopVoice()
  if(loopId){clearInterval(loopId);loopId=null}
  snakes=null;shadowSnakes=null
  elGame.classList.add('hidden')
  elOver.classList.remove('hidden')
  elOver.classList.remove('win')
  if(msg)elGoT.textContent=msg
  else if(won===null)elGoT.textContent=T.draw
  else if(won){elGoT.textContent=T.youWin;elOver.classList.add('win')}
  else elGoT.textContent=T.youLose
  elGoM.textContent=T.score+': '+(scores?.[myIdx]??0)
}

function endGame(won,msg){
  if(loopId){clearInterval(loopId);loopId=null}
  stopVoice()
  matchPeer=null;snakes=null;shadowSnakes=null
  showEnd(won,msg)
}

function resetToLobby(){
  if(loopId){clearInterval(loopId);loopId=null}
  stopVoice()
  try{room?.leave()}catch(e){}
  room=null;matchPeer=null;lobbyPeers=[]
  snakes=null;shadowSnakes=null
  fruits=null;scores=null;nextDir=null;tick=0;lastSentDir=null
  if(elLog)elLog.innerHTML=''
  elOver.classList.add('hidden')
  elGame.classList.add('hidden')
  elSrch.classList.add('hidden')
  elLobby.classList.remove('hidden')
  elSt.textContent=T.pressFind
  btnFind.disabled=false
}

const DIRS={ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},w:{x:0,y:-1},s:{x:0,y:1},a:{x:-1,y:0},d:{x:1,y:0}}
document.addEventListener('keydown',e=>{
  if(!snakes||myIdx===undefined)return
  const d=DIRS[e.key];if(!d)return
  if(!opp(d,nextDir[myIdx]))nextDir[myIdx]=d
  e.preventDefault()
})

const DMAP={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}}
document.querySelectorAll('.dp').forEach(btn=>{
  const fire=()=>{
    if(!snakes||myIdx===undefined)return
    const d=DMAP[btn.dataset.dir]
    if(d&&!opp(d,nextDir[myIdx]))nextDir[myIdx]=d
  }
  btn.addEventListener('touchstart',e=>{e.preventDefault();fire()},{passive:false})
  btn.addEventListener('mousedown',fire)
})

btnFind.addEventListener('click',()=>{
  btnFind.disabled=true
  elSrch.classList.remove('hidden')
  elSt.textContent=T.searching
  joinLobby()
})
btnRply.addEventListener('click',resetToLobby)

initMic()
btnFind.disabled=false
