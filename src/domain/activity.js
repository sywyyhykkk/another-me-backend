const {
  getTimelineTemplate,
  getCurrentTimelineIndex,
  getLocalTimePartsFromTimezone,
  normalizeTimezoneForUse,
  resolveDayType
} = require('./schedule')

/** @returns {import('../types').VirtualProfileResult | null} */
function buildActivityResult({ selectedAvatar, distanceKm, geoMeta, timezone, antipode }) {
  if (!validateSelectedAvatar(selectedAvatar)) {
    return null
  }

  const avatar = normalizeSelectedAvatar(selectedAvatar)
  const km = typeof distanceKm === 'number' ? distanceKm : 0
  const antipodeLongitude =
    antipode && typeof antipode.longitude === 'number' ? antipode.longitude : undefined

  return buildResult(avatar, km, geoMeta, timezone, antipodeLongitude)
}

function validateSelectedAvatar(selectedAvatar) {
  if (!selectedAvatar) return false
  return (
    typeof selectedAvatar.id === 'string' &&
    typeof selectedAvatar.role === 'string' &&
    typeof selectedAvatar.name === 'string'
  )
}

function normalizeSelectedAvatar(selectedAvatar) {
  const roleMap = {
    office: 'office_worker',
    office_worker: 'office_worker',
    student: 'student',
    free: 'freelancer',
    freelancer: 'freelancer',
    traveler: 'traveler'
  }

  return {
    id: selectedAvatar.id,
    role: roleMap[selectedAvatar.role] || roleMap[selectedAvatar.id] || 'office_worker',
    name: selectedAvatar.name,
    description: selectedAvatar.description || '',
    emoji: selectedAvatar.emoji || '💼'
  }
}

const MOODS_BY_ROLE_AND_STATE = {
  office_worker: {
    sleeping: [
      '睡得正沉',
      '睡意正浓',
      '被窝封印中',
      '安静回血'
    ],
    eating: [
      '短暂放松',
      '补充体力中',
      '边吃边放空',
      '饭点救命'
    ],
    working: [
      '专注处理中',
      '有点忙',
      '稳步推进',
      '头脑在线',
      '认真搬砖'
    ],
    relaxing: [
      '终于松口气',
      '缓解疲劳',
      '短暂摆烂',
      '下班松弛感',
      '脑子放空中'
    ]
  },
  student: {
    sleeping: [
      '睡得迷迷糊糊',
      '被窝续命中',
      '困意正浓',
      '梦里也很忙'
    ],
    eating: [
      '食堂干饭中',
      '补充能量',
      '边吃边聊天',
      '胃口不错'
    ],
    studying: [
      '认真听讲',
      '笔记满满',
      '努力跟上',
      '偶尔走神',
      '脑子加载中'
    ],
    relaxing: [
      '课间放空',
      '刷会儿手机',
      '发呆恢复中',
      '难得轻松',
      '短暂自由'
    ]
  },
  freelancer: {
    sleeping: [
      '自然睡眠中',
      '节奏很慢',
      '被窝办公未启动',
      '安稳充电中'
    ],
    eating: [
      '自在用餐',
      '边吃边想项目',
      '随便对付一口',
      '胃口还行'
    ],
    working: [
      '进入状态',
      '思路清晰',
      '独自推进中',
      '处理琐事',
      '效率在线'
    ],
    relaxing: [
      '随性放松',
      '今天不赶工',
      '慢悠悠放空',
      '闲散片刻',
      '漫步神游'
    ]
  },
  traveler: {
    sleeping: [
      '旅途中熟睡',
      '养足精神中',
      '睡得很香',
      '梦里看风景'
    ],
    eating: [
      '味蕾兴奋',
      '尝试当地味',
      '边吃边观察',
      '满足感上来',
      '旅行胃口很好'
    ],
    traveling: [
      '探索欲拉满',
      '脚步轻快',
      '风景上头',
      '大开眼界',
      '兴奋赶路中'
    ],
    relaxing: [
      '放慢脚步',
      '看风景发呆',
      '回味刚才',
      '旅途小憩',
      '悠闲晃荡'
    ]
  }
}

const DEEP_SLEEP_MOODS_BY_ROLE = {
  office_worker: [
    '熟睡中',
    '睡得正沉',
    '安静回血',
    '深度断电',
    '酣睡中'
  ],
  student: [
    '熟睡中',
    '睡得很沉',
    '梦里上课',
    '被窝封印',
    '安静充电'
  ],
  freelancer: [
    '熟睡中',
    '自然深睡',
    '节奏很慢',
    '安稳充电',
    '睡得正香'
  ],
  traveler: [
    '熟睡中',
    '旅途中深睡',
    '梦里看风景',
    '睡得正香',
    '安静回血'
  ]
}

