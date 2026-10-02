import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { StoreService } from './store.service';
import type { AntipodeCoordinates, GeoTimezoneData, OriginLocation, TargetLocation } from './types';
import { clockAt } from './domain/world';

interface OriginPlace { geonameId?: number; name: string; countryName: string; countryCode?: string;
  adminName1?: string; lat: number; lng: number; distanceKm: number }
export interface GeoData {
  antipode: AntipodeCoordinates; targetLocation: TargetLocation; distanceKm: number;
  ocean: { name: string } | null; timezone: GeoTimezoneData | null;
  geoMeta: { resolverVersion: number; source: string; cached: boolean; errorReason?: string; resolvedAt?: string };
}
interface GeoResponse {
  status?: { message?: string }; geonames?: Array<{ geonameId: number; name: string; countryName: string;
    countryCode: string; adminName1: string; lat: string; lng: string; distance?: string }>;
  ocean?: { name: string }; timezoneId?: string; countryCode?: string; countryName?: string;
  adminName1?: string; time?: string; rawOffset?: number; dstOffset?: number; sunrise?: string; sunset?: string;
}
export function validateCoordinates(point: AntipodeCoordinates | null | undefined): boolean {
  return Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180);
}
export function validateOrigin(origin: OriginLocation | null | undefined): boolean {
  return Boolean(validateCoordinates(origin) && origin && typeof origin.cityName === 'string'
    && origin.cityName.trim() && origin.cityName.length <= 100 && typeof origin.countryName === 'string'
    && origin.countryName.trim() && origin.countryName.length <= 100 && ['device','manual'].includes(origin.mode));
}
export function antipodeOf(origin: AntipodeCoordinates) {
  return { latitude: -origin.latitude, longitude: origin.longitude >= 0 ? origin.longitude - 180 : origin.longitude + 180 };
}
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);
  constructor(private readonly store: StoreService) {}
  private username(): string {
    const value = process.env.GEONAMES_USERNAME?.trim();
    if (!value) throw new ServiceUnavailableException('Missing GEONAMES_USERNAME');
    return value;
  }
  private async query(endpoint: string, params: Record<string,string|number>): Promise<GeoResponse|null> {
    const url = new URL(`https://secure.geonames.org/${endpoint}`);
    url.search = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)])), username:this.username() }).toString();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error();
      const data = await response.json() as GeoResponse;
      if (data.status) return null;
      return data;
    } catch { this.logger.warn(`GeoNames ${endpoint} unavailable`); return null; }
  }
  private async timezone(point: AntipodeCoordinates): Promise<GeoTimezoneData|null> {
    const data = await this.query('timezoneJSON', {lat:point.latitude,lng:point.longitude,radius:0});
    if (!data?.timezoneId) return null;
    try { new Intl.DateTimeFormat('en',{timeZone:data.timezoneId}).format(); } catch { return null; }
    const result: GeoTimezoneData = {timezoneId:data.timezoneId, countryCode:data.countryCode, countryName:data.countryName,
      rawOffset: data.rawOffset === undefined ? undefined : data.rawOffset*3600, sunrise:data.sunrise, sunset:data.sunset};
    result.utcOffsetSeconds = clockAt(result,new Date(),point.longitude).utcOffsetSeconds;
    return result;
  }
  async originTimezone(origin: OriginLocation): Promise<GeoTimezoneData|null> {
    const id = `origin-v2:${origin.latitude}:${origin.longitude}`;
    const cached = this.store.getGeoCache<GeoTimezoneData>(id);
    if (cached?.timezoneId) return cached;
    const value = await this.timezone(origin);
    if (value) this.store.saveGeoCache(id,value);
    return value;
  }
  async resolveOrigin(point: AntipodeCoordinates) {
    if (!validateCoordinates(point)) throw new BadRequestException('Invalid coordinates');
    const [data, timezone] = await Promise.all([
      this.query('findNearbyPlaceNameJSON',{lat:point.latitude,lng:point.longitude,radius:20,maxRows:1,cities:'cities1000',lang:'zh'}),
      this.timezone(point)
    ]);
    const raw = data?.geonames?.[0];
    const nearestPlace: OriginPlace|null = raw ? {geonameId:raw.geonameId,name:raw.name,countryName:raw.countryName,
      countryCode:raw.countryCode,adminName1:raw.adminName1,lat:Number(raw.lat),lng:Number(raw.lng),distanceKm:Number(raw.distance||0)} : null;
    return {success:true as const,data:{cityName:nearestPlace?.name || '当前位置',
      countryName:timezone?.countryName || nearestPlace?.countryName || '未知区域',nearestPlace,timezone}};
  }
  async resolveCombined(origin: OriginLocation, enrichOrigin: boolean) {
    const [originResponse,target,originTimezone] = await Promise.all([
      enrichOrigin ? this.resolveOrigin(origin) : Promise.resolve(null), this.resolveTarget(origin), this.originTimezone(origin)
    ]);
    return {origin:originResponse?.data || null,target,originTimezone};
  }
  async resolveTarget(origin: OriginLocation): Promise<GeoData> {
    if (!validateOrigin(origin)) throw new BadRequestException('Invalid origin location');
    this.username();
    const antipode = antipodeOf(origin);
    // 缓存使用完整坐标且有独立版本，旧的城市代理缓存永远不会参与目标解析。
    const id = `exact-v2:${antipode.latitude}:${antipode.longitude}`;
    const cached = this.store.getGeoCache<GeoData>(id);
    if (cached && cached.geoMeta.resolvedAt && Date.now()-Date.parse(cached.geoMeta.resolvedAt)<86400000) {
      return {...cached,targetLocation:{...cached.targetLocation,
        countryCode:cached.targetLocation.countryCode || (cached.targetLocation.kind === 'land' ? cached.timezone?.countryCode : undefined)},
        geoMeta:{...cached.geoMeta,source:'geonames_cache',cached:true}};
    }
    const [land,oceanResponse,timezone] = await Promise.all([
      this.query('countrySubdivisionJSON',{lat:antipode.latitude,lng:antipode.longitude,radius:0,lang:'zh'}),
      this.query('oceanJSON',{lat:antipode.latitude,lng:antipode.longitude,radius:0}),this.timezone(antipode)
    ]);
    const ocean = oceanResponse?.ocean?.name ? {name:oceanResponse.ocean.name} : null;
    const kind = ocean ? 'ocean' : land?.countryCode ? 'land' : 'unknown';
    const targetLocation: TargetLocation = {...antipode,kind,
      locationLabel:ocean?.name || (land?.countryCode ? [land.adminName1,land.countryName].filter(Boolean).join(' · ') : '地球另一端'),
      countryName:kind === 'land' ? land!.countryName || '' : '',regionName:kind === 'land' ? land!.adminName1 || '' : '',
      countryCode:kind === 'land' ? land!.countryCode : undefined,oceanName:ocean?.name};
    const result: GeoData = {antipode,targetLocation,distanceKm:Math.round(Math.PI*6371),ocean,timezone,
      geoMeta:{resolverVersion:2,source:kind === 'unknown' ? 'fallback' : 'geonames',cached:false,resolvedAt:new Date().toISOString()}};
    if (kind !== 'unknown') this.store.saveGeoCache(id,result);
    return result;
  }
}
