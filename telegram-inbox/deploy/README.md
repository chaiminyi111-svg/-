# 阿里云部署指南

这套脚本面向 **阿里云轻量应用服务器 / ECS**，推荐系统 **Ubuntu 24.04**。

> Telegram 和 WhatsApp 在中国大陆地域通常无法稳定访问。请选择 **中国香港、新加坡、日本** 等海外地域；大陆地域只适合内网或纯演示。

## 一、购买时怎么选

| 项目 | 推荐 |
| --- | --- |
| 产品 | 轻量应用服务器 |
| 地域 | 中国香港 / 新加坡 / 日本 |
| 系统 | Ubuntu 24.04 |
| 配置 | 2 核 2G 起步，1 核 2G 也能跑小团队 |
| 带宽 | 3M 以上 |
| 登录方式 | 设置 root 密码，或使用 SSH 密钥 |

购买后在控制台完成：

1. 重置 root 密码；
2. 在「防火墙」中放行 `22`、`80`、`443`；
3. 记录服务器公网 IP。

## 二、上传代码

### 方式 A：服务器上 git clone

```bash
ssh root@你的公网IP
cd /opt
git clone https://github.com/chaiminyi111-svg/-.git
cd /opt/-/telegram-inbox
```

如果仓库是私有的，需要先配置 GitHub Token，或者使用方式 B。

### 方式 B：本机 scp 上传

在你电脑的项目目录执行：

```bash
scp -r telegram-inbox root@你的公网IP:/opt/
```

然后登录服务器：

```bash
ssh root@你的公网IP
cd /opt/telegram-inbox
```

## 三、一键配置

```bash
sudo bash deploy/setup.sh
```

脚本会自动：

- 安装 Node.js 24、Git、Nginx、编译依赖；
- 创建 `.env`（如果不存在）；
- 安装 npm 依赖；
- 创建 `inbox` 运行用户；
- 写入 systemd 服务并启动；
- 配置 Nginx 反向代理；
- 如果填了域名和邮箱，自动申请 Let's Encrypt HTTPS 证书；
- 做一次健康检查。

运行过程中会提示填写：

- 管理员账号 / 密码；
- Telegram Bot Token（可留空，之后在网页「渠道」里填）；
- 是否启用 WhatsApp 个人号；
- Telegram 个人号 `api_id` / `api_hash`（没有就留空）；
- 域名（没有就留空，用 IP 访问）。

## 四、访问

没有域名：

```text
http://服务器公网IP
```

有域名：

```text
http://你的域名
https://你的域名
```

首次登录使用脚本里设置的管理员账号。如果密码留空，查看启动日志中的自动生成密码：

```bash
journalctl -u telegram-inbox -n 50 --no-pager
```

## 五、常用命令

```bash
# 查看状态
systemctl status telegram-inbox

# 查看实时日志
journalctl -u telegram-inbox -f

# 重启
systemctl restart telegram-inbox

# 停止
systemctl stop telegram-inbox

# 修改配置
nano /opt/-/telegram-inbox/.env
systemctl restart telegram-inbox
```

## 六、更新代码

```bash
cd /opt/-/telegram-inbox
git pull
npm ci --omit=dev
systemctl restart telegram-inbox
```

更新前建议先备份。

## 七、备份

手动备份：

```bash
sudo bash deploy/backup.sh
```

默认备份到 `/var/backups/telegram-inbox`，保留 14 天。可以加定时任务：

```bash
crontab -e
```

加入：

```cron
0 3 * * * APP_DIR=/opt/-/telegram-inbox BACKUP_DIR=/var/backups/telegram-inbox /opt/-/telegram-inbox/deploy/backup.sh >> /var/log/telegram-inbox-backup.log 2>&1
```

备份包含 `data/` 和 `.env`，里面有 SQLite 数据库、个人号 session 和密钥，**不要公开分享**。

## 八、常见问题

### 页面打不开

- 阿里云控制台防火墙是否放行 80/443；
- `systemctl status nginx` 是否正常；
- `systemctl status telegram-inbox` 是否正常；
- `journalctl -u telegram-inbox -n 100 --no-pager` 看报错。

### Telegram / WhatsApp 连不上

- 服务器地域是否在大陆；大陆网络通常无法直连；
- 服务器能否访问外网：

  ```bash
  curl -I https://api.telegram.org
  curl -I https://web.whatsapp.com
  ```

### Telegram 个人号无法扫码

需要在 `.env` 中配置：

```dotenv
TELEGRAM_USER_ENABLED=true
TELEGRAM_USER_API_ID=...
TELEGRAM_USER_API_HASH=...
```

然后：

```bash
systemctl restart telegram-inbox
```

### HTTPS 申请失败

确认域名已经解析到服务器公网 IP，并且 80 端口可访问，然后手动执行：

```bash
certbot --nginx -d 你的域名
```

## 九、安全提醒

- 不要提交 `.env`、`data/`、个人号 session 到 Git；
- 不要把 3000 端口直接暴露到公网，统一走 Nginx；
- 管理员密码使用强密码；
- 定期备份，并把备份下载到另一台机器；
- 个人号 session 等同于登录凭证，泄露后他人可以操作该账号。
