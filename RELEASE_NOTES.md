# FABUZADA — Estado da entrega

## Código incluído

- Frontend Next.js 14 responsivo com páginas de início, login, cadastro e dashboard com abas.
- Backend Express e PostgreSQL (migrações versionadas, transações, seed seguro do owner).
- Chat e DMs, presença, histórico paginado, salas de voz WebRTC e compartilhamento de tela.
- STUN e TURN opcional via coturn, com credenciais temporárias geradas pelo backend.
- Cadastro por convite, perfis com avatar via URL, amizades, notificações e moderação/denúncias.
- Fórum, comentários, curtidas e exclusões moderadas.
- Torneios: inscrições, cancelamento, resultado de partidas e atualização de ranking, encerramento.
- Minigames locais e pedra-papel-tesoura com escolha aleatória do servidor, pontuação persistente.
- Enquetes, eventos, presença, avisos, links de lives e clipes.
- Consulta ao status Minecraft Java; comandos opcionais via Pterodactyl Client API.
- Deploy Nginx/HTTPS/PM2, setup TURN, backup PostgreSQL, CI GitHub Actions e testes e2e.

## Verificações feitas neste ambiente

- `node --check` de todos os módulos JavaScript do backend.
- `bash -n` dos scripts shell de deploy, TURN e backups.
- Transpilação de 8 arquivos TS/TSX com compilador TypeScript global: sem erros de sintaxe.
- Verificações estáticas de referência das rotas, tabelas e abas.
- 6 testes unitários Node.js executados e aprovados (status Minecraft TCP e regras de pedra-papel-tesoura).

## Testes que continuam obrigatórios antes de liberar para os amigos

- Dependências npm e `next build` **não rodaram neste ambiente** porque o registry npm não estava acessível (`Could not resolve host: registry.npmjs.org`).
- PostgreSQL não estava instalado aqui; migrações e fluxo real de banco **não foram executados**.
- CI `/.github/workflows/ci.yml` está preparado, mas não foi executado no GitHub nesta sessão.
- Salas de voz e tela devem ser testadas em dois navegadores reais, especialmente em redes distintas e com TURN.
- HTTPS, DNS, servidor Pterodactyl e coturn exigem credenciais/acesso externos do proprietário.

O projeto está organizado para instalação e testes, **mas estas pendências impedem afirmar que está totalmente homologado em produção**.
