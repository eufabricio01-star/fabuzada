#!/usr/bin/env bash
set -euo pipefail
# Instala coturn com credenciais temporárias assinadas pela API FABUZADA.
# Execute na mesma VPS, após deploy-vps.sh, como usuário com sudo.
[[ $(id -u) -ne 0 ]] || { echo 'Use sua conta sudo, não root.'; exit 1; }
[[ -f backend/.env ]] || { echo 'Execute na raiz do projeto após o deploy inicial.'; exit 1; }
read -rp 'Domínio do TURN (ex: turn.exemplo.com): ' TURN_HOST
[[ "$TURN_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || { echo 'Domínio inválido'; exit 1; }
read -rp 'IP público da VPS (IPv4): ' PUBLIC_IP
[[ "$PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo 'IPv4 inválido'; exit 1; }
IFS=. read -r a b c d <<< "$PUBLIC_IP"
for octet in "$a" "$b" "$c" "$d"; do ((10#$octet <= 255)) || { echo 'IPv4 inválido'; exit 1; }; done
SECRET="$(openssl rand -hex 32)"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y coturn
sudo cp -a /etc/turnserver.conf "/etc/turnserver.conf.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
sudo tee /etc/turnserver.conf > /dev/null <<CFG
listening-port=3478
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=${SECRET}
realm=${TURN_HOST}
external-ip=${PUBLIC_IP}
min-port=49160
max-port=49200
no-loopback-peers
no-multicast-peers
no-cli
no-tls
no-dtls
CFG
if [[ -f /etc/default/coturn ]]; then
  sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
fi
sudo systemctl enable --now coturn
sudo systemctl restart coturn
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 49160:49200/udp
# Guarde a configuração do navegador fora do frontend; só a API conhece o segredo.
python3 - "$TURN_HOST" "$SECRET" <<'PY'
import sys
from pathlib import Path
p=Path('backend/.env')
existing=p.read_text().splitlines()
existing=[line for line in existing if not line.startswith(('TURN_URL=','TURN_SHARED_SECRET='))]
existing += ['TURN_URL=turn:'+sys.argv[1]+':3478','TURN_SHARED_SECRET='+sys.argv[2]]
p.write_text('\n'.join(existing)+'\n')
p.chmod(0o600)
PY
pm2 restart fabuzada-api --update-env
pm2 save
printf '\nTURN configurado: turn:%s:3478\nAbra UDP 3478, TCP 3478 e UDP 49160–49200 também no firewall do provedor da VPS.\n' "$TURN_HOST"
