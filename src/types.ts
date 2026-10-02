export type LocationMode = 'device' | 'manual'
export type AvatarRole = 'office_worker' | 'student' | 'freelancer' | 'traveler'
export type TargetMode = 'antipode' | 'custom_location'
export type TargetKind = 'land' | 'ocean' | 'unknown'

export interface OriginGeoResolved {
	source: 'device_reverse'
	cityName: string
	countryName: string
	countryCode?: string
	timezoneId?: string
	geonameId?: number
	adminName1?: string
	lat?: number
	lng?: number
	distanceKm?: number
}

export interface AntipodeCoordinates {
	latitude: number
	longitude: number
}

export interface OriginLocation {
	mode: LocationMode
	cityName: string
	countryName: string
	latitude: number
	longitude: number
	accuracy?: number
	geoResolved?: OriginGeoResolved | null
}

export interface SelectedAvatar {
	id: string
	role: AvatarRole
	name: string
	description?: string
	emoji?: string
}

export interface TargetLocation extends AntipodeCoordinates {
  locationLabel: string
  countryName: string
  regionName: string
  kind: TargetKind
  oceanName?: string
}

export interface ProfileTimelineItem {
	time: string
	title: string
	state: string
	isCurrent?: boolean
	description?: string
	mood?: string
}

export interface VideoAsset {
	videoFileId: string
	posterFileId: string
	assetKey: string
	assetSource: 'placeholder_v1'
	durationSeconds: number
}

export interface GeoTimezoneData {
	timezoneId?: string
	utcOffsetSeconds?: number
	time?: string
	countryCode?: string
	countryName?: string
	rawOffset?: number
	dstOffset?: number
	sunrise?: string
	sunset?: string
}

export interface WorldClock {
  place: string
  date: string
  time: string
  relativeDay: string
  hour: number
  localMinutes: number
  weekday: number
  estimated: boolean
  utcOffsetSeconds: number
  isDay: boolean
  dayNight: string
  dayNightEstimated: boolean
  timeLabel: string
}
export interface Scene {
  habitat: 'boat_cabin' | 'land_home' | 'unknown_home'
  title: string
  description: string
  isDay: boolean
}
export interface VirtualProfileResult {
  originWorld: WorldClock
  targetWorld: WorldClock
  dailyStory: { date: string; title: string; text: string }
  nextActivity: ProfileTimelineItem
  scene: Scene
  connectionText: string
	localTime: string
	localDateLabel: string
	dayType: 'weekday' | 'weekend' | 'holiday'
	holidayName?: string
	currentState: string
	currentTitle: string
	currentDescription: string
	todayMood: string
	distanceKm: number
	timeline: ProfileTimelineItem[]
	shareText: string
	activityMeta?: {
		engineVersion: number
		source: string
	}
}

export interface VirtualProfile {
	_id: string
	openid?: string
	profileName: string
	profileStatus: 'active' | 'archived'
	selectedAvatar: SelectedAvatar
	creationSource: 'onboarding' | 'manual' | 'future_custom'
	originLocation: OriginLocation
	antipode?: AntipodeCoordinates
	targetMode: TargetMode
	targetLocation: TargetLocation
	result: VirtualProfileResult
	videoAsset?: VideoAsset | null
	metadata: {
		version: number
		activitySlotKey?: string
		lastRefreshedAt?: string | Date
		generator: 'nestjs_v1'
		timezoneId?: string
		countryCode?: string
		videoAssetGroupId?: string
		geo?: Record<string, unknown> | null
		ocean?: Record<string, unknown> | null
		timezoneData?: GeoTimezoneData | null
		originTimezoneData?: GeoTimezoneData | null
		activity?: Record<string, unknown> | null
		asset?: Record<string, unknown> | null
	}
	createdAt?: string | Date
	updatedAt?: string | Date
}

export interface ApiResponse<T> {
	success: boolean
	exists?: boolean
	data?: T
	message?: string
}

export interface CreateVirtualProfilePayload {
	originLocation: OriginLocation
	selectedAvatar: SelectedAvatar
	targetMode?: TargetMode
	profileName?: string
}

export interface DeleteVirtualProfilePayload {
	profileId?: string
	deleteActive?: boolean
}

export interface StoredSelectedCity {
	name: string
	country?: string
	latitude: number
	longitude: number
}

export interface StoredUserLocation {
	source: 'device'
	latitude: number
	longitude: number
	accuracy?: number
	createdAt: number
}

// 唯一公开的分享内容；不包含用户身份、档案 ID 或两端的坐标。
export interface ShareSnapshot {
  currentState: string
  id: string
  capturedAt: string
  avatar: { name: string; emoji: string; role: AvatarRole }
  originWorld: WorldClock
  targetWorld: WorldClock
  currentTitle: string
  currentDescription: string
  todayMood: string
  scene: Scene
  dailyStory: { date: string; title: string; text: string }
  connectionText: string
  shareText: string
}
