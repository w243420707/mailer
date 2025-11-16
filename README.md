# Mailer Web UI

提供一个简单的 Web 界面用于管理 `config.toml`，上传 Excel 并触发发送。服务默认监听端口 `6253`。

快速运行（本地机器，需要 Docker）:

```bash
docker build -t mailer .
docker run -p 6253:6253 -v $(pwd):/app mailer
```

使用 docker-compose:

```bash
docker-compose up -d --build
```

VPS 一键安装（Linux）：

```bash
curl -fsSL https://raw.githubusercontent.com/w243420707/mailer/main/install.sh | bash
```

Web 界面:

- GET `/`：管理页面
- GET `/api/config`：获取配置
- POST `/api/config`：保存配置（JSON 格式）
- POST `/api/upload`：上传 Excel 文件（字段 `file`）并自动更新 `excel_file`
- POST `/api/send`：异步触发发送（后台线程）
- GET `/api/last_result`：查询上次发送结果
 
提示：脚本会自动安装 Docker 与 docker compose 插件（或检测已安装的 docker-compose），开放 6253 端口（若检测到 UFW/firewalld），然后将仓库克隆到 `/opt/mailer` 并启动。
