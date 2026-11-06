'use strict';
// Integração REAL de API/Socket.IO. Escreve dados; execute apenas em banco de testes.
const assert=require('node:assert/strict');
const path=require('node:path');
if(process.env.E2E_ALLOW_WRITE!=='yes')throw Error('Defina E2E_ALLOW_WRITE=yes SOMENTE para banco de testes isolado.');
const BASE=(process.env.E2E_API_URL||'http://127.0.0.1:3001/api').replace(/\/$/,'');
const origin=new URL(BASE).origin;
const inviteCode=process.env.E2E_INVITE_CODE||'';
const username=process.env.OWNER_USERNAME||'owner';
const password=process.env.OWNER_PASSWORD;
if(!password)throw Error('OWNER_PASSWORD obrigatório para teste e2e');
async function api(route,method='GET',body,token){
 const response=await fetch(BASE+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(`${method} ${route}: HTTP ${response.status} ${JSON.stringify(json)}`);
 return json;
}
async function main(){
 const health=await api('/health');assert.equal(health.ok,true);
 const owner=await api('/auth/login','POST',{login:username,password});assert.equal(owner.user.role,'owner');
 const ownerToken=owner.token;
 const memberName='fabutest_'+Date.now().toString(36);
 const user=await api('/auth/register','POST',{username:memberName,email:memberName+'@example.test',password:'StrongE2ePassword123!',inviteCode});
 const memberToken=user.token;
 assert.equal((await api('/auth/me','GET',undefined,memberToken)).user.username,memberName);
 const updated=await api('/users/me','PATCH',{display_name:'Jogador teste',bio:'E2E'},memberToken);
 assert.equal(updated.user.display_name,'Jogador teste');
 const post=(await api('/forum','POST',{title:'Post de teste E2E',content:'Uma publicação de integração',category:'geral'},memberToken)).post;
 assert.ok((await api('/forum','GET',undefined,ownerToken)).posts.some(p=>p.id===post.id));
 await api('/forum/'+post.id+'/comments','POST',{content:'Comentário E2E'},ownerToken);
 const detail=await api('/forum/'+post.id,'GET',undefined,memberToken);
 assert.equal(detail.comments.length,1);
 await api('/forum/'+post.id+'/like','POST',{},ownerToken);
 const announcement=await api('/announcements','POST',{title:'Comunicado E2E',content:'Funcionando'},ownerToken);
 assert.ok(announcement.announcement.id);
 const events=await api('/events','POST',{title:'Jogaremos amanhã',startsAt:new Date(Date.now()+86400000).toISOString()},ownerToken);
 await api('/events/'+events.event.id+'/rsvp','POST',{confirmed:true},memberToken);
 assert.ok((await api('/events','GET',undefined,ownerToken)).events.some(e=>e.id===events.event.id&&e.confirmed_count>=1));
 const poll=await api('/polls','POST',{title:'Qual jogo?',options:['CS2','FiveM']},ownerToken);
 const polls=await api('/polls','GET',undefined,memberToken);
 const selected=polls.polls.find(x=>x.id===poll.poll.id);
 assert.equal(selected.options.length,2);
 await api('/polls/'+poll.poll.id+'/vote','POST',{optionId:selected.options[0].id},memberToken);
 const tournament=(await api('/tournaments','POST',{name:'Copa E2E',game:'CS2',maxPlayers:4},ownerToken)).tournament;
 await api('/tournaments/'+tournament.id+'/join','POST',{},memberToken);
 await api('/tournaments/'+tournament.id+'/join','POST',{},ownerToken);
 const match=await api('/tournaments/'+tournament.id+'/matches','POST',{player1Id:owner.user.id,player2Id:user.user.id,score1:2,score2:1,round:1},ownerToken);
 assert.ok(match.match.id);
 const details=await api('/tournaments/'+tournament.id,'GET',undefined,memberToken);
 assert.equal(details.matches.length,1);
 await api('/tournaments/'+tournament.id+'/finish','PATCH',{},ownerToken);
 const rps=await api('/minigames/rps','POST',{choice:'papel'},memberToken);
 assert.ok(['win','loss','draw'].includes(rps.result));
 assert.ok((await api('/ranking','GET',undefined,memberToken)).ranking.some(r=>r.id===user.user.id&&r.games>=1));
 const clip=await api('/clips','POST',{title:'Clipe E2E',videoUrl:'https://www.youtube.com/watch?v=12345678901'},memberToken);
 assert.ok(clip.clip.id);
 const friend=await api('/friends/'+owner.user.id,'POST',{},memberToken);
 await api('/friends/'+friend.friendship.id+'/accept','PATCH',{},ownerToken);
 assert.ok((await api('/friends','GET',undefined,memberToken)).friends.some(f=>f.id===friend.friendship.id&&f.status==='accepted'));
 const dm=await api('/dms/'+owner.user.id,'POST',{content:'Mensagem de teste'},memberToken);
 assert.ok((await api('/dms/'+user.user.id,'GET',undefined,ownerToken)).messages.some(m=>m.id===dm.message.id));
 const report=await api('/reports','POST',{targetType:'post',targetId:post.id,reason:'Verificação de moderação automática'},ownerToken);
 assert.ok((await api('/reports','GET',undefined,ownerToken)).reports.some(r=>r.id===report.report.id));
 await api('/reports/'+report.report.id+'/resolve','PATCH',{},ownerToken);
 assert.ok((await api('/turn','GET',undefined,memberToken)).iceServers.length>=1);
 assert.ok(typeof (await api('/minecraft','GET',undefined,memberToken)).configured==='boolean');
 // Verifica texto e sinalização da sala de voz sem precisar de microfone ou navegador.
 const {io}=require(path.join(__dirname,'../frontend/node_modules/socket.io-client'));
 const memberSocket=io(origin,{auth:{token:memberToken},transports:['websocket'],reconnection:false});
 const ownerSocket=io(origin,{auth:{token:ownerToken},transports:['websocket'],reconnection:false});
 const waitConnect=s=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Socket timeout')),5000);s.once('connect',()=>{clearTimeout(timer);resolve()});s.once('connect_error',e=>{clearTimeout(timer);reject(e)})});
 try{
  await Promise.all([waitConnect(memberSocket),waitConnect(ownerSocket)]);
  const server=(await api('/servers','GET',undefined,ownerToken)).servers[0];
  const channels=(await api('/servers/'+server.id+'/channels','GET',undefined,memberToken)).channels;
  const text=channels.find(c=>c.type==='text'),voice=channels.find(c=>c.type==='voice');
  assert.ok(text&&voice);
  memberSocket.emit('channel:join',{channelId:text.id});
  ownerSocket.emit('channel:join',{channelId:text.id});
  // Requisições/eventos Socket.IO preservam ordem de envio no mesmo transporte.
  const ack=await new Promise((resolve,reject)=>memberSocket.timeout(5000).emit('message:send',{channelId:text.id,content:'E2E websocket'},(e,r)=>e?reject(e):resolve(r)));
  assert.equal(ack.ok,true,JSON.stringify(ack));
  assert.ok((await api('/channels/'+text.id+'/messages','GET',undefined,ownerToken)).messages.some(m=>m.id===ack.message.id));
  const joinAck=await new Promise((resolve,reject)=>memberSocket.timeout(5000).emit('voice:join',{channelId:voice.id},(e,r)=>e?reject(e):resolve(r)));
  assert.equal(joinAck.ok,true,JSON.stringify(joinAck));
  const joinOwner=await new Promise((resolve,reject)=>ownerSocket.timeout(5000).emit('voice:join',{channelId:voice.id},(e,r)=>e?reject(e):resolve(r)));
  assert.equal(joinOwner.ok,true);
  assert.ok(joinOwner.peers.some(p=>p.socketId===memberSocket.id));
 }finally{memberSocket.disconnect();ownerSocket.disconnect()}
 await api('/forum/'+post.id,'DELETE',undefined,memberToken);
 console.log('E2E aprovado: autenticação, perfil, fórum, avisos, eventos, enquetes, campeonatos, minigames, DM, amizades, denúncias, sockets e voz (sinalização).');
}
main().catch(e=>{console.error(e);process.exitCode=1});
