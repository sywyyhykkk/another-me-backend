import { Injectable, Logger } from '@nestjs/common';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { StoreService } from './store.service';
import type { AntipodeCoordinates, WorldClock, WorldWeather } from './types';

interface Condition { code: string; text: string }
interface WeatherResponse {
  metadata?: { attributions?: string[] };
  condition?: Condition;
  temperature?: { value: number };
  days?: Array<{ forecastStartTime: string; forecastEndTime: string;
    temperatureMin: { value: number }; temperatureMax: { value: number };
    daytime: { condition: Condition } }>;
}
interface CacheEntry { data: WorldWeather | null; retryAt: number }

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly pending = new Map<string, Promise<WorldWeather | null>>();
  private token = '';
  private tokenExpiresAt = 0;
  constructor(private readonly store: StoreService) {}

  private authorization(at: number): string | null {
    if (this.token && at < this.tokenExpiresAt - 60000) return this.token;
    const { QWEATHER_DEVELOPER_ID: iss, QWEATHER_PROJECT_ID: sub,
      QWEATHER_KEY_ID: kid, QWEATHER_PRIVATE_KEY_PATH: path } = process.env;
    if (!iss || !sub || !kid || !path) return null;
    const key = createPrivateKey(readFileSync(path));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Invalid weather signing key');
    const iat = Math.floor(at / 1000) - 30, exp = iat + 900;
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const content = `${encode({ alg: 'EdDSA', kid })}.${encode({ iss, sub, iat, exp })}`;
    this.token = `${content}.${sign(null, Buffer.from(content), key).toString('base64url')}`;
    this.tokenExpiresAt = exp * 1000;
    return this.token;
  }

  async pair(origin: AntipodeCoordinates, target: AntipodeCoordinates,
    originWorld: WorldClock, targetWorld: WorldClock, at = new Date()) {
    const [originWeather, targetWeather] = await Promise.all([
      this.get(origin, originWorld, 'hourly', at), this.get(target, targetWorld, 'daily', at),
    ]);
    return { origin: originWeather, target: targetWeather };
  }

  async get(point: AntipodeCoordinates, world: WorldClock, period: WorldWeather['period'], at = new Date()): Promise<WorldWeather | null> {
    // 和风经纬度接口支持两位小数；只归一化天气请求，不修改档案的真实坐标。
    const latitude = Number(point.latitude.toFixed(2)), longitude = Number(point.longitude.toFixed(2));
    const id = `${period}:${latitude}:${longitude}`;
    const cached = this.store.getWeatherCache<CacheEntry>(id);
    const now = at.getTime();
    const matching = cached?.data?.date === world.date ? cached.data : null;
    if (matching && now < Date.parse(matching.expiresAt)) return matching;
    if (cached && now < cached.retryAt) return matching ? { ...matching, stale: true } : null;
    const pending = this.pending.get(id);
    if (pending) return pending;
    const request = this.query(latitude, longitude, world, period, at, matching)
      .finally(() => this.pending.delete(id));
    this.pending.set(id, request);
    return request;
  }

  private async query(latitude: number, longitude: number, world: WorldClock,
    period: WorldWeather['period'], at: Date, previous: WorldWeather | null): Promise<WorldWeather | null> {
    const id = `${period}:${latitude}:${longitude}`;
    try {
      const token = this.authorization(at.getTime());
      const host = process.env.QWEATHER_API_HOST?.trim();
      if (!token || !host) return null;
      if (!/^[a-z0-9.-]+\.qweatherapi\.com$/.test(host)) throw new Error('Invalid weather host');
      const url = new URL(`https://${host}/weather/v1/${period === 'hourly' ? 'current' : 'daily'}/${latitude}/${longitude}`);
      url.searchParams.set('lang', 'zh');
      // UTC 时间用于可靠地匹配本项目的 IANA / 海上估算日期。
      if (period === 'daily') url.searchParams.set('days', '2');
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.json() as WeatherResponse;
      const shifted = at.getTime() + world.utcOffsetSeconds * 1000;
      const nextBoundary = period === 'hourly'
        ? (Math.floor(shifted / 3600000) + 1) * 3600000
        : (Math.floor(shifted / 86400000) + 1) * 86400000;
      const expiresAt = new Date(nextBoundary - world.utcOffsetSeconds * 1000).toISOString();
      const common = { period, source: 'qweather' as const, date: world.date,
        fetchedAt: at.toISOString(), expiresAt, attributions: raw.metadata?.attributions || [] };
      let data: WorldWeather;
      if (period === 'hourly') {
        if (!raw.condition?.code || !raw.condition.text || !Number.isFinite(raw.temperature?.value)) throw new Error('Invalid current weather');
        data = { ...common, code: raw.condition.code, text: raw.condition.text, temperature: raw.temperature!.value };
      } else {
        // 预报区间以服务方当地日期为准，取与档案当天中午重合的区间。
        const noon = Date.parse(world.date + 'T12:00:00Z') - world.utcOffsetSeconds * 1000;
        const day = raw.days?.find(day => Date.parse(day.forecastStartTime) <= noon && noon < Date.parse(day.forecastEndTime));
        if (!day?.daytime?.condition?.code || !day.daytime.condition.text
          || !Number.isFinite(day.temperatureMin?.value) || !Number.isFinite(day.temperatureMax?.value)) throw new Error('Missing local-day forecast');
        data = { ...common, code: day.daytime.condition.code, text: day.daytime.condition.text,
          temperatureMin: day.temperatureMin.value, temperatureMax: day.temperatureMax.value };
      }
      this.store.saveWeatherCache(id, { data, retryAt: 0 });
      return data;
    } catch (error) {
      this.logger.warn(`QWeather ${period} unavailable: ${error instanceof Error ? error.message : 'request failed'}`);
      // 故障时短暂退避，跨用户和服务重启继续生效，不每分钟重试同一坐标。
      this.store.saveWeatherCache(id, { data: previous, retryAt: at.getTime() + 5 * 60000 });
      return previous ? { ...previous, stale: true } : null;
    }
  }
}
