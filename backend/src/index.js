require('dotenv').config();
const express=require('express'), http=require('http'), cors=require('cors'), helmet=require('helmet'), bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken');
const {Pool}=require('pg');const {Server}=require('socket.io');const crypto=require('node:crypto');const {choices: rpsChoices,scoreRps}=require('./rps');const {minecraftStatus}=require('./minecraft');const {rateLimit}=require('express-rate-limit');
const app=express(), server=http.createServer(app), pool=new Pool({connectionString:process.env.DATABASE_URL});app.set('trust proxy','loopback');
const origin=(process.env.FRONTEND_ORIGIN||'http://localhost:3000').split(',').map(s=>s.trim());
const io=new Server(server,{cors:{origin,methods:['GET','POST']},maxHttpBufferSize:100000});
app.use(helmet());app.use(cors({origin}));app.use(express.json({limit:'64kb'}));
const authLimit=rateLimit({windowMs:15*60*1000,limit:25,standardHeaders:'draft-7',legacyHeaders:false});
const contentLimit=rateLimit({windowMs:60*1000,limit:60,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false});
const reportLimit=rateLimit({windowMs:60*1000,limit:10,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false});
const secret=process.env.JWT_SECRET;if(!secret||secret.length<32)throw Error('JWT_SECRET com pelo menos 32 caracteres é obrigatório');
const q=(text,params=[])=>pool.query(text,params);
const run=(fn)=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
async function notify(userId,type,title,body,link){
 const r=await q('INSERT INTO notifications(user_id,type,title,body,link) VALUES($1,$2,$3,$4,$5) RETURNING id,type,title,body,link,created_at,read_at',[userId,type,title,body,link]);
 io.to('user:'+userId).emit('notification:new',{notification:r.rows[0]});
}

