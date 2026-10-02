# Another Me Backend

「对面的我」微信小程序的 NestJS 后端，提供微信登录、档案创建/读取/刷新/删除、
GeoNames 起点反查与真实对跖点查询、每日生活规则、双世界时钟和公开分享快照。

使用 Node.js 自带 SQLite 保存会话、档案和地理缓存，无须单独安装数据库。

## 运行

需要 Node.js **24.15 或更新版本**。

```bash
npm ci
cp .env.example .env
```

填写 `.env`：

| 配置 | 用途 |
| --- | --- |
| `WECHAT_APP_ID` | 微信小程序 AppID，与前端一致 |
| `WECHAT_APP_SECRET` | 小程序 AppSecret，必填 |
| `GEONAMES_USERNAME` | 已开启免费 Web Services 的 GeoNames 用户名，地理功能必填 |
| `QWEATHER_API_HOST` | 和风天气控制台分配的 API Host，不带协议 |
| `QWEATHER_DEVELOPER_ID` / `QWEATHER_PROJECT_ID` / `QWEATHER_KEY_ID` | JWT 的开发者 ID、项目 ID、凭据 ID |
| `QWEATHER_PRIVATE_KEY_PATH` | Ed25519 私钥文件路径，仅后端读取；文件权限设为 600 |
| `PORT` / `HOST` | 默认 `3000` / `0.0.0.0` |
| `DATABASE_PATH` | 默认 `./data/another-me.sqlite` |

```bash
npm run build
npm start
```

修改源码后重新 build 并启动。`.env` 和 `data/` 已排除提交；重启时使用同一
`DATABASE_PATH` 即可继续读取会话、档案和缓存。

天气使用和风全球经纬度接口 `/weather/v1/current/{latitude}/{longitude}` 和
`/weather/v1/daily/{latitude}/{longitude}`，不以附近城市替代对跖点。
起点实况缓存到当地下一整点，对跖点当日预报缓存到当地次日零点；按接口支持的
两位小数经纬度共享 SQLite 缓存，合并并发请求，刷新页面不会绕过缓存。
服务重启继续使用缓存；失败退避五分钟，当天旧数据标记为最近天气，跨日不冒充新预报。
缺少天气配置或上游失败不影响档案、时钟和虚拟日程，页面显示天气暂不可用。
公开分享只保存天气展示字段，不暴露坐标或凭据，读取快照不会请求和风。

## 接口

接口前缀为 `/api`。响应形如 `{ success: true, data: ... }`；异常返回标准 HTTP
状态码和 `message`。登录成功后使用 `Authorization: Bearer <token>`。
会话有效期为 7 天，微信 `session_key` 和 AppSecret 均不返回客户端。

| 方法 | 路径 | 请求 / 行为 |
| --- | --- | --- |
| GET | `/health` | 健康检查，无须登录 |
| POST | `/auth/login` | `{ "code": "uni.login 返回的 code" }`，返回 `token` 和毫秒时间戳 `expiresAt` |
| GET | `/profiles/active` | 当前用户的活动档案；`?forceRefresh=true` 强制刷新活动 |
| POST | `/profiles` | 创建档案，原有活动档案归档 |
| DELETE | `/profiles` | `{ "deleteActive": true }` 或 `{ "profileId": "..." }`；删除活动档案后恢复最近一份档案 |
| POST | `/shares` | 为当前用户档案创建不可变的公开快照 |
| GET | `/shares/:id` | 无须登录，只返回快照展示字段 |
| POST | `/geo/origin` | `{ "latitude": 31.23, "longitude": 121.47 }`，反查城市和时区 |

除健康检查、登录和公开快照读取外，接口均需登录；用户身份只取自会话。创建请求示例：

```json
{
  "originLocation": {
    "mode": "manual",
    "cityName": "上海",
    "countryName": "中国",
    "latitude": 31.2304,
    "longitude": 121.4737
  },
  "selectedAvatar": { "id": "office", "role": "office_worker", "name": "上班族", "emoji": "💼" },
  "targetMode": "antipode"
}
```

`mode` 支持 `manual` 和 `device`；形象角色支持 `office_worker`、`student`、
`freelancer`、`traveler`。每日规则在 `src/domain/world.js` 中修改，同时同步前端 `utils/world.js`。
地理服务临时不可用时返回坐标结果，并按经度估算当地时间；后续读取会重新尝试地理查询。

## 验证

```bash
npm test
```

测试通过真实本地 HTTP 接口检查登录、会话鉴权、档案流程、用户隔离、地理查询/缓存、
服务重启与数据保留。微信和 GeoNames 响应由测试替身提供，测试无需真实密钥。

服务器准备好后使用上述启动方式部署，并为小程序配置 HTTPS 域名。

## 当前服务器

产品依据：`/Users/junyu/Desktop/another me 需求文档.md`。

后端已部署到 `https://another-me.m4n9o.com/api`。使用 `ssh another-me-server` 登录，
代码和数据位于 `/opt/another-me`，环境文件权限为 600。服务操作：

```bash
sudo systemctl restart another-me
sudo systemctl status another-me
sudo journalctl -u another-me -n 50 --no-pager
```

更新时同步 `dist/`、`src/`、`package.json` 和 lock 文件，执行 `npm ci --omit=dev`
并重启服务，保留 `.env` 和 `data/`。部署配置模板位于 `deploy/`，HTTPS 证书自动续期。
腾讯云已放行公网 TCP 443，公网 HTTPS 健康检查返回 HTTP 200。
正式小程序构建已通过该 HTTPS 地址完成微信重新登录和已有档案读取。
目标查询不使用起点的城市反查结果，也不使用附近城市坐标；旧档案读取会重新解析。
