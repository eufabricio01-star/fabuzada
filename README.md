# FABUZADA — Plataforma Gamer

Projeto para uma comunidade privada de amigos: frontend Next.js 14, backend Express/Socket.IO, PostgreSQL e chamadas WebRTC. Os arquivos foram reconstruídos a partir do material da conversa.

> **Status de qualidade:** o código passou por verificações de sintaxe e testes unitários do protocolo de status Minecraft. **Não foi possível executar `npm install`, o build completo do Next.js, os testes com PostgreSQL real nem uma chamada WebRTC entre usuários neste ambiente.** Portanto, não afirme que esta versão está homologada ou funcionando em produção antes dos testes abaixo.

## Funcionalidades

| Área | Situação |
| --- | --- |
| Login/cadastro, senhas bcrypt, JWT, papéis e moderação | Implementada no código |
| Cadastro por código de convite opcional | Implementado (`INVITE_CODE`) |
| Chat de texto e mensagens privadas persistentes | Implementado (Socket.IO / PostgreSQL) |
| Salas de voz, microfone, tela e tentativa de áudio da tela | WebRTC mesh implementado, **pendente teste entre navegadores** |
| TURN com credenciais temporárias | API e instalador coturn disponíveis |
| Fórum, comentários, curtidas, exclusão/moderação | Implementado |
| Eventos, inscrições, enquetes e votos | Implementado |
| Torneios, ranking e inscrições | Inscrições, participantes, registro de resultados, pontuação, encerramento; chaveamento automático não incluído |
| Minigames | Jogo da velha/quiz locais; pedra-papel-tesoura com pontuação persistida no servidor |
| Lives e clipes | Links publicados; sem transmissão própria, detecção de status ou upload de vídeo |
| Amizades e pedidos, lista de membros, presença e notificações | Implementado |
| Servidor Minecraft Java | Consulta de status/participantes; iniciar/parar/reiniciar opcional via Pterodactyl Client API |
| Administração | Papéis, suspensão/banimento, canais, avisos e denúncias |

## Rodando localmente

**Pré-requisitos:** Node.js 22, PostgreSQL 14+ e portas 3000/3001 locais.

1. Crie um banco PostgreSQL vazio e um usuário autorizado a criar tabelas e as extensões `uuid-ossp` e `pgcrypto`.
2. Copie `backend/.env.example` para `backend/.env` e ajuste `DATABASE_URL`, `JWT_SECRET` (mínimo 32 caracteres), `OWNER_USERNAME`, `OWNER_EMAIL` e `OWNER_PASSWORD`. Para cadastro fechado por convite, defina também `INVITE_CODE` com código secreto aleatório.
3. Execute, na pasta `backend`, `npm install`, `npm run db:migrate`, `npm run db:seed` e `npm run dev`.
4. Copie `frontend/.env.example` para `frontend/.env.local`; na pasta `frontend`, execute `npm install` e `npm run dev`.
5. Abra `http://localhost:3000`, faça login com a conta owner e teste as abas.

O backend escuta em `127.0.0.1:3001` por padrão. Migrações são versionadas, transacionais e possuem verificação de checksum; **faça backup** antes de aplicar novas versões em bancos com dados. Bancos legados sem histórico de migração exigem adaptação manual.

## Instalando numa VPS Ubuntu

1. Aponte um domínio ao IPv4 da VPS. Abra portas 80/443 no firewall do provedor; HTTPS é obrigatório para capturar microfone e tela fora de `localhost`.
2. Transfira a pasta do projeto para a VPS. Na raiz, execute `chmod +x deploy-vps.sh && ./deploy-vps.sh` com um usuário que tenha `sudo` (não execute como root).
3. O script instala Node.js, PostgreSQL, Nginx, PM2 e Certbot, cria credenciais iniciais em `backend/.env` e **pausa** para configuração do email e senha do owner. Configure essas variáveis antes de responder `sim`.
4. No primeiro deploy, o instalador gera um código de convite em `backend/.env`. Para convidar amigos, localize a linha `INVITE_CODE=...` e compartilhe **somente esse código**, nunca o `.env` inteiro.
5. No final, verifique `pm2 list`, `pm2 logs fabuzada-api`, `pm2 logs fabuzada-web`, `sudo nginx -t`, `curl -fsS https://SEU_DOMINIO/api/health` e `sudo systemctl status nginx`.
6. Confirme que o site retorna a tela de login, crie um usuário com código de convite, envie mensagens e teste voz/tela em dois dispositivos **de redes diferentes**.