const sign=user=>jwt.sign({id:user.id},secret,{expiresIn:'7d'});
const publicUser=u=>({id:u.id,username:u.username,display_name:u.display_name,avatar_url:u.avatar_url,role:u.role,status:u.status,bio:u.bio,points:Number(u.points||0),wins:Number(u.wins||0),games:Number(u.games||0)});
async function currentUser(token){const p=jwt.verify(token,secret);const r=await q(`SELECT u.*,r.points,r.wins,r.games FROM users u LEFT JOIN rankings r ON r.user_id=u.id WHERE u.id=$1`,[p.id]);if(!r.rows.length||r.rows[0].member_status!=='active')throw Error('Conta indisponível');return r.rows[0]}
async function auth(req,res,next){try{const t=(req.headers.authorization||'').replace(/^Bearer /i,'');req.user=await currentUser(t);next()}catch{res.status(401).json({error:'Não autenticado'})}}
const mod=(req,res,next)=>['owner','admin','moderator'].includes(req.user.role)?next():res.status(403).json({error:'Sem permissão'});
const admin=(req,res,next)=>['owner','admin'].includes(req.user.role)?next():res.status(403).json({error:'Sem permissão'});
const required=(v,max=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const err=(res,message,status=400)=>res.status(status).json({error:message});
app.get('/api/health',run(async(_,res)=>{await pool.query('SELECT 1');res.json({ok:true,db:'connected'})}));
app.post('/api/auth/register',authLimit,run(async(req,res)=>{if(process.env.REGISTRATION_ENABLED==='false')return err(res,'Cadastro desativado',403);const {username,email,password}=req.body;
if(process.env.INVITE_CODE){const provided=Buffer.from(typeof req.body?.inviteCode==='string'?req.body.inviteCode:'');const expected=Buffer.from(process.env.INVITE_CODE);if(provided.length!==expected.length||!crypto.timingSafeEqual(provided,expected))return err(res,'Convite inválido',403)}
if(typeof username!=='string'||typeof email!=='string'||!/^[a-zA-Z0-9_]{3,32}$/.test(username)||!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length<8||password.length>128)return err(res,'Usuário, email ou senha inválidos (mínimo 8 caracteres)');
const hash=await bcrypt.hash(password,12);const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,$3,$1) RETURNING *',[username.toLowerCase(),email.toLowerCase(),hash]);await client.query('INSERT INTO rankings(user_id) VALUES($1)',[r.rows[0].id]);await client.query('COMMIT');res.status(201).json({token:sign(r.rows[0]),user:publicUser(r.rows[0])})}catch(e){await client.query('ROLLBACK');if(e.code==='23505')return err(res,'Usuário ou email já cadastrado',409);throw e}finally{client.release()}}));
app.post('/api/auth/login',authLimit,run(async(req,res)=>{const r=await q(`SELECT u.*,r.points,r.wins,r.games FROM users u LEFT JOIN rankings r ON r.user_id=u.id WHERE lower(u.email)=lower($1) OR lower(u.username)=lower($1) LIMIT 1`,[typeof req.body?.login==='string'?req.body.login:'']);const user=r.rows[0];if(!user||!(await bcrypt.compare(typeof req.body?.password==='string'?req.body.password:'',user.password_hash)))return err(res,'Credenciais inválidas',401);if(user.member_status!=='active')return err(res,'Conta bloqueada',403);res.json({token:sign(user),user:publicUser(user)})}));
app.get('/api/auth/me',auth,run(async(req,res)=>res.json({user:publicUser(req.user)})));
app.get('/api/notifications',auth,run(async(req,res)=>{
 const r=await q('SELECT id,type,title,body,link,created_at,read_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[req.user.id]);
 res.json({notifications:r.rows});
}));
app.post('/api/notifications/read-all',auth,run(async(req,res)=>{
 await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL',[req.user.id]);res.json({ok:true});
}));

app.patch('/api/users/me',auth,run(async(req,res)=>{const name=String(req.body.display_name??req.user.display_name??'').trim(),bio=String(req.body.bio??req.user.bio??'').trim();
 const avatar=req.body.avatar_url;
 if(name.length>64||bio.length>500)return err(res,'Perfil muito longo');
 if(avatar!==undefined){if(typeof avatar!=='string'||avatar.length>2000)return err(res,'Avatar inválido');if(avatar){try{const url=new URL(avatar);if(url.protocol!=='https:'||url.username||url.password)throw Error('URL insegura')}catch{return err(res,'O avatar deve ser uma URL HTTPS válida')}}}
 const r=await q('UPDATE users SET display_name=$1,bio=$2,avatar_url=COALESCE($3,avatar_url) WHERE id=$4 RETURNING *',[name||req.user.username,bio,avatar===undefined?null:avatar,req.user.id]);res.json({user:publicUser(r.rows[0])})}));
app.get('/api/users',auth,run(async(req,res)=>{const r=await q(`SELECT u.id,u.username,u.display_name,u.avatar_url,u.role,u.status,u.member_status,coalesce(r.points,0) points FROM users u LEFT JOIN rankings r ON r.user_id=u.id ORDER BY u.created_at DESC LIMIT 200`);res.json({users:r.rows})}));
app.patch('/api/users/:id/moderate',auth,admin,run(async(req,res)=>{const {role,member_status}=req.body;const allowedRole=['member','moderator','admin'],allowedStatus=['active','suspended','banned'];if(req.params.id===req.user.id)return err(res,'Não pode alterar sua própria conta');const target=(await q('SELECT role FROM users WHERE id=$1',[req.params.id])).rows[0];if(!target||target.role==='owner'||(target.role==='admin'&&req.user.role!=='owner'))return err(res,'Alvo não permitido',403);if(role&&!allowedRole.includes(role)||member_status&&!allowedStatus.includes(member_status))return err(res,'Valor inválido');if(role==='admin'&&req.user.role!=='owner')return err(res,'Apenas o dono pode promover admins',403);await q('UPDATE users SET role=coalesce($1,role),member_status=coalesce($2,member_status) WHERE id=$3',[role||null,member_status||null,req.params.id]);res.json({ok:true})}));
app.get('/api/servers',auth,run(async(req,res)=>res.json({servers:(await q('SELECT id,name,description FROM servers ORDER BY created_at')).rows})));
app.get('/api/servers/:id/channels',auth,run(async(req,res)=>res.json({channels:(await q('SELECT * FROM channels WHERE server_id=$1 AND is_private=false ORDER BY position,created_at',[req.params.id])).rows})));
app.post('/api/servers/:id/channels',auth,admin,run(async(req,res)=>{const {name,type='text'}=req.body;if(!required(name,100)||!['text','voice','announcement'].includes(type))return err(res,'Canal inválido');const r=await q('INSERT INTO channels(server_id,name,type) VALUES($1,$2,$3) RETURNING *',[req.params.id,name,type]);io.emit('channel:created',{serverId:req.params.id,channel:r.rows[0]});res.status(201).json({channel:r.rows[0]})}));
app.patch('/api/channels/:id',auth,admin,run(async(req,res)=>{
 const {name,description}=req.body||{};
 if(!required(name,100)||typeof description!=='string'||description.length>500)return err(res,'Canal inválido');
 const r=await q('UPDATE channels SET name=$1,description=$2 WHERE id=$3 RETURNING *',[name.trim(),description,req.params.id]);
 if(!r.rows.length)return err(res,'Canal não encontrado',404);
 io.emit('channel:updated',{channel:r.rows[0]});res.json({channel:r.rows[0]});
}));
app.delete('/api/channels/:id',auth,admin,run(async(req,res)=>{
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const ch=(await client.query('SELECT * FROM channels WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
  if(!ch){await client.query('ROLLBACK');return err(res,'Canal não encontrado',404)}
  await client.query('SELECT id FROM servers WHERE id=$1 FOR UPDATE',[ch.server_id]);
  if(ch.type==='text'){
   const textCount=(await client.query("SELECT count(*)::int n FROM channels WHERE server_id=$1 AND type='text'",[ch.server_id])).rows[0].n;
   if(textCount<=1){await client.query('ROLLBACK');return err(res,'Não é possível excluir o último canal de texto')}
  }
  await client.query('DELETE FROM channels WHERE id=$1',[req.params.id]);
  await client.query('COMMIT');
  io.emit('channel:deleted',{channelId:req.params.id,serverId:ch.server_id,type:ch.type});
  res.json({ok:true});
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.get('/api/channels/:id/messages',auth,run(async(req,res)=>{
 const beforeId=req.query.beforeId||null;
 if(beforeId&&(typeof beforeId!=='string'||!/^[0-9a-fA-F-]{36}$/.test(beforeId)))return err(res,'Cursor inválido');
 const r=await q(`SELECT m.id,m.channel_id,m.sender_id AS user_id,m.content,m.created_at,m.reply_to_id,u.username,u.display_name,u.avatar_url,u.role
 FROM messages m JOIN users u ON u.id=m.sender_id JOIN channels c ON c.id=m.channel_id
 WHERE m.channel_id=$1 AND m.deleted_at IS NULL AND c.is_private=false
 AND ($2::uuid IS NULL OR (m.created_at,m.id)<(SELECT created_at,id FROM messages WHERE id=$2 AND channel_id=$1))
 ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,[req.params.id,beforeId]);
 res.json({messages:r.rows.reverse()});
}));
app.delete('/api/messages/:id',auth,run(async(req,res)=>{const r=await q('SELECT sender_id,channel_id FROM messages WHERE id=$1 AND deleted_at IS NULL',[req.params.id]);if(!r.rows.length)return err(res,'Mensagem não encontrada',404);if(r.rows[0].sender_id!==req.user.id&&!['owner','admin','moderator'].includes(req.user.role))return err(res,'Sem permissão',403);await q('UPDATE messages SET deleted_at=now() WHERE id=$1',[req.params.id]);io.to('channel:'+r.rows[0].channel_id).emit('message:deleted',{id:req.params.id,channelId:r.rows[0].channel_id});res.json({ok:true})}));
// Conversas privadas: somente o remetente e o destinatário podem consultar.
app.get('/api/dms/:otherId',auth,run(async(req,res)=>{
 if(req.params.otherId===req.user.id)return err(res,'Escolha outro membro');
 const other=await q("SELECT id,username,display_name FROM users WHERE id=$1 AND member_status='active'",[req.params.otherId]);
 if(!other.rows.length)return err(res,'Membro não encontrado',404);
 const r=await q(`SELECT d.id,d.sender_id,d.receiver_id,d.content,d.created_at,u.username,u.display_name FROM direct_messages d JOIN users u ON u.id=d.sender_id WHERE (d.sender_id=$1 AND d.receiver_id=$2) OR (d.sender_id=$2 AND d.receiver_id=$1) ORDER BY d.created_at DESC LIMIT 100`,[req.user.id,req.params.otherId]);
 res.json({member:other.rows[0],messages:r.rows.reverse()});
}));
app.post('/api/dms/:otherId',auth,contentLimit,run(async(req,res)=>{
 if(req.params.otherId===req.user.id||!required(req.body.content,2000))return err(res,'Mensagem inválida');
 const other=await q("SELECT id FROM users WHERE id=$1 AND member_status='active'",[req.params.otherId]);
 if(!other.rows.length)return err(res,'Membro não encontrado',404);
 const r=await q(`INSERT INTO direct_messages(sender_id,receiver_id,content) VALUES($1,$2,$3) RETURNING *`,[req.user.id,req.params.otherId,req.body.content.trim()]);
 const message={...r.rows[0],username:req.user.username,display_name:req.user.display_name};
 io.to('user:'+req.params.otherId).emit('dm:new',{message});
 notify(req.params.otherId,'dm','Nova mensagem privada',req.user.username+' enviou uma mensagem','dms').catch(e=>console.error('Notificação DM:',e.message));
 io.to('user:'+req.user.id).emit('dm:new',{message});
 res.status(201).json({message});
}));
// Amizades: pedidos de amizade e aceite. Bloqueio tratado separadamente.
app.get('/api/friends',auth,run(async(req,res)=>{
 const r=await q(`SELECT f.id,f.sender_id,f.receiver_id,f.status,u.id AS other_id,u.username,u.display_name FROM friendships f JOIN users u ON u.id=CASE WHEN f.sender_id=$1 THEN f.receiver_id ELSE f.sender_id END WHERE f.sender_id=$1 OR f.receiver_id=$1 ORDER BY f.created_at DESC`,[req.user.id]);
 res.json({friends:r.rows});
}));
app.post('/api/friends/:otherId',auth,run(async(req,res)=>{
 const other=req.params.otherId;
 if(other===req.user.id)return err(res,'Não é possível adicionar você mesmo');
 const exists=await q("SELECT id FROM users WHERE id=$1 AND member_status='active'",[other]);
 if(!exists.rows.length)return err(res,'Membro não encontrado',404);
 const found=await q('SELECT id,status FROM friendships WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)',[req.user.id,other]);
 if(found.rows.length)return err(res,'Já existe pedido ou amizade',409);
 try{const r=await q('INSERT INTO friendships(sender_id,receiver_id) VALUES($1,$2) RETURNING *',[req.user.id,other]);notify(other,'friend_request','Novo pedido de amizade',req.user.username+' quer adicionar você','friends').catch(e=>console.error('Notificação amizade:',e.message));res.status(201).json({friendship:r.rows[0]})}catch(e){if(e.code==='23505')return err(res,'Já existe pedido ou amizade',409);throw e}
}));
app.patch('/api/friends/:id/accept',auth,run(async(req,res)=>{
 const r=await q("UPDATE friendships SET status='accepted' WHERE id=$1 AND receiver_id=$2 AND status='pending' RETURNING id,sender_id",[req.params.id,req.user.id]);
 if(!r.rows.length)return err(res,'Pedido não encontrado',404);
 notify(r.rows[0].sender_id,'friend_accept','Amizade aceita',req.user.username+' aceitou seu pedido','friends').catch(e=>console.error('Notificação amizade:',e.message));
 res.json({ok:true});
}));
app.delete('/api/friends/:id',auth,run(async(req,res)=>{
 const r=await q('DELETE FROM friendships WHERE id=$1 AND (sender_id=$2 OR receiver_id=$2) RETURNING id',[req.params.id,req.user.id]);
 if(!r.rows.length)return err(res,'Amizade não encontrada',404);
 res.json({ok:true});
}));
app.get('/api/forum',auth,run(async(req,res)=>{const params=[],where=['p.deleted_at IS NULL'];if(req.query.category){params.push(req.query.category);where.push(`p.category=$${params.length}`)}const r=await q(`SELECT p.*,u.username,u.display_name,(SELECT count(*)::int FROM forum_comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) comment_count,(SELECT count(*)::int FROM reactions x WHERE x.target_type='post' AND x.target_id=p.id) like_count FROM forum_posts p JOIN users u ON u.id=p.author_id WHERE ${where.join(' AND ')} ORDER BY p.pinned DESC,p.created_at DESC LIMIT 100`,params);res.json({posts:r.rows})}));
app.post('/api/forum',auth,contentLimit,run(async(req,res)=>{const {title,content,category='geral'}=req.body;if(!required(title,200)||!required(content,20000)||!['geral','jogos','clips','sugestoes','off-topic'].includes(category))return err(res,'Post inválido');const r=await q('INSERT INTO forum_posts(author_id,title,content,category) VALUES($1,$2,$3,$4) RETURNING *',[req.user.id,title,content,category]);res.status(201).json({post:r.rows[0]})}));
app.delete('/api/forum/:id',auth,run(async(req,res)=>{
 const r=await q(`UPDATE forum_posts SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL
  AND (author_id=$2 OR $3=true) RETURNING id`,[req.params.id,req.user.id,['owner','admin','moderator'].includes(req.user.role)]);
 if(!r.rows.length)return err(res,'Post não encontrado ou sem permissão',404);
 res.json({ok:true});
}));
app.get('/api/forum/:id',auth,run(async(req,res)=>{const r=await q(`SELECT p.*,u.username,u.display_name FROM forum_posts p JOIN users u ON u.id=p.author_id WHERE p.id=$1 AND p.deleted_at IS NULL`,[req.params.id]);if(!r.rows.length)return err(res,'Não encontrado',404);await q('UPDATE forum_posts SET views=views+1 WHERE id=$1',[req.params.id]);const comments=await q(`SELECT c.*,u.username,u.display_name FROM forum_comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=$1 AND c.deleted_at IS NULL ORDER BY c.created_at`,[req.params.id]);res.json({post:r.rows[0],comments:comments.rows})}));
app.post('/api/forum/:id/comments',auth,contentLimit,run(async(req,res)=>{if(!required(req.body.content,5000))return err(res,'Comentário inválido');const r=await q('INSERT INTO forum_comments(post_id,author_id,content) SELECT id,$2,$3 FROM forum_posts WHERE id=$1 AND deleted_at IS NULL RETURNING id',[req.params.id,req.user.id,req.body.content.trim()]);if(!r.rows.length)return err(res,'Post não encontrado',404);res.status(201).json({ok:true})}));
app.delete('/api/forum/comments/:id',auth,run(async(req,res)=>{
 const r=await q(`UPDATE forum_comments SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL
 AND (author_id=$2 OR $3=true) RETURNING id`,[req.params.id,req.user.id,['owner','admin','moderator'].includes(req.user.role)]);
 if(!r.rows.length)return err(res,'Comentário não encontrado ou sem permissão',404);
 res.json({ok:true});
}));
app.post('/api/forum/:id/like',auth,run(async(req,res)=>{const r=await q(`INSERT INTO reactions(user_id,target_type,target_id,emoji) SELECT $1,'post',id,'👍' FROM forum_posts WHERE id=$2 AND deleted_at IS NULL ON CONFLICT DO NOTHING RETURNING id`,[req.user.id,req.params.id]);res.json({ok:true,added:r.rowCount>0})}));
app.get('/api/events',auth,run(async(req,res)=>res.json({events:(await q(`SELECT e.*,(SELECT count(*)::int FROM event_rsvps r WHERE r.event_id=e.id AND r.confirmed=true) confirmed_count, EXISTS(SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=$1 AND r.confirmed=true) is_confirmed FROM events e WHERE e.status IN ('upcoming','ongoing') AND (e.starts_at >= NOW()-INTERVAL '12 hours' OR e.status='ongoing') ORDER BY starts_at LIMIT 100`,[req.user.id])).rows})));
app.post('/api/events',auth,admin,run(async(req,res)=>{const {title,description='',game='',startsAt}=req.body;if(!required(title,200)||typeof description!=='string'||description.length>5000||typeof game!=='string'||game.length>100||!startsAt||!Number.isFinite(new Date(startsAt).getTime()))return err(res,'Evento inválido');const r=await q('INSERT INTO events(creator_id,title,description,game,starts_at) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.id,title,description,game,startsAt]);res.status(201).json({event:r.rows[0]})}));
app.post('/api/events/:id/rsvp',auth,run(async(req,res)=>{await q('INSERT INTO event_rsvps(event_id,user_id,confirmed) VALUES($1,$2,$3) ON CONFLICT(event_id,user_id) DO UPDATE SET confirmed=excluded.confirmed',[req.params.id,req.user.id,req.body.confirmed!==false]);res.json({ok:true})}));
app.get('/api/polls',auth,run(async(req,res)=>{const r=await q('SELECT * FROM polls WHERE ends_at IS NULL OR ends_at>now() ORDER BY created_at DESC LIMIT 50');for(const p of r.rows)p.options=(await q('SELECT o.*,(SELECT count(*)::int FROM poll_votes v WHERE v.option_id=o.id) votes FROM poll_options o WHERE o.poll_id=$1',[p.id])).rows;res.json({polls:r.rows})}));
app.post('/api/polls',auth,admin,run(async(req,res)=>{if(!required(req.body.title,200)||!Array.isArray(req.body.options)||req.body.options.length<2||req.body.options.length>10||!req.body.options.every(x=>required(x,200)))return err(res,'Enquete inválida');const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('INSERT INTO polls(creator_id,title) VALUES($1,$2) RETURNING *',[req.user.id,req.body.title]);for(const option of req.body.options)await client.query('INSERT INTO poll_options(poll_id,text) VALUES($1,$2)',[r.rows[0].id,option]);await client.query('COMMIT');res.status(201).json({poll:r.rows[0]})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}));
app.post('/api/polls/:id/vote',auth,run(async(req,res)=>{const found=await q('SELECT o.id FROM poll_options o JOIN polls p ON p.id=o.poll_id WHERE o.id=$1 AND o.poll_id=$2 AND (p.ends_at IS NULL OR p.ends_at>now())',[req.body.optionId,req.params.id]);if(!found.rows.length)return err(res,'Opção inválida');try{await q('INSERT INTO poll_votes(option_id,poll_id,user_id) VALUES($1,$2,$3)',[req.body.optionId,req.params.id,req.user.id]);res.json({ok:true})}catch(e){if(e.code==='23505')return err(res,'Você já votou',409);throw e}}));
app.get('/api/ranking',auth,run(async(req,res)=>{const r=await q('SELECT u.id,u.username,u.display_name,r.points,r.wins,r.losses,r.games FROM rankings r JOIN users u ON u.id=r.user_id ORDER BY r.points DESC,r.wins DESC LIMIT 100');res.json({ranking:r.rows})}));
app.get('/api/tournaments',auth,run(async(req,res)=>{const r=await q(`SELECT t.*,u.username creator_name,(SELECT count(*)::int FROM tournament_participants p WHERE p.tournament_id=t.id) participants_count, EXISTS(SELECT 1 FROM tournament_participants p WHERE p.tournament_id=t.id AND p.user_id=$1) joined FROM tournaments t JOIN users u ON u.id=t.creator_id ORDER BY t.created_at DESC LIMIT 100`,[req.user.id]);res.json({tournaments:r.rows})}));
app.get('/api/tournaments/:id',auth,run(async(req,res)=>{
 const tournament=(await q(`SELECT t.*,u.username creator_name FROM tournaments t JOIN users u ON u.id=t.creator_id WHERE t.id=$1`,[req.params.id])).rows[0];
 if(!tournament)return err(res,'Torneio não encontrado',404);
 const participants=(await q(`SELECT u.id,u.username,u.display_name FROM tournament_participants p JOIN users u ON u.id=p.user_id WHERE p.tournament_id=$1 ORDER BY p.registered_at`,[req.params.id])).rows;
 const matches=(await q(`SELECT m.*,a.username player1_name,b.username player2_name,w.username winner_name FROM tournament_matches m JOIN users a ON a.id=m.player1_id JOIN users b ON b.id=m.player2_id LEFT JOIN users w ON w.id=m.winner_id WHERE m.tournament_id=$1 ORDER BY m.round,m.created_at`,[req.params.id])).rows;
 res.json({tournament,participants,matches});
}));
app.post('/api/tournaments/:id/matches',auth,admin,run(async(req,res)=>{
 const {player1Id,player2Id,score1,score2,round=1}=req.body||{};
 if(typeof player1Id!=='string'||typeof player2Id!=='string'||player1Id===player2Id||!Number.isInteger(score1)||!Number.isInteger(score2)||score1<0||score2<0||score1>999||score2>999||score1===score2||!Number.isInteger(round)||round<1||round>100)return err(res,'Resultado inválido');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const tour=(await client.query('SELECT id,status FROM tournaments WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
  if(!tour||tour.status==='finished'){await client.query('ROLLBACK');return err(res,'Torneio inexistente ou finalizado',404)}
  const members=(await client.query('SELECT user_id FROM tournament_participants WHERE tournament_id=$1 AND user_id=ANY($2::uuid[])',[req.params.id,[player1Id,player2Id]])).rows;
  if(members.length!==2){await client.query('ROLLBACK');return err(res,'Os dois jogadores precisam estar inscritos')}
  const winnerId=score1>score2?player1Id:player2Id;
  const loserId=score1>score2?player2Id:player1Id;
  const match=(await client.query(`INSERT INTO tournament_matches(tournament_id,player1_id,player2_id,winner_id,score_p1,score_p2,round,played_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *`,[req.params.id,player1Id,player2Id,winnerId,score1,score2,round])).rows[0];
  await client.query("UPDATE tournaments SET status='ongoing' WHERE id=$1 AND status='open'",[req.params.id]);
  await client.query(`INSERT INTO rankings(user_id,points,wins,games) VALUES($1,10,1,1) ON CONFLICT(user_id) DO UPDATE SET points=rankings.points+10,wins=rankings.wins+1,games=rankings.games+1`,[winnerId]);
  await client.query(`INSERT INTO rankings(user_id,losses,games) VALUES($1,1,1) ON CONFLICT(user_id) DO UPDATE SET losses=rankings.losses+1,games=rankings.games+1`,[loserId]);
  await client.query('COMMIT');
  res.status(201).json({match});
 }catch(e){await client.query('ROLLBACK');if(e.code==='23505')return err(res,'Partida já registrada nesta rodada',409);throw e}finally{client.release()}
}));
app.patch('/api/tournaments/:id/finish',auth,admin,run(async(req,res)=>{
 const r=await q("UPDATE tournaments SET status='finished' WHERE id=$1 AND status IN ('open','ongoing') RETURNING id",[req.params.id]);
 if(!r.rows.length)return err(res,'Torneio não encontrado ou já finalizado',404);
 res.json({ok:true});
}));
app.post('/api/tournaments',auth,admin,run(async(req,res)=>{const {name,game,description='',maxPlayers=16}=req.body;if(!required(name,200)||!required(game,100)||typeof description!=='string'||description.length>5000||!Number.isInteger(maxPlayers)||maxPlayers<2||maxPlayers>128)return err(res,'Torneio inválido');const r=await q('INSERT INTO tournaments(creator_id,name,game,description,max_players) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.id,name,game,description,maxPlayers]);res.status(201).json({tournament:r.rows[0]})}));
app.post('/api/tournaments/:id/join',auth,run(async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const t=(await client.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!t||t.status!=='open'){await client.query('ROLLBACK');return err(res,'Inscrições encerradas')}const count=await client.query('SELECT count(*)::int n FROM tournament_participants WHERE tournament_id=$1',[req.params.id]);if(count.rows[0].n>=t.max_players){await client.query('ROLLBACK');return err(res,'Torneio lotado')}await client.query('INSERT INTO tournament_participants(tournament_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,req.user.id]);await client.query('COMMIT');res.json({ok:true})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}));
app.delete('/api/tournaments/:id/join',auth,run(async(req,res)=>{
 const r=await q(`DELETE FROM tournament_participants p USING tournaments t
 WHERE p.tournament_id=t.id AND t.id=$1 AND p.user_id=$2 AND t.status='open' RETURNING p.id`,
 [req.params.id,req.user.id]);
 if(!r.rows.length)return err(res,'Inscrição não encontrada ou torneio já iniciado',404);
 res.json({ok:true});
}));
// Pedra-papel-tesoura: resultado decidido pelo servidor, nunca pelo cliente.
const gameLimit=rateLimit({windowMs:60*1000,limit:30,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false});
app.post('/api/minigames/rps',auth,gameLimit,run(async(req,res)=>{
 const choice=req.body?.choice;
 if(!rpsChoices.includes(choice))return err(res,'Jogada inválida');
 const computer=rpsChoices[crypto.randomInt(3)];const {result,points:gained}=scoreRps(choice,computer);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`INSERT INTO rankings(user_id,points,wins,losses,games) VALUES($1,$2,$3,$4,1)
    ON CONFLICT(user_id) DO UPDATE SET points=rankings.points+$2,wins=rankings.wins+$3,losses=rankings.losses+$4,games=rankings.games+1`,
    [req.user.id,gained,result==='win'?1:0,result==='loss'?1:0]);
  await client.query('INSERT INTO minigame_scores(user_id,game,score) VALUES($1,$2,$3)',[req.user.id,'rps',gained]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 res.json({choice,computer,result,points:gained});
}));
// Clipes compartilhados por URL HTTPS, sem upload de vídeo pesado para a VPS.
app.get('/api/clips',auth,run(async(req,res)=>{
 const r=await q(`SELECT c.*,u.username,u.display_name FROM clips c JOIN users u ON u.id=c.author_id ORDER BY c.created_at DESC LIMIT 100`);
 res.json({clips:r.rows});
}));
app.post('/api/clips',auth,contentLimit,run(async(req,res)=>{
 const {title,description='',videoUrl,game=''}=req.body;
 if(!required(title,200)||typeof description!=='string'||description.length>2000||typeof game!=='string'||game.length>100)return err(res,'Dados do clipe inválidos');
 let url;try{url=new URL(videoUrl)}catch{return err(res,'URL inválida')}
 if(url.protocol!=='https:'||url.username||url.password||!url.hostname.includes('.'))return err(res,'Use um link HTTPS válido');
 const r=await q('INSERT INTO clips(author_id,title,description,video_url,game) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.id,title.trim(),description,url.href,game]);
 res.status(201).json({clip:r.rows[0]});
}));
app.delete('/api/clips/:id',auth,run(async(req,res)=>{
 const r=await q('DELETE FROM clips WHERE id=$1 AND (author_id=$2 OR $3=true) RETURNING id',[req.params.id,req.user.id,['owner','admin','moderator'].includes(req.user.role)]);
 if(!r.rows.length)return err(res,'Clipe não encontrado ou sem permissão',404);
 res.json({ok:true});
}));
app.get('/api/lives',auth,run(async(req,res)=>res.json({lives:(await q('SELECT * FROM community_lives ORDER BY created_at DESC')).rows})));
app.post('/api/lives',auth,admin,run(async(req,res)=>{const {name,streamer,platform,url,game=''}=req.body;if(!required(name,120)||!required(streamer,80)||!['twitch','youtube','kick','other'].includes(platform)||!/^https:\/\//i.test(url||''))return err(res,'Live inválida');const r=await q('INSERT INTO community_lives(name,streamer,platform,url,game,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[name,streamer,platform,url,game,req.user.id]);res.status(201).json({live:r.rows[0]})}));
app.delete('/api/lives/:id',auth,admin,run(async(req,res)=>{await q('DELETE FROM community_lives WHERE id=$1',[req.params.id]);res.json({ok:true})}));
app.get('/api/announcements',auth,run(async(req,res)=>res.json({announcements:(await q('SELECT a.*,u.username FROM announcements a JOIN users u ON u.id=a.author_id ORDER BY a.pinned DESC,a.created_at DESC LIMIT 20')).rows})));
app.post('/api/announcements',auth,admin,run(async(req,res)=>{if(!required(req.body.title,200)||!required(req.body.content,10000))return err(res,'Aviso inválido');const r=await q('INSERT INTO announcements(author_id,title,content) VALUES($1,$2,$3) RETURNING *',[req.user.id,req.body.title,req.body.content]);res.status(201).json({announcement:r.rows[0]})}));
// Credenciais TURN temporárias para coturn em modo use-auth-secret.
// A chave compartilhada nunca é enviada ao navegador.
app.get('/api/turn',auth,run(async(req,res)=>{
 const turnUrl=process.env.TURN_URL,secret=process.env.TURN_SHARED_SECRET;
 if(!turnUrl||!secret)return res.json({iceServers:[{urls:'stun:stun.l.google.com:19302'}],turnConfigured:false});
 if(!/^turns?:[a-zA-Z0-9.-]+(?::[0-9]{1,5})?(?:\?transport=(?:tcp|udp))?$/.test(turnUrl))return err(res,'Servidor TURN mal configurado',503);
 const expires=Math.floor(Date.now()/1000)+3600;
 const username=`${expires}:${req.user.id}`;
 const credential=crypto.createHmac('sha1',secret).update(username).digest('base64');
 const turnUrls=turnUrl.startsWith('turn:')&&!turnUrl.includes('?')?[turnUrl+'?transport=udp',turnUrl+'?transport=tcp']:[turnUrl];
 res.json({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:turnUrls,username,credential}],turnConfigured:true});
}));
// Denúncias de conteúdo/membros para análise da moderação.
app.post('/api/reports',auth,reportLimit,run(async(req,res)=>{
 const {targetType,targetId,reason}=req.body||{};
 if(!['user','message','post','clip'].includes(targetType)||typeof targetId!=='string'||!required(reason,200))return err(res,'Denúncia inválida');
 const checks={user:'SELECT id FROM users WHERE id=$1',message:'SELECT id FROM messages WHERE id=$1 AND deleted_at IS NULL',post:'SELECT id FROM forum_posts WHERE id=$1 AND deleted_at IS NULL',clip:'SELECT id FROM clips WHERE id=$1'};
 const found=await q(checks[targetType],[targetId]);
 if(!found.rows.length)return err(res,'Conteúdo não encontrado',404);
 const r=await q('INSERT INTO reports(reporter_id,target_type,target_id,reason) VALUES($1,$2,$3,$4) RETURNING id',[req.user.id,targetType,targetId,reason.trim()]);
 res.status(201).json({report:r.rows[0]});
}));
app.get('/api/reports',auth,mod,run(async(req,res)=>{
 const r=await q(`SELECT r.*,u.username reporter_name FROM reports r JOIN users u ON u.id=r.reporter_id ORDER BY r.resolved,r.created_at DESC LIMIT 200`);
 res.json({reports:r.rows});
}));
app.patch('/api/reports/:id/resolve',auth,mod,run(async(req,res)=>{
 const r=await q('UPDATE reports SET resolved=true WHERE id=$1 AND resolved=false RETURNING id',[req.params.id]);
 if(!r.rows.length)return err(res,'Denúncia não encontrada ou já resolvida',404);
 res.json({ok:true});
}));
// Status real de servidores Minecraft Java Edition. Comandos de energia são opcionais,
// restritos a owner/admin e enviados à API client do painel Pterodactyl configurado pelo dono.
const pteroReady=()=>Boolean(process.env.PTERO_API_URL&&process.env.PTERO_SERVER_ID&&process.env.PTERO_API_KEY);
app.get('/api/minecraft',auth,run(async(req,res)=>{
 const host=process.env.MINECRAFT_HOST,port=Number(process.env.MINECRAFT_PORT||25565);
 const manage=['owner','admin'].includes(req.user.role)&&pteroReady();
 if(!host)return res.json({configured:false,manage,message:'Defina MINECRAFT_HOST e MINECRAFT_PORT no backend/.env para consultar o servidor Minecraft Java.'});
 try{const status=await minecraftStatus(host,port);return res.json({configured:true,manage,host,port,...status})}
 catch{return res.json({configured:true,manage,host,port,online:false,players:0,maxPlayers:0})}
}));
const powerLimit=rateLimit({windowMs:60*1000,limit:6,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false});
app.post('/api/minecraft/power',auth,admin,powerLimit,run(async(req,res)=>{
 const signal=req.body?.signal;
 if(!['start','stop','restart'].includes(signal))return err(res,'Comando inválido');
 if(!pteroReady())return err(res,'Painel Minecraft não configurado',503);
 let base;
 try{base=new URL(process.env.PTERO_API_URL)}catch{return err(res,'URL do painel inválida',503)}
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)return err(res,'Painel exige HTTPS seguro',503);
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(process.env.PTERO_SERVER_ID))return err(res,'ID do servidor inválido',503);
 const uri=new URL('/api/client/servers/'+process.env.PTERO_SERVER_ID+'/power',base);
 const response=await fetch(uri,{method:'POST',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+process.env.PTERO_API_KEY,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({signal})});
 if(!response.ok)return err(res,'O painel recusou o comando ('+response.status+')',502);
 try{await q('INSERT INTO minecraft_logs(action,performed_by) VALUES($1,$2)',[signal,req.user.id])}
 catch(e){console.error('Não foi possível registrar ação Minecraft:',e)}
 res.json({ok:true,signal});
}));
const voiceRooms=new Map();
const onlineSessions=new Map();
async function setPresence(userId,status){
 try{
  await q('UPDATE users SET status=$1,last_seen_at=CASE WHEN $1=\'offline\' THEN now() ELSE last_seen_at END WHERE id=$2',[status,userId]);
  io.emit('presence:update',{userId,status});
 }catch(e){console.error('Falha ao atualizar presença:',e.message)}
}

io.use(async(socket,next)=>{try{socket.user=await currentUser(socket.handshake.auth.token);next()}catch{next(new Error('Não autenticado'))}});
io.on('connection',socket=>{const user=socket.user;socket.join('user:'+user.id);const recentMessages=[];let lastTyping=0;
 const active=(onlineSessions.get(user.id)||0)+1;onlineSessions.set(user.id,active);if(active===1)setPresence(user.id,'online');
 const activeCheck=setInterval(async()=>{try{const latest=await q('SELECT member_status FROM users WHERE id=$1',[user.id]);if(latest.rows[0]?.member_status!=='active')socket.disconnect(true)}catch{socket.disconnect(true)}},60000);activeCheck.unref?.();
 socket.on('channel:join',async({channelId}={})=>{try{const r=await q('SELECT id FROM channels WHERE id=$1 AND type IN (\'text\',\'announcement\') AND is_private=false',[channelId]);if(r.rows.length)socket.join('channel:'+channelId)}catch{}});
 socket.on('channel:leave',({channelId}={})=>{if(channelId)socket.leave('channel:'+channelId)});
 socket.on('message:send',async({channelId,content,replyToId}={},ack)=>{try{const now=Date.now();while(recentMessages.length&&now-recentMessages[0]>60000)recentMessages.shift();if(recentMessages.length>=60)throw Error('Muitas mensagens. Aguarde um minuto.');recentMessages.push(now);if(!required(content,2000)||typeof channelId!=='string')throw Error('Mensagem ou canal inválido');const allowed=await q("SELECT id FROM channels WHERE id=$1 AND type='text' AND is_private=false",[channelId]);if(!allowed.rows.length)throw Error('Canal indisponível');socket.join('channel:'+channelId);const r=await q(`INSERT INTO messages(channel_id,sender_id,content,reply_to_id) SELECT c.id,$2,$3,$4 FROM channels c WHERE c.id=$1 AND c.type='text' AND c.is_private=false RETURNING *`,[channelId,user.id,content.trim(),replyToId||null]);if(!r.rows.length)throw Error('Canal inválido');const message={...r.rows[0],user_id:user.id,username:user.username,display_name:user.display_name,avatar_url:user.avatar_url,role:user.role};io.to('channel:'+channelId).emit('message:new',{channelId,message});ack?.({ok:true,message})}catch(e){ack?.({ok:false,error:e.message})}});
 socket.on('message:typing',({channelId}={})=>{if(Date.now()-lastTyping<1500)return;lastTyping=Date.now();if(socket.rooms.has('channel:'+channelId))socket.to('channel:'+channelId).emit('message:typing',{channelId,username:user.username})});
 // WebRTC: sinalização somente entre participantes da mesma sala, max 8 participantes.
 socket.on('voice:join',async({channelId}={},ack)=>{try{const r=await q("SELECT id FROM channels WHERE id=$1 AND type='voice' AND is_private=false",[channelId]);if(!r.rows.length)throw Error('Sala inválida');const room='voice:'+channelId;if(socket.data.voiceRoom)leaveVoice(socket);const peers=[...(voiceRooms.get(room)||new Map()).entries()].map(([id,p])=>({socketId:id,username:p.username}));if(peers.length>=8)throw Error('Sala cheia (máximo 8)');if(!voiceRooms.has(room))voiceRooms.set(room,new Map());voiceRooms.get(room).set(socket.id,{username:user.username});socket.data.voiceRoom=room;socket.join(room);ack?.({ok:true,peers});socket.to(room).emit('voice:peer-joined',{socketId:socket.id,username:user.username})}catch(e){ack?.({ok:false,error:e.message})}});
 function leaveVoice(s){const room=s.data.voiceRoom;if(!room)return;s.leave(room);const peers=voiceRooms.get(room);peers?.delete(s.id);if(!peers?.size)voiceRooms.delete(room);s.to(room).emit('voice:peer-left',{socketId:s.id});s.data.voiceRoom=null}
 socket.on('voice:leave',()=>leaveVoice(socket));
 socket.on('webrtc:signal',({to,data}={})=>{if(typeof to!=='string'||!data||typeof data!=='object')return;let size=0;try{size=JSON.stringify(data).length}catch{return}if(size>25000)return;const target=io.sockets.sockets.get(to);if(target&&socket.data.voiceRoom&&target.data.voiceRoom===socket.data.voiceRoom)target.emit('webrtc:signal',{from:socket.id,data})});
 socket.on('disconnect',()=>{clearInterval(activeCheck);leaveVoice(socket);const remaining=Math.max(0,(onlineSessions.get(user.id)||1)-1);if(remaining)onlineSessions.set(user.id,remaining);else{onlineSessions.delete(user.id);setPresence(user.id,'offline')}});
});
app.use((e,req,res,next)=>{console.error(e);if(e.code==='22P02'||e.code==='23503')return err(res,'ID ou referência inválida');res.status(500).json({error:'Erro interno'})});
const port=Number(process.env.PORT||3001);
async function start(){
  // Conexões Socket.IO não sobrevivem reinício do processo. Limpe estados antigos.
  await q("UPDATE users SET status='offline',last_seen_at=now() WHERE status <> 'offline'");
  server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log('FABUZADA API ouvindo na porta',port));
}
start().catch(async e=>{console.error('Falha ao iniciar API:',e);await pool.end();process.exitCode=1});
const shutdown=()=>{io.close();server.close(()=>pool.end().then(()=>process.exit(0)).catch(()=>process.exit(1)));};
process.once('SIGTERM',shutdown);
process.once('SIGINT',shutdown);
