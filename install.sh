#!/usr/bin/env bash
# One-click installer for Linux VPS (Ubuntu/Debian/CentOS)
set -euo pipefail

REPO_URL="https://github.com/w243420707/mailer.git"
APP_DIR="/opt/mailer"
PORT="6253"

log(){ echo -e "\033[1;32m==> $*\033[0m"; }
warn(){ echo -e "\033[1;33m[警告] $*\033[0m"; }
err(){ echo -e "\033[1;31m[错误] $*\033[0m"; }

install_docker(){
  if command -v docker >/dev/null 2>&1; then
    log "Docker 已安装"
    return
  fi
  log "安装 Docker..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update; apt-get install -y ca-certificates curl gnupg lsb-release
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm -f get-docker.sh
    systemctl enable --now docker || true
  elif command -v yum >/dev/null 2>&1 || command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm -f get-docker.sh
    systemctl enable --now docker || true
  else
    err "无法自动安装 Docker，请手动安装 Docker 后重试"; exit 1
  fi
}

install_compose(){
  if docker compose version >/dev/null 2>&1; then
    log "已检测到 docker compose (插件)"
    echo "compose_cmd=docker compose"
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    log "已检测到 docker-compose (独立二进制)"
    echo "compose_cmd=docker-compose"
    return
  fi
  log "安装 Docker Compose 插件..."
  local arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch="x86_64";;
    aarch64|arm64) arch="aarch64";;
    armv7l) arch="armv7";;
  esac
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -SL "https://github.com/docker/compose/releases/download/v2.27.1/docker-compose-linux-${arch}" -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  if docker compose version >/dev/null 2>&1; then
    echo "compose_cmd=docker compose"
  else
    err "安装 docker compose 插件失败，请手动安装后重试"; exit 1
  fi
}

open_firewall(){
  if command -v ufw >/dev/null 2>&1; then
    if ufw status | grep -qi active; then
      log "UFW 开放端口 ${PORT}"
      ufw allow ${PORT}/tcp || warn "UFW 开放失败，可手动执行: ufw allow ${PORT}/tcp"
    fi
  elif command -v firewall-cmd >/dev/null 2>&1; then
    log "firewalld 开放端口 ${PORT}"
    firewall-cmd --permanent --add-port=${PORT}/tcp || true
    firewall-cmd --reload || true
  else
    warn "未检测到 UFW/firewalld，若访问受限请检查云厂商安全组"
  fi
}

sync_repo(){
  if [ -d "$APP_DIR/.git" ]; then
    log "更新仓库 $APP_DIR"
    git -C "$APP_DIR" pull --ff-only
  else
    log "克隆仓库到 $APP_DIR"
    mkdir -p "$(dirname "$APP_DIR")"
    git clone "$REPO_URL" "$APP_DIR"
  fi
}

compose_up(){
  local compose_cmd_var
  compose_cmd_var=$(install_compose)
  # shellcheck disable=SC2163
  eval "$compose_cmd_var"
  cd "$APP_DIR"
  log "使用 ${compose_cmd} 启动服务"
  ${compose_cmd} up -d --build
}

main(){
  install_docker
  open_firewall
  sync_repo
  compose_up
  log "部署完成。服务监听端口 ${PORT}"
  echo "访问: http://$(curl -s http://checkip.amazonaws.com || hostname -I | awk '{print $1}'):${PORT}"
}

main "$@"
