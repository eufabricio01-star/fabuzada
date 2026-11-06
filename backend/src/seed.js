require('dotenv').config();
const {Pool}=require('pg'); const bcrypt=require('bcryptjs');
(async()=>{const pool=new Pool({connectionString:process.env.DATABASE_URL});try{
const {OWNER_USERNAME:u,OWNER_EMAIL:e,OWNER_PASSWORD:p}=process.env;
if(!u||!e||!p||p==='SET_A_STRONG_PASSWORD')throw Error('Configure OWNER_USERNAME, OWNER_EMAIL e OWNER_PASSWORD');
const hash=await bcrypt.hash(p,12);
// Nunca promova automaticamente uma conta cadastrada por terceiros a owner.
const existing=await pool.query('SELECT id,role,email FROM users WHERE lower(username)=lower($1) OR lower(email)=lower($2)',[u,e]);
let id;
if(existing.rows.length){
 if(existing.rows.length!==1||existing.rows[0].role!=='owner'||existing.rows[0].email.toLowerCase()!==e.toLowerCase())throw Error('Conflito com owner existente: não é seguro promover automaticamente. Corrija manualmente.');
 id=existing.rows[0].id;
} else {
 const result=await pool.query(`INSERT INTO users(username,email,password_hash,display_name,role) VALUES($1,$2,$3,$1,'owner') RETURNING id`,[u,e,hash]);
 id=result.rows[0].id;
}

const sr=await pool.query(`INSERT INTO servers(name,description,owner_id,is_default) SELECT 'FABUZADA','Comunidade gamer',$1,true WHERE NOT EXISTS(SELECT 1 FROM servers WHERE is_default=true) RETURNING id`,[id]);
const serverId=sr.rows[0]?.id||(await pool.query('SELECT id FROM servers WHERE is_default=true LIMIT 1')).rows[0].id;
for(const [name,type] of [['geral','text'],['clips','text'],['campeonatos','text'],['Bate-papo','voice'],['Jogando','voice']])await pool.query('INSERT INTO channels(server_id,name,type) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM channels WHERE server_id=$1 AND name=$2)',[serverId,name,type]);
await pool.query('INSERT INTO rankings(user_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);console.log('Owner e canais configurados:',u);
}finally{await pool.end()}})().catch(e=>{console.error(e);process.exit(1)});
