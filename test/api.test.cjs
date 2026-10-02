require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { StoreService } = require('../dist/store.service');

test('HTTP 登录、档案与地理服务', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'another-me-test-'));
  const env = { ...process.env };
  process.env.DATABASE_PATH = join(directory, 'test.sqlite');
  process.env.WECHAT_APP_ID = 'test-appid';
  process.env.WECHAT_APP_SECRET = 'test-secret';
  process.env.GEONAMES_USERNAME = 'test-geonames';
  const httpFetch = global.fetch;
  let geoCalls = 0, geoUnavailable = false, oceanMode = false, loginUnavailable = false;
  global.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'api.weixin.qq.com') {
      assert.equal(url.pathname, '/sns/jscode2session');
      assert.equal(url.searchParams.get('appid'), 'test-appid');
      assert.equal(url.searchParams.get('secret'), 'test-secret');
      assert.equal(url.searchParams.get('grant_type'), 'authorization_code');
      if (loginUnavailable) throw new Error('timeout');
      const code = url.searchParams.get('js_code');
      return Response.json(code === 'invalid' ? { errcode: 40029 } : { openid: `user-${code}`, session_key: 'never-return-this' });
    }
    assert.equal(url.hostname, 'secure.geonames.org');
    assert.equal(url.searchParams.get('username'), 'test-geonames');
    geoCalls++;
    if (geoUnavailable) throw new Error('GeoNames offline');
    const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
    if (url.pathname === '/findNearbyPlaceNameJSON') {
      return Response.json({ geonames: oceanMode ? [] : [{ geonameId: 1, name: lat > 0 ? 'Shanghai' : 'Other City',
        countryName: lat > 0 ? 'China' : 'Argentina', countryCode: lat > 0 ? 'CN' : 'AR',
        adminName1: 'Region', lat: String(lat), lng: String(lng), distance: '5' }] });
    }
    if (url.pathname === '/oceanJSON') return Response.json(oceanMode ? { ocean: { name: 'South Pacific Ocean' } } : {});
    if (url.pathname === '/countrySubdivisionJSON') return Response.json(oceanMode ? {} : {countryCode:'AR',countryName:'Argentina',adminName1:'Region'});
    assert.equal(url.pathname, '/timezoneJSON');
    return Response.json({ timezoneId: lat > 0 ? 'Asia/Shanghai' : 'America/Argentina/Buenos_Aires',
      countryCode: lat > 0 ? 'CN' : 'AR', countryName: lat > 0 ? 'China' : 'Argentina',
      rawOffset: lat > 0 ? 8 : -3, dstOffset: lat > 0 ? 8 : -3, sunrise: '2026-10-01 06:00', sunset: '2026-10-01 18:00' });
  };

  let app, base;
  async function start() {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  }
  const call = async (path, method = 'GET', body, token) => {
    const response = await httpFetch(`${base}/api${path}`, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const payload = (mode = 'manual', latitude = 31.2304, longitude = 121.4737, role = 'office_worker') => ({
    originLocation: { mode, cityName: mode === 'device' ? '当前位置' : '上海', countryName: '中国', latitude, longitude },
    selectedAvatar: { id: role, role, name: '测试形象', emoji: '💼' }, targetMode: 'antipode',
    character: { name: '卢西亚', gender: 'female', continent: 'SA' },
  });
  let tokenA, tokenB, first, second, shared;
  try {
    await start();
    await t.test('登录只返回会话，拒绝缺失或无效 code', async () => {
      assert.equal((await call('/health')).status, 200);
      assert.equal((await call('/auth/login', 'POST', {})).status, 400);
      assert.equal((await call('/auth/login', 'POST', { code: 'invalid' })).status, 401);
      const a = await call('/auth/login', 'POST', { code: 'a' });
      const b = await call('/auth/login', 'POST', { code: 'b' });
      assert.equal(a.status, 201);
      assert.match(a.body.data.token, /^[a-f0-9]{64}$/);
      assert.ok(a.body.data.expiresAt > Date.now());
      assert.deepEqual(Object.keys(a.body.data).sort(), ['expiresAt', 'token']);
      tokenA = a.body.data.token; tokenB = b.body.data.token;
    });
    await t.test('所有业务接口验证会话，拒绝伪造和过期身份', async () => {
      for (const [path, method, body] of [['/profiles/active', 'GET'], ['/profiles', 'POST', payload()],
        ['/profiles', 'DELETE', { deleteActive: true }], ['/geo/origin', 'POST', { latitude: 31, longitude: 121 }],
        ['/characters/suggest', 'POST', { originLocation: payload().originLocation, gender: 'female' }]]) {
        assert.equal((await call(path, method, body)).status, 401);
      }
      assert.equal((await call('/profiles/active', 'GET', undefined, 'f'.repeat(64))).status, 401);
      app.get(StoreService).saveSession('e'.repeat(64), 'user-a', Date.now() - 1);
      assert.equal((await call('/profiles/active', 'GET', undefined, 'e'.repeat(64))).status, 401);
      assert.deepEqual((await call('/profiles/active', 'GET', undefined, tokenA)).body, { success: true, exists: false, data: null });
    });
    await t.test('拒绝非法坐标、形象和不支持的目标位置', async () => {
      for (const body of [null, {}, payload('manual', 91), payload('manual', 31, 181), payload('manual', 31, 121, 'unknown'),
        { ...payload(), targetMode: 'custom_location' }, { ...payload(), profileName: 1 },
        { ...payload(), character: undefined }, { ...payload(), character: null },
        ...[{ name: '' }, { name: '   ' }, { name: '一'.repeat(13) }, { name: '它' }, { name: '名字\n换行' },
          { gender: 'invalid' }, { continent: 'invalid' }].map(change => ({ ...payload(), character: { ...payload().character, ...change } }))]) {
        assert.equal((await call('/profiles', 'POST', body, tokenA)).status, 400);
      }
      assert.equal((await call('/geo/origin', 'POST', { latitude: '31', longitude: 121 }, tokenA)).status, 400);
    });
    await t.test('名字建议按实际目标大洲和性别生成，可换名且不创建档案', async () => {
      const body = { originLocation: payload().originLocation, gender: 'female' };
      for (const invalid of [null, {}, { ...body, gender: 'unknown' }, { ...body, originLocation: { ...body.originLocation, latitude: 91 } }]) {
        assert.equal((await call('/characters/suggest', 'POST', invalid, tokenA)).status, 400);
      }
      const suggested = await call('/characters/suggest', 'POST', body, tokenA);
      assert.equal(suggested.status, 201);
      const identity = suggested.body.data;
      assert.equal(identity.continent, 'SA');
      assert.equal(identity.gender, 'female');
      assert.ok(identity.continentLabel && identity.locationLabel);
      assert.equal(identity.targetKind, 'land');
      assert.ok([...identity.name].length >= 1 && [...identity.name].length <= 12);
      assert.doesNotMatch(identity.name, /它/);
      const changed = (await call('/characters/suggest', 'POST', { ...body, excludeName: identity.name }, tokenA)).body.data;
      assert.notEqual(changed.name, identity.name);
      assert.equal((await call('/profiles/active', 'GET', undefined, tokenA)).body.exists, false);
    });
    await t.test('手动选城创建档案，返回同步活动、日程与双世界内容', async () => {
      const created = await call('/profiles', 'POST', { ...payload(), character: { name: '  卢西亚  ', gender: 'female', continent: 'AS' }, openid: 'user-b' }, tokenA);
      assert.equal(created.status, 201);
      first = created.body.data;
      assert.equal(first.openid, 'user-a');
      assert.deepEqual(first.character, { name: '卢西亚', gender: 'female', continent: 'SA' });
      assert.match(first.profileName, /卢西亚/);
      assert.doesNotMatch(JSON.stringify(first.result), /它/);
      assert.match(first.result.currentDescription, /卢西亚/);
      assert.deepEqual(first.antipode, {latitude:-31.2304,longitude:121.4737-180});
      assert.equal(first.targetLocation.kind,'land');
      assert.equal(first.metadata.geo.resolverVersion,2);
      assert.ok(!('nearestPlace' in first.metadata));
      assert.equal(first.metadata.generator, 'nestjs_v1');
      assert.equal(first.metadata.timezoneData.rawOffset, -10800);
      assert.match(first.result.localTime, /^\d{2}:\d{2}$/);
      assert.equal(first.result.timeline.filter(item => item.isCurrent).length, 1);
      assert.equal(first.result.timeline.length, 9);
      assert.ok(first.result.currentTitle && first.result.currentDescription && first.result.shareText);
      assert.equal(first.videoAsset,null);
      assert.equal(first.result.dailyStory.date,first.result.targetWorld.date);
      assert.ok(first.result.distanceKm > 19000);
    });
    await t.test('稳态读取不重复请求 GeoNames，强制刷新更新时间', async () => {
      const count = geoCalls;
      const active = await call('/profiles/active', 'GET', undefined, tokenA);
      assert.equal(active.body.data._id, first._id);
      assert.equal(geoCalls, count);
      const forced = await call('/profiles/active?forceRefresh=true', 'GET', undefined, tokenA);
      assert.equal(forced.body.data._id, first._id);
      assert.deepEqual(forced.body.data.character, first.character);
      assert.ok(Date.parse(forced.body.data.metadata.lastRefreshedAt) >= Date.parse(first.metadata.lastRefreshedAt));
      assert.equal(geoCalls, count);
    });
    await t.test('公开快照固定分享时刻且不暴露私人字段', async () => {
      assert.equal((await call('/shares','POST')).status,401);
      const response=await call('/shares','POST',{},tokenA);
      assert.equal(response.status,201);
      shared=response.body.data;
      assert.ok(shared.capturedAt && shared.originWorld.date && shared.targetWorld.date && shared.currentState);
      assert.deepEqual(shared.character, { name: '卢西亚', gender: 'female' });
      assert.doesNotMatch(shared.shareText, /它/);
      const serialized=JSON.stringify(shared);
      for (const field of ['openid','originLocation','targetLocation','latitude','longitude','profileId','token','continent']) {
        assert.ok(!serialized.includes('"'+field+'"'),field);
      }
      assert.equal((await call('/shares/'+shared.id,'DELETE',{},tokenB)).status,404);
      const publicResponse=await call('/shares/'+shared.id);
      assert.deepEqual(publicResponse.body.data,shared);
      assert.equal((await call('/shares/not-a-snapshot')).status,404);
    });
    await t.test('已有旧档案按真实坐标规则重新解析', async () => {
      const store=app.get(StoreService);
      const old=store.getActiveProfile('user-a');
      store.updateProfile({...old,metadata:{...old.metadata,version:1,geo:{resolverVersion:1}},
        character: undefined, targetLocation:{...old.targetLocation,latitude:0,longitude:0}});
      const updated=(await call('/profiles/active','GET',undefined,tokenA)).body.data;
      assert.deepEqual(updated.antipode,first.antipode);
      assert.equal(updated.metadata.geo.resolverVersion,2);
      assert.ok(!('nearestPlace' in updated.metadata));
      assert.ok(updated.character.name);
      assert.equal(updated.character.gender, 'unspecified');
      const again=(await call('/profiles/active','GET',undefined,tokenA)).body.data;
      assert.deepEqual(again.character,updated.character);
      assert.deepEqual(store.getActiveProfile('user-a').character,updated.character);
      assert.doesNotMatch(JSON.stringify(updated.result),/它/);
    });
    await t.test('用户之间无法读取或删除对方档案', async () => {
      assert.equal((await call('/profiles/active', 'GET', undefined, tokenB)).body.exists, false);
      assert.equal((await call('/profiles', 'DELETE', { profileId: first._id }, tokenB)).status, 404);
      assert.equal((await call('/profiles/active', 'GET', undefined, tokenA)).body.data._id, first._id);
    });
    await t.test('设备位置反查保持起点，目标完整坐标分别查询', async () => {
      const before = geoCalls;
      const created = await call('/profiles', 'POST', payload('device', 31.230401, 121.473701, 'student'), tokenA);
      second = created.body.data;
      assert.equal(second.originLocation.cityName, 'Shanghai');
      assert.equal(second.originLocation.geoResolved.timezoneId, 'Asia/Shanghai');
      assert.equal(second.metadata.geo.source, 'geonames');
      assert.equal(second.antipode.latitude, -31.230401);
      assert.equal(second.targetLocation.longitude,121.473701-180);
      assert.equal(geoCalls - before, 6);
      await call('/profiles/active', 'GET', undefined, tokenA);
      assert.equal(geoCalls - before, 6);
    });
    await t.test('服务重启后继续复用会话、档案与地理缓存', async () => {
      await app.close(); await start();
      const before = geoCalls;
      const active = await call('/profiles/active', 'GET', undefined, tokenA);
      assert.equal(active.status, 200);
      assert.equal(active.body.data._id, second._id);
      assert.deepEqual((await call('/shares/'+shared.id)).body.data,shared);
      const created = await call('/profiles', 'POST', payload(), tokenB);
      assert.equal(created.body.data.metadata.geo.source, 'geonames_cache');
      assert.equal(geoCalls, before);
    });
    await t.test('删除活动档案后恢复最近档案，全部删除后返回空档案', async () => {
      assert.equal((await call('/profiles', 'DELETE', { deleteActive: true }, tokenA)).status, 200);
      assert.equal((await call('/profiles/active', 'GET', undefined, tokenA)).body.data._id, first._id);
      assert.equal((await call('/profiles', 'DELETE', { profileId: first._id }, tokenA)).status, 200);
      assert.equal((await call('/profiles/active', 'GET', undefined, tokenA)).body.exists, false);
      assert.deepEqual((await call('/shares/'+shared.id)).body.data,shared);
      assert.equal((await call('/profiles/active', 'GET', undefined, tokenB)).body.exists, true);
    });
    await t.test('海上对蹠点返回海洋信息与其他形象的日程', async () => {
      oceanMode = true;
      const created = await call('/profiles', 'POST', payload('manual', 40, 110, 'traveler'), tokenA);
      assert.equal(created.body.data.targetLocation.kind,'ocean');
      assert.equal(created.body.data.result.scene.habitat,'boat_cabin');
      assert.equal(created.body.data.metadata.ocean.name, 'South Pacific Ocean');
      assert.ok(created.body.data.result.timeline.some(item => item.title === '观察海面' || item.title === '整理旅途手记'));
      oceanMode = false;
    });
    await t.test('GeoNames 故障时使用坐标结果，恢复后重新解析', async () => {
      geoUnavailable = true;
      const created = await call('/profiles', 'POST', payload('manual', 10, 100, 'freelancer'), tokenA);
      assert.equal(created.status, 201);
      assert.equal(created.body.data.metadata.geo.source, 'fallback');
      assert.match(created.body.data.result.localTime, /^\d{2}:\d{2}$/);
      geoUnavailable = false;
      const refreshed = await call('/profiles/active', 'GET', undefined, tokenA);
      assert.equal(refreshed.body.data._id, created.body.data._id);
      assert.equal(refreshed.body.data.metadata.geo.source, 'geonames');
    });
    await t.test('缺少必填配置或微信服务故障时返回可处理的错误', async () => {
      delete process.env.GEONAMES_USERNAME;
      assert.equal((await call('/profiles', 'POST', payload(), tokenA)).status, 503);
      assert.equal((await call('/geo/origin', 'POST', { latitude: 31, longitude: 121 }, tokenA)).status, 503);
      process.env.GEONAMES_USERNAME = 'test-geonames';
      delete process.env.WECHAT_APP_SECRET;
      assert.equal((await call('/auth/login', 'POST', { code: 'new' })).status, 503);
      process.env.WECHAT_APP_SECRET = 'test-secret';
      loginUnavailable = true;
      assert.equal((await call('/auth/login', 'POST', { code: 'new' })).status, 503);
    });
  } finally {
    if (app) await app.close();
    global.fetch = httpFetch;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    rmSync(directory, { recursive: true, force: true });
  }
});
