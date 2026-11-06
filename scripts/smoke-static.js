// Verificações de integração estáticas que não dependem de internet nem banco.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const frontend=read('frontend/src/app/dashboard/page.tsx');
const backend=read('backend/src/index.js');
const schema=read('backend/schema.sql');
const migrator=read('backend/src/migrate.js');
for(const route of ['/api/auth/login','/api/auth/register','/api/users','/api/forum','/api/events','/api/polls','/api/ranking','/api/tournaments','/api/clips','/api/friends','/api/dms','/api/servers','/api/lives','/api/minecraft','/api/minigames/rps','/api/turn','/api/minecraft/power','/api/reports','/api/notifications']){
  assert(backend.includes(route),`Rota ausente no backend: ${route}`);
}
for(const table of ['users','rankings','messages','channels','servers','forum_posts','tournaments','events','polls','friendships','direct_messages','clips','community_lives']){
 assert(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table}\\b`).test(schema),`Tabela ausente: ${table}`);
}
for(const id of ['inicio','chat','forum','ranking','tournaments','events','minigames','lives','members','friends','dms','clips','minecraft','profile','admin']){
 assert(frontend.includes(`tab==='${id}'`),`Aba sem implementação: ${id}`);
}
assert(migrator.includes('schema_migrations')&&migrator.includes('checksum')&&migrator.includes('ROLLBACK'),'Migrações transacionais não configuradas');
assert(backend.includes('voice:join')&&backend.includes('webrtc:signal'),'Sinalização WebRTC ausente');
assert(frontend.includes('presence:update')&&backend.includes('presence:update'),'Presença em tempo real ausente');
console.log('OK: rotas, páginas, tabelas, sinalização e migrações com referências coerentes.');
