# 采购跟单进度系统

Node + SQLite + React 的采购跟单进度共享系统。系统把金蝶采购订单、供应商生产进度、历史库存、维度分类和权限管理放在一个腾讯云服务里。

## 功能模块

- 金蝶订单导入：字段映射、快照预览、差异确认。
- 生产进度刷新：按创建月份、事业部、供应商、物料编码手工刷新四阶段数量。
- 差异分配、生产进度维护、采购总览、周更新看板。
- 历史库存、维度表库、变更追溯、权限管理。

## 本地开发

```bash
npm install
npm run dev
```

本地后端首次启动需要设置管理员初始密码环境变量：

```bash
先在当前终端设置 ADMIN_INITIAL_PASSWORD 为临时强密码
npm run dev
```

## 腾讯云自动部署

仓库包含腾讯云 SSH + PM2 自动部署 workflow：

```text
.github/workflows/deploy-tencent.yml
```

配置见 [DEPLOY_TENCENT.md](./DEPLOY_TENCENT.md)。

## 管理员

- 默认管理员用户名：`孙立柱`
- 管理员密码不写入 GitHub；首次初始化从 `ADMIN_INITIAL_PASSWORD` 环境变量读取。
- 数据库只保存 bcrypt 哈希。
