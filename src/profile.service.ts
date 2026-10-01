import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from './store.service';
import { GeoService, validateOrigin } from './geo.service';
import type { GeoData } from './geo.service';
import type { CreateVirtualProfilePayload, DeleteVirtualProfilePayload, OriginLocation, SelectedAvatar, VirtualProfile } from './types';
import { buildActivityResult } from './domain/activity';
import { resolveVideoAsset } from './domain/assets';
import { getCurrentActivitySlot, buildActivitySlotKey } from './domain/schedule';

@Injectable()
export class ProfileService {
  constructor(private readonly store: StoreService, private readonly geo: GeoService) {}

  async create(openid: string, payload: CreateVirtualProfilePayload) {
    const avatar = payload?.selectedAvatar;
    if (!validateOrigin(payload?.originLocation) || !avatar
      || typeof avatar.id !== 'string' || !avatar.id || avatar.id.length > 100
      || typeof avatar.name !== 'string' || !avatar.name.trim() || avatar.name.length > 100
      || !['office_worker', 'student', 'freelancer', 'traveler'].includes(avatar.role)
      || (payload.targetMode && payload.targetMode !== 'antipode')
      || (payload.profileName !== undefined && (typeof payload.profileName !== 'string' || payload.profileName.length > 200))) {
      throw new BadRequestException('Invalid profile payload');
    }
    // 只保存业务字段，用户身份始终取自已验证的登录会话。
    let origin: OriginLocation = { mode: payload.originLocation.mode, cityName: payload.originLocation.cityName,
      countryName: payload.originLocation.countryName, latitude: payload.originLocation.latitude,
      longitude: payload.originLocation.longitude };
    const selectedAvatar: SelectedAvatar = { id: avatar.id, role: avatar.role, name: avatar.name,
      description: typeof avatar.description === 'string' ? avatar.description : '',
      emoji: typeof avatar.emoji === 'string' ? avatar.emoji : '💼' };
    const resolved = await this.geo.resolveCombined(origin, origin.mode === 'device');
    if (resolved.origin) {
      const { nearestPlace: place, timezone } = resolved.origin;
      origin = { ...origin, cityName: resolved.origin.cityName, countryName: resolved.origin.countryName,
        geoResolved: { source: 'device_reverse', cityName: resolved.origin.cityName, countryName: resolved.origin.countryName,
          countryCode: place?.countryCode || timezone?.countryCode, timezoneId: timezone?.timezoneId,
          geonameId: place?.geonameId, adminName1: place?.adminName1, lat: place?.lat, lng: place?.lng,
          distanceKm: place?.distanceKm } };
    }
    const now = new Date().toISOString();
    const profile = this.store.createProfile({ openid,
      profileName: payload.profileName || `${selectedAvatar.name} · ${origin.cityName}的另一端`,
      profileStatus: 'active', selectedAvatar, creationSource: 'onboarding', originLocation: origin,
      targetMode: 'antipode', ...this.content(selectedAvatar, resolved.target), createdAt: now, updatedAt: now });
    return { success: true, exists: true, data: profile };
  }

  async getActive(openid: string, forceRefresh: boolean) {
    const profile = this.store.getActiveProfile(openid);
    if (!profile) return { success: true, exists: false, data: null };
    const meta = profile.metadata;
    let geo: GeoData = { antipode: profile.antipode!, targetLocation: profile.targetLocation,
      distanceKm: profile.result.distanceKm, nearestPlace: meta.nearestPlace as GeoData['nearestPlace'],
      ocean: meta.ocean as GeoData['ocean'], timezone: meta.timezoneData || null,
      geoMeta: meta.geo as unknown as GeoData['geoMeta'] };
    let geoChanged = false;
    if (!geo.timezone?.timezoneId || geo.geoMeta.source === 'fallback') {
      try { geo = await this.geo.resolveTarget(profile.originLocation); geoChanged = true; }
      catch { /* 保留已有坐标结果，仍可按当地日程刷新。 */ }
    }
    const slotKey = this.slotKey(profile.selectedAvatar, geo);
    if (forceRefresh || geoChanged || profile.metadata.activitySlotKey !== slotKey) {
      const updated = { ...profile, ...this.content(profile.selectedAvatar, geo), updatedAt: new Date().toISOString() };
      // 地理查询期间用户可能创建或删除档案，避免覆盖新的活动档案。
      if (this.store.getActiveProfile(openid)?._id === profile._id) {
        this.store.updateProfile(updated);
        return { success: true, exists: true, data: updated };
      }
      const current = this.store.getActiveProfile(openid);
      return { success: true, exists: Boolean(current), data: current };
    }
    return { success: true, exists: true, data: profile };
  }

  delete(openid: string, payload: DeleteVirtualProfilePayload) {
    const profileId = payload?.deleteActive ? this.store.getActiveProfile(openid)?._id : payload?.profileId;
    if (!profileId || typeof profileId !== 'string') throw new BadRequestException('Invalid profile payload');
    if (!this.store.deleteProfile(openid, profileId)) throw new NotFoundException('Profile not found');
    return { success: true, data: null };
  }

  private slotKey(avatar: SelectedAvatar, geo: GeoData): string {
    const slot = getCurrentActivitySlot(avatar.role, geo.timezone, new Date(), geo.antipode.longitude);
    return slot ? buildActivitySlotKey(avatar.role, slot.index, slot.localDateKey) : '';
  }

  private content(avatar: SelectedAvatar, geo: GeoData): Pick<VirtualProfile, 'antipode' | 'targetLocation' | 'result' | 'videoAsset' | 'metadata'> {
    const result = buildActivityResult({ selectedAvatar: avatar, distanceKm: geo.distanceKm,
      geoMeta: geo.geoMeta, timezone: geo.timezone, antipode: geo.antipode })!;
    const videoAsset = resolveVideoAsset({ avatarRole: avatar.role, currentState: result.currentState });
    return { antipode: geo.antipode, targetLocation: geo.targetLocation, result, videoAsset,
      metadata: { version: 1, generator: 'nestjs_v1', activitySlotKey: this.slotKey(avatar, geo),
        lastRefreshedAt: new Date().toISOString(), geo: { ...geo.geoMeta },
        nearestPlace: geo.nearestPlace ? { ...geo.nearestPlace } : null, ocean: geo.ocean,
        timezoneId: geo.timezone?.timezoneId, countryCode: geo.timezone?.countryCode,
        timezoneData: geo.timezone, activity: { ...result.activityMeta },
        asset: videoAsset ? { assetKey: videoAsset.assetKey, assetSource: videoAsset.assetSource } : null } };
  }
}