function getTodayMood(role, state, localMinutes, activityTitle) {
  if (activityTitle === '正在睡觉') {
    const pool = DEEP_SLEEP_MOODS_BY_ROLE[role] || DEEP_SLEEP_MOODS_BY_ROLE.office_worker
    if (typeof localMinutes !== 'number') {
      return pool[0]
    }
    return pool[localMinutes % pool.length]
  }

  const rolePool = MOODS_BY_ROLE_AND_STATE[role] || MOODS_BY_ROLE_AND_STATE.office_worker
  const pool = rolePool[state] || rolePool.relaxing || ['平静']
  if (typeof localMinutes !== 'number') {
    return pool[0]
  }
  return pool[localMinutes % pool.length]
}

function getCurrentTitleByState(state) {
  const map = {
    working: '另一个你正在工作',
    studying: '另一个你正在学习',
    relaxing: '另一个你正在放松',
    traveling: '另一个你正在远方游玩',
    sleeping: '另一个你正在睡觉',
    eating: '另一个你正在用餐'
  }
  return map[state] || '另一个你正在生活'
}

function getCurrentTitle(currentItem) {
  const activityTitle = currentItem && currentItem.title
  const byActivityTitle = {
    正在睡觉: '另一个你正在睡觉',
    准备睡觉: '另一个你准备入睡',
    起床: '另一个你刚起床',
    吃早餐: '另一个你正在吃早餐',
    早餐: '另一个你正在吃早餐',
    午餐: '另一个你正在吃午餐',
    晚餐: '另一个你正在吃晚餐',
    工作: '另一个你正在工作',
    继续工作: '另一个你正在工作',
    上课: '另一个你正在上课',
    继续学习: '另一个你正在学习',
    发呆: '另一个你正在发呆',
    放松: '另一个你正在放松',
    自由时间: '另一个你正在享受自由时间',
    处理事务: '另一个你正在处理事务',
    街头漫步: '另一个你正在街头漫步',
    探索远方: '另一个你正在探索远方',
    看风景: '另一个你正在看风景'
  }

  if (activityTitle && byActivityTitle[activityTitle]) {
    return byActivityTitle[activityTitle]
  }

  return getCurrentTitleByState(currentItem && currentItem.state)
}

const DESCRIPTION_BY_ROLE_AND_TITLE = {
  office_worker: {
    正在睡觉: '地球另一端夜深人静，另一个你正睡得很沉，城市的灯光也安静下来。',
    起床: '当地清晨刚开始，另一个你从睡意里慢慢醒来，准备进入普通但忙碌的一天。',
    吃早餐: '另一个你坐下吃早餐，用一点热食和咖啡把大脑慢慢叫醒。',
    工作: '地球另一端正值办公时段，另一个你坐在电脑前处理邮件、沟通任务和准备会议。',
    午餐: '另一个你趁午休离开工位，在附近简单吃一顿饭，让紧绷的上午稍微松下来。',
    继续工作: '午后的办公时间继续，另一个你回到屏幕前，把未完成的事项一项项推进。',
    晚餐: '下班后的另一个你正在吃晚餐，把白天的消息、会议和待办暂时放到一边。',
    放松: '另一个你结束了一天的工作，靠在沙发上放空，让疲惫慢慢退下去。',
    准备睡觉: '当地夜色已深，另一个你洗漱完毕，关掉屏幕，准备结束这一天。'
  },
  student: {
    正在睡觉: '地球另一端的夜色里，另一个你正睡得很沉，书本和作业暂时都安静了。',
    起床: '另一个你在闹钟声里醒来，带着一点困意开始学生的一天。',
    吃早餐: '另一个你匆匆吃着早餐，背包放在身边，脑子还在慢慢加载。',
    上课: '地球另一端的教室里，另一个你正在听课、记笔记，偶尔和窗外的风景对视。',
    午餐: '课间休息时，另一个你和同学一起吃午餐，聊着课程、作业和一些没那么重要的小事。',
    继续学习: '下午的学习还在继续，另一个你埋头写作业、整理笔记，把知识一点点塞进脑子里。',
    晚餐: '另一个你结束下午的课程或自习，在食堂吃晚餐，让空掉的胃重新上线。',
    发呆: '学习暂时告一段落，另一个你放空发呆，让大脑从公式、单词和论文里短暂逃离。',
    准备睡觉: '当地已到深夜，另一个你收起书本和电子设备，准备开始休息。'
  },
  freelancer: {
    正在睡觉: '地球另一端的夜晚很安静，另一个你正睡得安稳，没有通勤闹钟追在身后。',
    起床: '没有固定打卡时间的另一个你自然醒来，在缓慢的节奏里启动新的一天。',
    早餐: '另一个你一边吃早餐，一边浏览消息和灵感，盘算今天要先处理哪件事。',
    处理事务: '另一个你坐在电脑前回复客户、整理文件、确认进度，自由职业的一天正式运转。',
    午餐: '另一个你暂停手头项目，简单吃顿午餐，让工作节奏暂时慢下来。',
    自由时间: '地球另一端阳光正好，另一个你出门散步、喝咖啡，给自己留一点不被任务占满的时间。',
    晚餐: '另一个你在小馆或家里吃晚餐，把白天零散的工作慢慢收拢成一段回忆。',
    放松: '另一个你关掉工作通知，听歌、阅读，或和朋友线上闲聊，把时间重新还给自己。',
    准备睡觉: '当地已近午夜，另一个你放下未完成的想法，准备开始休息。'
  },
  traveler: {
    正在睡觉: '旅途中的另一个你在地球另一端沉沉睡去，陌生的城市也在夜色里安静下来。',
    起床: '另一个你在不一样的时区醒来，窗外是陌生但新鲜的天空。',
    早餐: '另一个你在街边小店吃早餐，翻看今天的路线，顺便观察这座城市慢慢醒来。',
    街头漫步: '另一个你走在地球另一端的街头，拍照、看橱窗，感受路过的人群和风。',
    午餐: '走了一上午的另一个你坐下来，用一顿当地风味午餐补充体力。',
    探索远方: '另一个你搭车前往新的目的地，把地图上的标点变成亲眼见到的风景。',
    晚餐: '另一个你在夜市或小餐馆吃晚餐，味蕾、灯光和人声一起变成旅途记忆。',
    看风景: '暮色里的另一个你停下脚步，看日落、街灯、海面或远处慢慢亮起的城市。',
    准备睡觉: '旅途中的另一个你回到住处，整理照片和今天的记忆，准备安心入睡。'
  }
}

