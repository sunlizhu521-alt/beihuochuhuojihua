# 腾讯云自动部署

本项目正式部署为 Node + SQLite + React 服务。GitHub Actions 会通过 SSH 上传代码，在服务器执行 `npm ci`、`npm run build`，然后用 PM2 启动或重载 Node 后端。

## 1. 服务器准备

```bash
ssh root@你的服务器IP
apt update
apt install -y nginx nodejs npm
npm install -g pm2
mkdir -p /www/wwwroot/gendanjindu /www/wwwroot/gendanjindu-data
```

如果部署用户不是 `root`，请把两个目录授权给部署用户。

## 2. Nginx 配置

创建 `/etc/nginx/conf.d/gendanjindu.conf`：

```nginx
server {
  listen 80;
  server_name 你的服务器IP或域名;

  location /api/ {
    proxy_pass http://127.0.0.1:4003;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /gendanjindu/ {
    proxy_pass http://127.0.0.1:4003;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
nginx -t
systemctl reload nginx
```

## 3. SSH Key

在本机生成部署专用密钥：

```bash
ssh-keygen -t ed25519 -C "github-actions-gendanjindu" -f gendanjindu_deploy_key
```

把 `gendanjindu_deploy_key.pub` 内容追加到服务器部署用户的 `~/.ssh/authorized_keys`，然后本机测试：

```bash
ssh -i gendanjindu_deploy_key root@你的服务器IP
```

## 4. GitHub Secrets

进入：

```text
https://github.com/sunlizhu521-alt/gendanjindu/settings/secrets/actions
```

新增：

```text
TENCENT_HOST=服务器IP或域名
TENCENT_USER=root
TENCENT_PORT=22
TENCENT_DEPLOY_PATH=/www/wwwroot/gendanjindu
TENCENT_DATA_DIR=/www/wwwroot/gendanjindu-data
TENCENT_APP_PORT=4003
TENCENT_SSH_KEY=部署私钥全文
ADMIN_INITIAL_PASSWORD=管理员初始强密码
```

`ADMIN_INITIAL_PASSWORD` 只用于首次初始化管理员 `孙立柱`，不会写入 GitHub 或前端构建产物。SQLite 中只保存 bcrypt 哈希。

## 5. 自动部署

推送到 `main` 会触发：

```text
.github/workflows/deploy-tencent.yml
```

也可以在 GitHub Actions 页面手动运行 `Deploy Tencent Cloud`。

部署成功后访问：

```text
http://你的服务器IP或域名/gendanjindu/
```

## 6. 数据安全

- SQLite 数据库保存在 `TENCENT_DATA_DIR`。
- 自动部署只替换应用代码，不删除 `TENCENT_DATA_DIR`。
- 不要把 `ADMIN_INITIAL_PASSWORD` 写进仓库文件。
