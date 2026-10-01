import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { StoreService } from './store.service';
import type { AntipodeCoordinates, GeoTimezoneData, OriginLocation, TargetLocation } from './types';

interface NearestPlace {
  geonameId?: number;
  name: string;
  countryName: string;
  countryCode?: string;
  adminName1?: string;
  lat: number;
  lng: number;
  distanceKm: number;
}
export interface GeoData {
  antipode: AntipodeCoordinates;
  targetLocation: TargetLocation;
  distanceKm: number;
  nearestPlace: NearestPlace | null;
  ocean: { name: string } | null;
  timezone: GeoTimezoneData | null;
  geoMeta: { resolverVersion: number; source: string; cached: boolean; errorReason?: string };
}
interface GeoNamesResponse {
  status?: { message?: string };
  geonames?: Array<{ geonameId: number; name: string; countryName: string; countryCode: string;
    adminName1: string; lat: string; lng: string; distance?: string }>;
  ocean?: { name: string };
  timezoneId?: string;
  countryCode?: string;
  countryName?: string;
  time?: string;
  rawOffset?: number;
  dstOffset?: number;
  sunrise?: string;
  sunset?: string;
}

export function validateCoordinates(point: AntipodeCoordinates | null | undefined): boolean {
  return Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180);
}

export function validateOrigin(origin: OriginLocation | null | undefined): boolean {
  return Boolean(validateCoordinates(origin) && origin
    && typeof origin.cityName === 'string' && origin.cityName.trim() && origin.cityName.length <= 100
    && typeof origin.countryName === 'string' && origin.countryName.trim() && origin.countryName.length <= 100
    && (origin.mode === 'device' || origin.mode === 'manual'));
}

