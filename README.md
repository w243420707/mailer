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
- （已移除）`/api/upload`：Excel 上传功能已禁用，改为粘贴列表累积到 `recipients.txt`
- （不推荐）`/api/send`：基于 Excel 的发送入口仍保留后端兼容，但前端已隐藏。
- GET `/api/last_result`：查询上次发送结果
 - POST `/api/send_list`：从粘贴的邮箱列表发送（支持去重；参数：`recipients` 文本、`dedupe` 布尔、`subject` 可选、`html_body` 必填）
 
提示：脚本会自动安装 Docker 与 docker compose 插件（或检测已安装的 docker-compose），开放 6253 端口（若检测到 UFW/firewalld），然后将仓库克隆到 `/opt/mailer` 并启动。

## 基础认证（默认开启）

为了防止未授权访问，应用默认启用 HTTP Basic Auth，默认账户为：

- 用户名：`admin`
- 密码：`admin`

你可以通过环境变量覆盖默认凭据：

- `MAILER_AUTH_USER`: 用户名
- `MAILER_AUTH_PASS`: 密码

示例（docker-compose 覆盖）:

```yaml
services:
	mailer:
		environment:
			- MAILER_AUTH_USER=admin
			- MAILER_AUTH_PASS=change-me
```

未设置则使用默认 `admin/admin`。

## 直接粘贴邮箱列表发送（自动累积保存）

在“粘贴收件人列表发送”区域：
- 粘贴邮箱（支持换行/逗号/分号分隔）
- 勾选“去重”（按邮箱小写去重，保留顺序）
- 可填“主题”（留空使用配置中的 `setting.subject`）
- 填写“邮件内容（HTML）”，所有收件人将收到同一内容
- 点击“发送粘贴列表（后台）”，会先将收件人追加到项目根目录的 `recipients.txt`（按小写去重、保留顺序），然后仅对本次提交的收件人执行发送；可在“获取上次结果”查看统计

### recipients.txt 说明
- 路径：项目根目录 `recipients.txt`
- 格式：每行一个邮箱
- 行为：每次提交会读取现有列表，与新提交列表合并去重后整体重写保存，实现长期累积
