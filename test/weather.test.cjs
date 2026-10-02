require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, verify } = require('node:crypto');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { StoreService } = require('../dist/store.service');
const { WeatherService } = require('../dist/weather.service');
const { clockAt } = require('../dist/domain/world');

test('天气认证、坐标共享、更新边界、重启缓存与故障退避', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'another-me-weather-'));
  const env = { ...process.env }, originalFetch = global.fetch;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const path = join(directory, 'private.pem');
  writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  Object.assign(process.env, { DATABASE_PATH: join(directory, 'weather.sqlite'), QWEATHER_API_HOST: 'test.qweatherapi.com',
    QWEATHER_DEVELOPER_ID: 'QTEST', QWEATHER_PROJECT_ID: 'PROJECT', QWEATHER_KEY_ID: 'KEY', QWEATHER_PRIVATE_KEY_PATH: path });
  let at = new Date('2026-10-02T04:20:00Z'), calls = [], unavailable = false, store, weather;
  const point = { latitude: -25.0389, longitude: -77.2817 };
  const world = () => clockAt({ utcOffsetSeconds: -18000 }, at, point.longitude);
  global.fetch = async (input, options) => {
    const url = new URL(input), jwt = options.headers.Authorization.slice(7);
    const [header, payload, signature] = jwt.split('.');
    assert.ok(verify(null, Buffer.from(header + '.' + payload), publicKey, Buffer.from(signature, 'base64url')));
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'EdDSA', kid: 'KEY' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(claims.iss, 'QTEST'); assert.equal(claims.sub, 'PROJECT'); assert.ok(claims.exp > at.getTime() / 1000);
    assert.equal(url.hostname, 'test.qweatherapi.com');
    assert.match(url.pathname, /\/-25\.04\/-77\.28$/);
    assert.equal(url.searchParams.has('key'), false);
    calls.push(url.pathname);
    await new Promise(resolve => setImmediate(resolve));
    if (unavailable) return Response.json({}, { status: 503 });
    const metadata = { attributions: ['https://developer.qweather.com/attribution.html'] };
    if (url.pathname.includes('/current/')) return Response.json({ metadata, condition: { code: '101', text: '多云' }, temperature: { value: 17.9 } });
    assert.equal(url.searchParams.get('days'), '2');
    const date = world().date;
    return Response.json({ metadata, days: [{ forecastStartTime: date + 'T05:00:00Z',
      forecastEndTime: new Date(Date.parse(date + 'T05:00:00Z') + 86400000).toISOString(),
      temperatureMin: { value: 15 }, temperatureMax: { value: 21 }, daytime: { condition: { code: '305', text: '小雨' } } }] });
  };
  const start = () => { store = new StoreService(); weather = new WeatherService(store); };
  try {
    start();
    await t.test('并发用户在同一和风坐标只发一次请求，原始坐标不变', async () => {
      const original = { ...point };
      const values = await Promise.all(Array.from({ length: 8 }, () => weather.get(point, world(), 'hourly', at)));
      assert.equal(calls.length, 1); assert.ok(values.every(value => value.temperature === 17.9));
      assert.equal(values[0].expiresAt, '2026-10-02T05:00:00.000Z'); assert.deepEqual(point, original);
      await weather.get({ latitude: -25.039, longitude: -77.2818 }, world(), 'hourly', at);
      assert.equal(calls.length, 1);
    });
    await t.test('每日预报匹配海上当地日期，缓存至当地零点', async () => {
      const data = await weather.get(point, world(), 'daily', at);
      assert.equal(data.date, '2026-10-01'); assert.equal(data.text, '小雨');
      assert.equal(data.temperatureMin, 15); assert.equal(data.expiresAt, '2026-10-02T05:00:00.000Z');
      await weather.get(point, world(), 'daily', at); assert.equal(calls.length, 2);
    });
    await t.test('重启后复用 SQLite 的两个缓存', async () => {
      store.onModuleDestroy(); start();
      await weather.get(point, world(), 'hourly', at); await weather.get(point, world(), 'daily', at);
      assert.equal(calls.length, 2);
    });
    await t.test('到整点及当地跨日后分别更新，稳定访问不重复调用', async () => {
      at = new Date('2026-10-02T05:00:00Z');
      await weather.get(point, world(), 'hourly', at);
      const daily = await weather.get(point, world(), 'daily', at);
      assert.equal(daily.date, '2026-10-02'); assert.equal(calls.length, 4);
      at = new Date('2026-10-02T05:59:00Z');
      await weather.get(point, world(), 'hourly', at); await weather.get(point, world(), 'daily', at);
      assert.equal(calls.length, 4);
    });
    await t.test('上游故障返回当天最近天气，并持久化五分钟退避', async () => {
      at = new Date('2026-10-02T06:00:00Z'); unavailable = true;
      const last = await weather.get(point, world(), 'hourly', at);
      assert.equal(last.stale, true); assert.equal(last.temperature, 17.9); assert.equal(calls.length, 5);
      store.onModuleDestroy(); start();
      at = new Date('2026-10-02T06:04:00Z');
      await weather.get(point, world(), 'hourly', at); assert.equal(calls.length, 5);
      at = new Date('2026-10-02T06:05:00Z'); unavailable = false;
      const fresh = await weather.get(point, world(), 'hourly', at);
      assert.equal(fresh.stale, undefined); assert.equal(calls.length, 6);
    });
    await t.test('跨日故障不把昨日预报当作今天；缺少凭据不调用上游', async () => {
      at = new Date('2026-10-03T05:00:00Z'); unavailable = true;
      assert.equal(await weather.get(point, world(), 'daily', at), null);
      assert.equal(calls.length, 7);
      delete process.env.QWEATHER_PROJECT_ID;
      weather = new WeatherService(store);
      assert.equal(await weather.get({ latitude: 20, longitude: 20 }, world(), 'hourly', at), null);
      assert.equal(calls.length, 7);
    });
  } finally {
    store?.onModuleDestroy(); global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env); rmSync(directory, { recursive: true, force: true });
  }
});
