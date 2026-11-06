#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Validando sintaxe do backend..."
for file in backend/src/*.js; do node --check "$file"; done
echo "Validando scripts da VPS..."
bash -n deploy-vps.sh setup-turn.sh backup-db.sh
if [[ -d frontend/node_modules ]]; then
 echo "Verificando TypeScript com dependências locais..."
 (cd frontend && npx --no-install tsc --noEmit)
else
 echo "Sem node_modules: verificando sintaxe de TS/TSX com TypeScript global, se disponível."
 node - <<'JS'
const fs=require('node:fs'),path=require('node:path');let ts;
for(const p of [process.env.NODE_PATH && path.join(process.env.NODE_PATH,'typescript'),'/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript']){
 try{if(p){ts=require(p);break}}catch{}
}
if(!ts){console.log('TypeScript indisponível: verificação TSX pulada');process.exit(0)}
let count=0,errors=0;function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
 const file=path.join(dir,ent.name);
 if(ent.isDirectory())walk(file);
 else if(/\.tsx?$/.test(file)){
 count++;const r=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 for(const d of r.diagnostics||[]){errors++;console.error(file,ts.flattenDiagnosticMessageText(d.messageText,'\n'))}
 }
}}walk('frontend/src');console.log(`${count} arquivo(s) TS/TSX verificados: ${errors} erro(s) sintáticos`);process.exit(errors?1:0)
JS
fi
node scripts/smoke-static.js
echo "Executando testes unitários sem dependências externas..."
node --test backend/src/minecraft.test.js backend/src/rps.test.js
echo "Verificações estáticas concluídas. Testes de API e voz requerem ambiente de execução."