Para reinício após reboot, configure o startup do PM2 no usuário de deploy (`pm2 startup`, seguindo o comando `sudo` que ele mostrar, e depois `pm2 save`). Não exponha a porta 3001 diretamente à internet.

### TURN para voz e compartilhamento de tela

O uso só de STUN não conecta em todas as redes. Para habilitar relay TURN no mesmo VPS:

1. Crie o registro DNS `turn.seudominio.com` para a VPS. Depois do primeiro deploy, execute `./setup-turn.sh` na raiz do projeto.
2. Informe esse domínio e o IPv4 público. O script instala coturn com autenticação temporária (`use-auth-secret`), reinicia a API e abre as portas locais.
3. **Abra também no firewall externo do provedor**: UDP 3478, TCP 3478 e UDP 49160–49200. Provedores com NAT adicional podem exigir configuração manual de `external-ip`.
4. Para redes extremamente restritas é possível precisar de TURN/TLS pela porta 443, não incluído na instalação simples.
5. TURN aumenta banda e custos da VPS. Este chat é **mesh** para até oito conexões simultâneas por sala; para mais gente será necessário um SFU dedicado (por exemplo, LiveKit/mediasoup).

O segredo do TURN fica apenas no backend e no coturn; o frontend recebe usuário/senha temporários autenticados pela rota `/api/turn`. A duração das credenciais é uma hora; reconexões posteriores usam credenciais novas. A configuração padrão é apenas STUN: sem executar `setup-turn.sh`, algumas redes não conseguirão se conectar por WebRTC.

### Minecraft Java

Adicione `MINECRAFT_HOST=mc.seudominio.com` e `MINECRAFT_PORT=25565` ao `backend/.env`, reinicie a API e abra a aba **Minecraft**. O servidor Minecraft precisa responder ao handshake de status Java Edition. Para permitir aos administradores **ligar, desligar e reiniciar** o Minecraft, configure `PTERO_API_URL` (URL HTTPS do painel Pterodactyl), `PTERO_SERVER_ID` (identificador curto) e `PTERO_API_KEY` (chave de API **Client**, com acesso ao servidor). O backend envia comandos pela API do painel e registra ações em `minecraft_logs`; a chave nunca é enviada ao navegador. Se você usa outro painel ou host sem API Pterodactyl, o controle remoto não estará disponível. Servidores Bedrock não são compatíveis com a verificação de status Java.

## Verificações locais e limitações

Execute `./scripts/check-project.sh` para verificar sintaxe, scripts shell, TSX (quando houver TypeScript), referências cruzadas e os testes unitários do protocolo Minecraft/RPS. Os testes unitários também rodam com `cd backend && npm test`. Instale as dependências e execute `cd frontend && npm run build` e `npx tsc --noEmit` antes do deploy. Teste a migração num PostgreSQL real e chamadas WebRTC entre navegadores. O script `scripts/e2e-api.js` cobre REST, fluxo de usuários e sinalização de Socket.IO, **mas altera o banco** e exige `E2E_ALLOW_WRITE=yes` com banco isolado. A workflow `.github/workflows/ci.yml` executa instalação, TypeScript, build, migrações e testes e2e em PostgreSQL descartável quando este projeto é enviado ao GitHub; o fluxo ainda precisa ser executado numa plataforma que consiga baixar pacotes npm.

**Não inclua em backups públicos**: `backend/.env`, `frontend/.env.local`, segredos do coturn, dumps do PostgreSQL ou tokens JWT. Os minigames locais não atualizam o ranking; apenas as partidas de pedra-papel-tesoura processadas pelo backend geram pontos na versão atual.

## Backups

Execute `./backup-db.sh` após instalar o PostgreSQL. Ele salva um `pg_dump` compactado no diretório `$HOME/fabuzada-backups` (fora do site, permissões privadas) e mantém as 14 cópias mais recentes. Para agendar diariamente às 4h, adicione no crontab do usuário de deploy uma entrada como `0 4 * * * /CAMINHO/DO/PROJETO/backup-db.sh >> "$HOME/fabuzada-backup.log" 2>&1`. Teste a restauração em banco separado antes de confiar nos backups.