function getCurrentDescription(role, currentItem) {
  const roleMap = DESCRIPTION_BY_ROLE_AND_TITLE[role] || DESCRIPTION_BY_ROLE_AND_TITLE.office_worker
  const title = currentItem && currentItem.title
  if (title && roleMap[title]) {
    return roleMap[title]
  }

  const state = currentItem && currentItem.state
  const stateFallback = {
    working: '另一个你正忙于地球另一端的工作事务。',
    studying: '另一个你正沉浸在地球另一端的学习里。',
    relaxing: '另一个你正享受地球另一端难得的悠闲时刻。',
    traveling: '另一个你正行走在地球另一端的路上。',
    sleeping: '另一个你正休息，地球另一端此刻安静而缓慢。',
    eating: '另一个你正在地球另一端用餐，补充这一天的能量。'
  }
  return stateFallback[state] || '根据当地时间和生活节奏，另一个你正在地球另一端过着属于它的此刻。'
}

function buildTimelineWithCurrent(timeline, currentIndex) {
  return timeline.map((item, index) => ({
    ...item,
    isCurrent: index === currentIndex
  }))
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatLocalTimeFromTimezone(timezone, date, antipodeLongitude) {
  const tz = normalizeTimezoneForUse(timezone)
  const parts = getLocalTimePartsFromTimezone(tz, date, antipodeLongitude)
  if (!parts) {
    return { localTime: '--:--', localDateLabel: '当地时间', localMinutes: null }
  }
  const localTime = `${pad2(parts.hour)}:${pad2(parts.minute)}`
  let localDateLabel = '当地时间'

  if (tz && tz.timezoneId) {
    try {
      const weekday = new Intl.DateTimeFormat('zh-CN', {
        timeZone: tz.timezoneId,
        weekday: 'long'
      }).format(date || new Date())
      localDateLabel = `当地时间 · ${weekday}`
    } catch (error) {
      localDateLabel = tz.timezoneId ? `当地时间 · ${tz.timezoneId}` : '当地时间'
    }
  }

  return {
    localTime,
    localDateLabel,
    localMinutes: parts.localMinutes
  }
}

function buildResult(selectedAvatar, distanceKm, geoMeta, timezone, antipodeLongitude) {
  const tz = normalizeTimezoneForUse(timezone)
  const at = new Date()
  const { localTime, localDateLabel, localMinutes } = formatLocalTimeFromTimezone(
    tz,
    at,
    antipodeLongitude
  )

  const timelineTemplate = getTimelineTemplate(selectedAvatar.role)
  const currentIndex =
    typeof localMinutes === 'number'
      ? getCurrentTimelineIndex(timelineTemplate, localMinutes)
      : timelineTemplate.length - 1
  const currentItem = timelineTemplate[currentIndex]
  const currentState = currentItem.state
  const currentTitle = getCurrentTitle(currentItem)
  const currentDescription = getCurrentDescription(selectedAvatar.role, currentItem)
  const todayMood = getTodayMood(
    selectedAvatar.role,
    currentState,
    localMinutes,
    currentItem.title
  )

  return {
    localTime,
    localDateLabel,
    dayType: resolveDayType(tz, at, antipodeLongitude),
    currentState,
    currentTitle,
    currentDescription,
    todayMood,
    distanceKm,
    timeline: buildTimelineWithCurrent(timelineTemplate, currentIndex),
    shareText: '地球另一端的我，正在过另一种此刻。',
    activityMeta: {
      engineVersion: 3,
      source: geoMeta && geoMeta.source ? `activity_from_${geoMeta.source}` : 'default'
    }
  }
}

module.exports = {
  buildActivityResult
}
