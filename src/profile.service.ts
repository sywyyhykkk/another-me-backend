import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from './store.service';
import { GeoService, validateOrigin, antipodeOf } from './geo.service';
import type { GeoData } from './geo.service';
import type { CreateVirtualProfilePayload, DeleteVirtualProfilePayload, GeoTimezoneData, OriginLocation, SelectedAvatar, ShareSnapshot, VirtualProfile } from './types';
import { clockAt, profileMoment } from './domain/world';

@Injectable()
export class ProfileService {
  constructor(private readonly store: StoreService, private readonly geo: GeoService) {}
  async create(openid: string, payload: CreateVirtualProfilePayload) {
    const avatar = payload?.selectedAvatar;
    if (!validateOrigin(payload?.originLocation) || !avatar || typeof avatar.id !== 'string' || !avatar.id || avatar.id.length>100
      || typeof avatar.name !== 'string' || !avatar.name.trim() || avatar.name.length>100
      || !['office_worker','student','freelancer','traveler'].includes(avatar.role)
      || (payload.targetMode && payload.targetMode !== 'antipode')
      || (payload.profileName !== undefined && (typeof payload.profileName !== 'string' || payload.profileName.length>200))) {
      throw new BadRequestException('Invalid profile payload');
    }
    let origin: OriginLocation = {mode:payload.originLocation.mode,cityName:payload.originLocation.cityName,
      countryName:payload.originLocation.countryName,latitude:payload.originLocation.latitude,longitude:payload.originLocation.longitude};
    const selectedAvatar: SelectedAvatar = {id:avatar.id,role:avatar.role,name:avatar.name,
      description:typeof avatar.description === 'string' ? avatar.description : '',emoji:typeof avatar.emoji === 'string' ? avatar.emoji : '💼'};
    const resolved = await this.geo.resolveCombined(origin,origin.mode === 'device');
    if (resolved.origin) {
      origin = {...origin,cityName:resolved.origin.cityName,countryName:resolved.origin.countryName,
        geoResolved:{source:'device_reverse',cityName:resolved.origin.cityName,countryName:resolved.origin.countryName,
          timezoneId:resolved.origin.timezone?.timezoneId,countryCode:resolved.origin.timezone?.countryCode}};
    }
    const now = new Date().toISOString();
    const profile = this.store.createProfile({openid,profileName:payload.profileName || `${selectedAvatar.name} · ${origin.cityName}的另一端`,
      profileStatus:'active',selectedAvatar,creationSource:'onboarding',originLocation:origin,targetMode:'antipode',
      ...this.content(selectedAvatar,origin,resolved.target,resolved.originTimezone),createdAt:now,updatedAt:now});
    return {success:true,exists:true,data:profile};
  }
  async getActive(openid: string, _forceRefresh: boolean) {
    const profile = this.store.getActiveProfile(openid);
    if (!profile) return {success:true,exists:false,data:null};
    const meta = profile.metadata;
    const expected = antipodeOf(profile.originLocation);
    let geo: GeoData;
    if (meta.geo?.resolverVersion !== 2 || !profile.targetLocation.kind
      || profile.targetLocation.latitude !== expected.latitude || profile.targetLocation.longitude !== expected.longitude
      || meta.geo?.source === 'fallback' || !meta.geo?.resolvedAt || Date.now()-Date.parse(String(meta.geo.resolvedAt))>=86400000) {
      geo = await this.geo.resolveTarget(profile.originLocation);
    } else {
      geo = {antipode:expected,targetLocation:profile.targetLocation,distanceKm:Math.round(Math.PI*6371),
        ocean:meta.ocean as GeoData['ocean'],timezone:meta.timezoneData || null,geoMeta:meta.geo as unknown as GeoData['geoMeta']};
    }
    const originTimezone = meta.originTimezoneData || await this.geo.originTimezone(profile.originLocation);
    const updated = {...profile,...this.content(profile.selectedAvatar,profile.originLocation,geo,originTimezone),updatedAt:new Date().toISOString()};
    if (this.store.getActiveProfile(openid)?._id !== profile._id) {
      const current=this.store.getActiveProfile(openid);
      return {success:true,exists:Boolean(current),data:current};
    }
    this.store.updateProfile(updated);
    return {success:true,exists:true,data:updated};
  }
  delete(openid: string, payload: DeleteVirtualProfilePayload) {
    const profileId = payload?.deleteActive ? this.store.getActiveProfile(openid)?._id : payload?.profileId;
    if (!profileId || typeof profileId !== 'string') throw new BadRequestException('Invalid profile payload');
    if (!this.store.deleteProfile(openid,profileId)) throw new NotFoundException('Profile not found');
    return {success:true,data:null};
  }
  async share(openid: string) {
    const response = await this.getActive(openid,true);
    if (!response.data) throw new NotFoundException('Profile not found');
    const profile = response.data;
    const capturedAt = new Date().toISOString();
    const result = profileMoment(profile,new Date(capturedAt));
    // 白名单投影，公开接口永远不回传私人档案或坐标。
    const snapshot: Omit<ShareSnapshot,'id'> = {capturedAt,
      avatar:{name:profile.selectedAvatar.name,emoji:profile.selectedAvatar.emoji || '🌏',role:profile.selectedAvatar.role},
      originWorld:result.originWorld,targetWorld:result.targetWorld,currentTitle:result.currentTitle,currentState:result.currentState,
      currentDescription:result.currentDescription,todayMood:result.todayMood,scene:result.scene,
      dailyStory:result.dailyStory,connectionText:result.connectionText,shareText:result.shareText};
    return {success:true,data:this.store.createShare(snapshot)};
  }
  getShare(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException('Snapshot not found');
    const snapshot = this.store.getShare(id);
    if (!snapshot) throw new NotFoundException('Snapshot not found');
    return {success:true,data:snapshot};
  }
  private content(avatar: SelectedAvatar, origin: OriginLocation, geo: GeoData, originTimezone: GeoTimezoneData|null): Pick<VirtualProfile,'antipode'|'targetLocation'|'result'|'videoAsset'|'metadata'> {
    if (geo.timezone?.timezoneId) geo.timezone={...geo.timezone,utcOffsetSeconds:clockAt(geo.timezone,new Date(),geo.antipode.longitude).utcOffsetSeconds};
    if (originTimezone?.timezoneId) originTimezone={...originTimezone,utcOffsetSeconds:clockAt(originTimezone,new Date(),origin.longitude).utcOffsetSeconds};
    const metadata: VirtualProfile['metadata'] = {version:2,generator:'nestjs_v1',lastRefreshedAt:new Date().toISOString(),
      geo:{...geo.geoMeta},ocean:geo.ocean,timezoneId:geo.timezone?.timezoneId,countryCode:geo.timezone?.countryCode,
      timezoneData:geo.timezone,originTimezoneData:originTimezone};
    const result = profileMoment({selectedAvatar:avatar,originLocation:origin,targetLocation:geo.targetLocation,metadata,result:{distanceKm:geo.distanceKm}});
    return {antipode:geo.antipode,targetLocation:geo.targetLocation,result,videoAsset:null,metadata};
  }
}
