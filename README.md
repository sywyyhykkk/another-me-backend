# Another Me Backend

「对面的我」微信小程序的 NestJS 后端，提供微信登录、档案创建/读取/刷新/删除、
GeoNames 起点反查与对蹠点查询、地理缓存、当地日程、活动文案和占位视频数据。

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
| `PORT` / `HOST` | 默认 `3000` / `0.0.0.0` |
| `DATABASE_PATH` | 默认 `./data/another-me.sqlite` |

```bash
npm run build
npm start
```

修改源码后重新 build 并启动。`.env` 和 `data/` 已排除提交；重启时使用同一
`DATABASE_PATH` 即可继续读取会话、档案和缓存。

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
| POST | `/geo/origin` | `{ "latitude": 31.23, "longitude": 121.47 }`，反查城市和时区 |

除健康检查和登录外，接口均需登录；用户身份只取自会话。创建请求示例：

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
`freelancer`、`traveler`。日程在 `src/domain/schedule.js` 的 `TIMELINE_TEMPLATES` 中修改。
地理服务临时不可用时返回坐标结果，并按经度估算当地时间；后续读取会重新尝试地理查询。

## 验证

```bash
npm test
```

测试通过真实本地 HTTP 接口检查登录、会话鉴权、档案流程、用户隔离、地理查询/缓存、
服务重启与数据保留。微信和 GeoNames 响应由测试替身提供，测试无需真实密钥。

服务器准备好后使用上述启动方式部署，并为小程序配置 HTTPS 域名。