function distance(origin: AntipodeCoordinates, target: AntipodeCoordinates): number {
  const rad = (value: number) => value * Math.PI / 180;
  const a = Math.sin(rad(target.latitude - origin.latitude) / 2) ** 2
    + Math.cos(rad(origin.latitude)) * Math.cos(rad(target.latitude))
    * Math.sin(rad(target.longitude - origin.longitude) / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))));
}

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);
  constructor(private readonly store: StoreService) {}

  private username(): string {
    const username = process.env.GEONAMES_USERNAME?.trim();
    if (!username) throw new ServiceUnavailableException('Missing GEONAMES_USERNAME');
    return username;
  }

  private async query(endpoint: string, params: Record<string, string | number>): Promise<GeoNamesResponse | null> {
    const url = new URL(`https://secure.geonames.org/${endpoint}`);
    url.search = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      username: this.username() }).toString();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as GeoNamesResponse;
      if (data.status) throw new Error(data.status.message || 'GeoNames unavailable');
      return data;
    } catch {
      this.logger.warn(`GeoNames ${endpoint} unavailable`);
      return null;
    }
  }

  private async nearest(point: AntipodeCoordinates): Promise<NearestPlace | null> {
    const data = await this.query('findNearbyPlaceNameJSON', {
      lat: point.latitude, lng: point.longitude, radius: 20, maxRows: 10, cities: 'cities1000', lang: 'en',
    });
    const place = data?.geonames?.[0];
    if (!place) return null;
    const lat = Number(place.lat), lng = Number(place.lng), km = Number(place.distance || 0);
    if (!validateCoordinates({ latitude: lat, longitude: lng }) || !Number.isFinite(km)) return null;
    return { geonameId: place.geonameId, name: place.name, countryName: place.countryName,
      countryCode: place.countryCode, adminName1: place.adminName1, lat, lng, distanceKm: km };
  }

  private async timezone(point: AntipodeCoordinates): Promise<GeoTimezoneData | null> {
    const data = await this.query('timezoneJSON', { lat: point.latitude, lng: point.longitude });
    if (!data?.timezoneId) return null;
    return { timezoneId: data.timezoneId, time: data.time, countryCode: data.countryCode,
      countryName: data.countryName, rawOffset: data.rawOffset === undefined ? undefined : Math.round(data.rawOffset * 3600),
      dstOffset: data.dstOffset === undefined ? undefined : Math.round(data.dstOffset * 3600),
      sunrise: data.sunrise, sunset: data.sunset };
  }

  async resolveOrigin(point: AntipodeCoordinates) {
    if (!validateCoordinates(point)) throw new BadRequestException('Invalid coordinates');
    this.username();
    const nearestPlace = await this.nearest(point);
    const timezone = await this.timezone(nearestPlace ? { latitude: nearestPlace.lat, longitude: nearestPlace.lng } : point);
    const cityName = nearestPlace?.name || this.coordinateLabel(point);
    return { success: true as const, data: { cityName,
      countryName: timezone?.countryName || nearestPlace?.countryName || '未知国家', nearestPlace, timezone } };
  }

  async resolveCombined(origin: OriginLocation, enrichOrigin: boolean) {
    const [originResponse, target] = await Promise.all([
      enrichOrigin ? this.resolveOrigin(origin) : Promise.resolve(null),
      this.resolveTarget(origin),
    ]);
    return { origin: originResponse?.data || null, target };
  }

  async resolveTarget(origin: OriginLocation): Promise<GeoData> {
    if (!validateOrigin(origin)) throw new BadRequestException('Invalid origin location');
    this.username();
    const antipode = { latitude: Number((-origin.latitude).toFixed(6)),
      longitude: Number((origin.longitude >= 0 ? origin.longitude - 180 : origin.longitude + 180).toFixed(6)) };
    const cacheId = `${antipode.latitude.toFixed(2)}:${antipode.longitude.toFixed(2)}`;
    const cached = this.store.getGeoCache<GeoData>(cacheId);
    if (cached?.timezone?.timezoneId) {
      return { ...cached, antipode, targetLocation: { ...cached.targetLocation, ...antipode },
        distanceKm: distance(origin, cached.nearestPlace
          ? { latitude: cached.nearestPlace.lat, longitude: cached.nearestPlace.lng } : antipode),
        geoMeta: { resolverVersion: 1, source: 'geonames_cache', cached: true } };
    }
    const nearestPlace = await this.nearest(antipode);
    const [oceanResponse, timezone] = await Promise.all([
      !nearestPlace || nearestPlace.distanceKm > 80
        ? this.query('oceanJSON', { lat: antipode.latitude, lng: antipode.longitude }) : Promise.resolve(null),
      this.timezone(nearestPlace ? { latitude: nearestPlace.lat, longitude: nearestPlace.lng } : antipode),
    ]);
    const ocean = oceanResponse?.ocean || null;
    const isFallback = !nearestPlace && !ocean && !timezone;
    const result: GeoData = { antipode, targetLocation: this.targetLocation(antipode, nearestPlace, ocean, timezone),
      distanceKm: distance(origin, nearestPlace ? { latitude: nearestPlace.lat, longitude: nearestPlace.lng } : antipode),
      nearestPlace, ocean, timezone,
      geoMeta: { resolverVersion: 1, source: isFallback ? 'fallback' : 'geonames', cached: false,
        ...(isFallback ? { errorReason: 'GeoNames unavailable' } : {}) } };
    if (timezone?.timezoneId) this.store.saveGeoCache(cacheId, result);
    return result;
  }

  private coordinateLabel(point: AntipodeCoordinates) {
    return `${Math.abs(point.latitude).toFixed(1)}°${point.latitude >= 0 ? 'N' : 'S'}, ${Math.abs(point.longitude).toFixed(1)}°${point.longitude >= 0 ? 'E' : 'W'} 附近`;
  }

  private targetLocation(antipode: AntipodeCoordinates, place: NearestPlace | null,
    ocean: { name: string } | null, timezone: GeoTimezoneData | null): TargetLocation {
    const nearLand = Boolean(place && place.distanceKm <= 80);
    const atOcean = !nearLand && Boolean(ocean);
    return { ...antipode,
      locationLabel: nearLand ? `${place!.name} 附近`
        : ocean ? `${ocean.name} 附近` : place ? `${place.countryName || '地球另一端'}附近` : this.coordinateLabel(antipode),
      countryName: nearLand ? place!.countryName || timezone?.countryName || '未知国家'
        : ocean?.name || place?.countryName || '未知区域',
      regionName: place?.adminName1 || (antipode.latitude >= 0 ? '北半球' : '南半球'),
      nearestLivingArea: place ? `${place.name}, ${place.countryName}` : '最近的人类生活区域附近',
      landingMode: atOcean ? 'deep_ocean' : 'near_land', usesProxyLivingArea: true,
      proxyReason: nearLand ? '已使用最近生活区域作为展示参考。'
        : atOcean ? '精确对蹠点位于海上，已使用最近生活区域作为展示参考。'
          : place ? '精确对蹠点附近缺少大型城市，已使用最近生活区域作为展示参考。'
            : '暂时无法连接地理服务，已使用坐标结果作为展示参考。' };
  }
}
