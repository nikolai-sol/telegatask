#!/bin/bash
# Деплой telegatask на сервер TimeWeb
# Использование: ./scripts/deploy.sh
# Пароль root запросится при первом scp/ssh

set -e
SERVER="root@147.45.132.90"
REMOTE_DIR="/opt/telegatask"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# SSH на порту 2222 (TimeWeb)
SSH_OPTS="-o StrictHostKeyChecking=accept-new -p 2222"
export RSYNC_RSH="ssh $SSH_OPTS"

echo "Сервер: $SERVER (порт 2222) | Директория: $REMOTE_DIR"
echo ""

echo "==> 1. Проверка локальных файлов"
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  echo "Ошибка: .env не найден в $PROJECT_ROOT"
  exit 1
fi
if [ ! -f "$PROJECT_ROOT/serviceAccountKey.json" ]; then
  echo "Ошибка: serviceAccountKey.json не найден"
  exit 1
fi

echo "==> 2. Проверка портов и сервисов на сервере"
ssh $SSH_OPTS "$SERVER" "
  echo '--- Слушающие порты (VPN и др.) ---'
  ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null || true
  echo ''
  echo '--- Node.js ---'
  node -v 2>/dev/null || echo 'Node не установлен'
"

echo ""
echo "==> 3. Копирование файлов"
ssh $SSH_OPTS "$SERVER" "mkdir -p $REMOTE_DIR"
rsync -avz -e "ssh $SSH_OPTS" --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
  "$PROJECT_ROOT/" "$SERVER:$REMOTE_DIR/"
scp -P 2222 "$PROJECT_ROOT/.env" "$SERVER:$REMOTE_DIR/"
scp -P 2222 "$PROJECT_ROOT/serviceAccountKey.json" "$SERVER:$REMOTE_DIR/"

echo ""
echo "==> 4. Установка и запуск на сервере"
ssh $SSH_OPTS "$SERVER" "
  set -e
  cd $REMOTE_DIR

  # Node 18+ если нет
  if ! command -v node &>/dev/null; then
    echo 'Устанавливаем Node.js 20...'
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi

  # PM2
  npm install -g pm2 2>/dev/null || true

  npm install
  npm run build

  # Останавливаем старый если есть
  pm2 delete telegatask 2>/dev/null || true

  # Fix GOOGLE_APPLICATION_CREDENTIALS path на сервере
  sed -i 's|GOOGLE_APPLICATION_CREDENTIALS=.*|GOOGLE_APPLICATION_CREDENTIALS='"$REMOTE_DIR"'/serviceAccountKey.json|' .env

  # Запускаем
  pm2 start dist/index.js --name telegatask --update-env
  pm2 save
  pm2 startup systemd -u root --hp /root 2>/dev/null || true

  echo ''
  echo '==> Готово!'
  pm2 status
  echo ''
  echo 'Логи: pm2 logs telegatask'
"
