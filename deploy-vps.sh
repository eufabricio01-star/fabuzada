#!/usr/bin/env bash
set -euo pipefail
# Execute no diretório do projeto como usuário com sudo, em Ubuntu 22.04/24.04.
if [[ "$(id -u)" == 0 ]]; then echo 'Execute com usuário sudo (não root): sudo estará disponível'; exit 1; fi
if [[ ! -f backend/package.json || ! -f frontend/package.json ]]; then echo 'Execute a partir da raiz do projeto'; exit 1; fi
read -rp 'Seu domínio (ex: comunidade.exemplo.com): ' DOMAIN
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then echo 'Domínio inválido'; exit 1; fi
read -rp 'Email para certificado HTTPS: ' EMAIL
if [[ -z "$EMAIL" ]]; then echo 'Email obrigatório'; exit 1; fi
sudo apt-get update
sudo apt-get install -y curl nginx postgresql postgresql-contrib ufw certbot python3-certbot-nginx openssl
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo systemctl enable --now postgresql nginx
if ! command -v pm2 >/dev/null; then sudo npm install -g pm2; fi
DB_USER=fabuzada_app
DB_NAME=fabuzada_db
DB_PASS="$(openssl rand -hex 24)"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
 sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
else
 if [[ ! -f backend/.env ]]; then
  echo 'Usuário do banco já existe, mas backend/.env está ausente. Restaure o .env ou configure manualmente DATABASE_URL antes de repetir.'
  exit 1
 fi
 echo 'Banco existente detectado; preservando DATABASE_URL em backend/.env.'
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"; fi
if [[ ! -f backend/.env ]]; then
 SECRET="$(openssl rand -hex 48)"
 INVITE="$(openssl rand -hex 16)"
 cat > backend/.env <<VARS
PORT=3001
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET=${SECRET}
FRONTEND_ORIGIN=https://${DOMAIN}
OWNER_USERNAME=fabu
OWNER_EMAIL=CONFIGURE_EMAIL
OWNER_PASSWORD=CONFIGURE_SENHA
REGISTRATION_ENABLED=true
INVITE_CODE=${INVITE}
VARS
 chmod 600 backend/.env
fi
if [[ ! -f frontend/.env.local ]]; then
 cat > frontend/.env.local <<VARS
NEXT_PUBLIC_API_URL=https://${DOMAIN}/api
NEXT_PUBLIC_SOCKET_URL=https://${DOMAIN}
VARS
fi
echo 'ATENÇÃO: configure backend/.env (OWNER_EMAIL, OWNER_PASSWORD e DATABASE_URL) antes de prosseguir.'
read -rp 'Configurações prontas? [sim/N] ' OK
if [[ "$OK" != 'sim' ]]; then exit 0; fi
if grep -Eq '^OWNER_EMAIL=(CONFIGURE_EMAIL|owner@example.com)$|^OWNER_PASSWORD=(CONFIGURE_SENHA|SET_A_STRONG_PASSWORD)$' backend/.env; then
 echo 'Configure email e senha do owner antes de continuar.'; exit 1
fi
# VPS econômicas (1–2 GB) podem precisar de swap para compilar o Next.js.
RAM_KB=$(awk '/MemTotal:/ {print $2}' /proc/meminfo)
if [[ "$RAM_KB" -lt 3500000 ]] && ! swapon --noheadings --show=NAME | grep -q .; then
 echo 'Memória abaixo de 3,5 GB: tentando habilitar 2 GB de swap para o build...'
 if sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile; then
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
 else
  echo 'Aviso: swap indisponível nesta VPS. O build pode exigir mais RAM.'
 fi
fi
(cd backend && npm install && npm run db:migrate && npm run db:seed)
(cd frontend && npm install && NODE_OPTIONS=--max-old-space-size=2048 npm run build)
if [[ ! -f ecosystem.config.cjs ]]; then echo 'Arquivo PM2 não encontrado'; exit 1; fi
pm2 startOrReload ecosystem.config.cjs
pm2 save
# Garante que os processos iniciem após reinício da VPS.
sudo env PATH="$PATH" pm2 startup systemd -u "$(id -un)" --hp "$HOME"
pm2 save
sudo tee "/etc/nginx/sites-available/${DOMAIN}" >/dev/null <<NGINX
server {
 listen 80;
 server_name ${DOMAIN};
 client_max_body_size 2m;
 location /api/ { proxy_pass http://127.0.0.1:3001/api/; proxy_set_header Host \$host; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; }
 location /socket.io/ { proxy_pass http://127.0.0.1:3001/socket.io/; proxy_http_version 1.1; proxy_set_header Upgrade \$http_upgrade; proxy_set_header Connection "upgrade"; proxy_set_header Host \$host; proxy_read_timeout 3600s; }
 location / { proxy_pass http://127.0.0.1:3000; proxy_http_version 1.1; proxy_set_header Host \$host; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; }
}
NGINX
sudo ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
sudo nginx -t && sudo systemctl reload nginx
sudo ufw allow OpenSSH
# Não derrube a sessão SSH se a porta utilizada não for a padrão 22.
if [[ -n "${SSH_CONNECTION:-}" ]]; then
  read -r _ _ _ SSH_PORT <<< "$SSH_CONNECTION"
  if [[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]]; then sudo ufw allow "${SSH_PORT}/tcp"; fi
fi
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo certbot --nginx -d "$DOMAIN" --agree-tos -m "$EMAIL" --non-interactive --redirect
echo "Pronto: https://${DOMAIN}"
