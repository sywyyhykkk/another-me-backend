// 前后端共用的规则：日期和角色决定当天内容，时钟只推进当前状态。
export function clockAt(timezone, at = new Date(), longitude = 0) {
  let shifted;
  let estimated = true;
  if (timezone?.timezoneId) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone.timezoneId,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
      const p = Object.fromEntries(parts.map(item => [item.type, item.value]));
      shifted = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
      estimated = false;
    } catch { /* 不支持该 IANA 时区时使用服务端确认的当前偏移。 */ }
  }
  if (!shifted) {
    const confirmed = Number.isFinite(timezone?.utcOffsetSeconds);
    const offset = confirmed ? timezone.utcOffsetSeconds : Math.round(longitude / 15) * 3600;
    shifted = new Date(at.getTime() + offset * 1000);
    estimated = !confirmed;
  }
  const date = shifted.toISOString().slice(0, 10);
  const hour = shifted.getUTCHours(), minute = shifted.getUTCMinutes();
  return { date, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    hour, localMinutes: hour * 60 + minute, weekday: shifted.getUTCDay(), estimated,
    utcOffsetSeconds: Math.floor(shifted.getTime() / 1000) - Math.floor(at.getTime() / 1000) };
}

function daylight(point, at, clock, timezone) {
  const sunrise = timezone?.sunrise, sunset = timezone?.sunset;
  if (sunrise?.startsWith(clock.date + ' ') && sunset?.startsWith(clock.date + ' ')) {
    return { isDay: clock.time >= sunrise.slice(11,16) && clock.time < sunset.slice(11,16), dayNightEstimated: false };
  }
  // 太阳高度的近似规则支持极昼/极夜；日出日落只展示地理服务当日返回值。
  const rad = Math.PI / 180;
  const day = Math.floor((at - Date.UTC(at.getUTCFullYear(), 0, 0)) / 86400000);
  const utcHour = at.getUTCHours() + at.getUTCMinutes() / 60;
  const gamma = 2 * Math.PI / 365 * (day - 1 + (utcHour - 12) / 24);
  const decl = 0.006918 - 0.399912*Math.cos(gamma) + 0.070257*Math.sin(gamma)
    - 0.006758*Math.cos(2*gamma) + 0.000907*Math.sin(2*gamma)
    - 0.002697*Math.cos(3*gamma) + 0.00148*Math.sin(3*gamma);
  const eq = 229.18 * (0.000075 + 0.001868*Math.cos(gamma) - 0.032077*Math.sin(gamma)
    - 0.014615*Math.cos(2*gamma) - 0.040849*Math.sin(2*gamma));
  const angle = (utcHour * 60 + eq + 4*point.longitude) / 4 - 180;
  const altitude = Math.asin(Math.sin(point.latitude*rad)*Math.sin(decl)
    + Math.cos(point.latitude*rad)*Math.cos(decl)*Math.cos(angle*rad)) / rad;
  return { isDay: altitude > -0.833, dayNightEstimated: true };
}

export function worldAt(place, point, timezone, at, referenceDate, ocean = false) {
  const clock = clockAt(timezone, at, point.longitude);
  const delta = referenceDate ? Math.round((Date.parse(clock.date) - Date.parse(referenceDate)) / 86400000) : 0;
  const relativeDay = delta === -1 ? '昨天' : delta === 0 ? '今天' : delta === 1 ? '明天' : clock.date;
  const light = daylight(point, at, clock, timezone);
  const offset = clock.utcOffsetSeconds / 3600;
  const utcLabel = `UTC${offset >= 0 ? '+' : ''}${offset}`;
  return { ...clock, ...light, place, relativeDay, dayNight: light.isDay ? '白昼' : '夜晚',
    timeLabel: clock.estimated ? `${ocean ? '海上时间' : '当地时间'} · 估算 · ${utcLabel}` : `${timezone?.timezoneId || utcLabel}` };
}

const ROLES = ['office_worker', 'student', 'freelancer', 'traveler'];
const WORK = {
  office_worker: [['工作', 'working'], ['继续工作', 'working']],
  student: [['看书学习', 'studying'], ['整理笔记', 'studying']],
  freelancer: [['写作', 'working'], ['做饭与整理灵感', 'relaxing']],
  traveler: [['观察风景', 'traveling'], ['记录见闻', 'traveling']]
};
const WEEKEND = {
  office_worker: [['读一本闲书', 'relaxing'], ['整理小屋', 'relaxing']],
  student: [['读课外书', 'studying'], ['画一页小画', 'relaxing']],
  freelancer: [['写一段随笔', 'working'], ['慢慢做饭', 'eating']],
  traveler: [['观察风景的细节', 'traveling'], ['整理旅途手记', 'relaxing']]
};
const STORIES = {
  land: {
    office_worker: [['一张小便签', '想在便签上记下一个小目标', '在便签旁完成了第一件待办', '把写满的便签夹进本子'], ['换一本书', '想翻开搁置很久的书', '读到一句喜欢的话', '给那句话做了一个记号'], ['一杯热茶', '准备泡一杯热茶', '端着茶杯整理思路', '洗好茶杯，留给明天']],
    student: [['新书签', '想给正在读的书做个书签', '在书签上写下一句话', '用新书签标好今天读到的一页'], ['一页涂鸦', '准备在笔记边角画点什么', '画下窗外天空的颜色', '收好这张小画'], ['一道难题', '打算把昨天的难题再想一遍', '在纸上找到一点新思路', '记下今天想明白的部分']],
    freelancer: [['新的开头', '想为一段故事写个开头', '写下了第一段文字', '给明天的续写留下一句话'], ['慢炖小锅', '打算为自己做一锅热食', '试着调整小锅里的味道', '把这次的做法记在纸上'], ['灵感本', '想整理几页旧灵感', '挑出一个值得继续的想法', '给它留出新的一页']],
    traveler: [['天空色卡', '打算记住今天的天空颜色', '在手记里涂下一块颜色', '为色卡写下今天的日期'], ['一段观察', '想认真观察身边一个细节', '把观察到的细节写进本子', '重读记录，补上一句感受'], ['一页手绘', '准备画下眼前的风景', '给草图补上几条线', '给完成的小画签上日期']]
  },
  ocean: {
    office_worker: [['船舱便签', '想给船舱书桌贴一张便签', '在便签旁处理完第一封邮件', '将写满的便签收进航海本'], ['窗边热茶', '准备在舷窗边泡茶', '端着热茶整理工作思路', '洗好杯子放回船舱架上'], ['桌上的小目标', '想给今天列一个小目标', '在船舱书桌前慢慢推进', '划掉完成的目标，收好本子']],
    student: [['海蓝书签', '想做一枚海蓝色的书签', '给书签画上舷窗外的波纹', '把书签夹在读到的一页'], ['浪声笔记', '打算在读书间隙记下浪声', '为读到的句子写下感想', '把读书笔记放回船舱'], ['一本旧书', '想重读船舱里的一本旧书', '发现以前漏读的一句话', '用铅笔轻轻标好那一行']],
    freelancer: [['船舱小锅', '想用船舱储备食材煮点热食', '在小锅里慢慢调味', '把小锅洗净，记下今天的配方'], ['海上的开头', '想写一个关于海面的开头', '在舷窗旁写下第一段', '收好稿纸，留一句给明天'], ['浪声随笔', '打算把浪声写进随笔', '在船舱桌前记录一个比喻', '为随笔写上日期']],
    traveler: [['海面色卡', '想记住今天海面的颜色', '在甲板上为海面画一块色卡', '把色卡贴进航海手记'], ['波纹速写', '准备画下舷窗外的波纹', '为波纹速写补上几条线', '收好这页关于海面的画'], ['航海手记', '想仔细观察船边的海面', '写下一段关于浪花的见闻', '整理今天的观察记录']]
  }
};

export function dailyPlan(role, point, date, ocean = false) {
  const dateNumber = Math.floor(Date.parse(date) / 86400000);
  const seed = Math.abs(dateNumber + ROLES.indexOf(role)*7 + Math.round(point.latitude*10) + Math.round(point.longitude*10));
  const weekend = [0,6].includes(new Date(date + 'T12:00:00Z').getUTCDay());
  const activities = (weekend ? WEEKEND : WORK)[role] || WORK.office_worker;
  const shift = ((seed % 5) - 2) * 10;
  const wake = (weekend ? 510 : role === 'freelancer' ? 480 : 420) + shift;
  const events = [[0,'睡觉','sleeping'], [wake,'起床，整理小屋','relaxing'], [wake+45,'吃早餐','eating'],
    [wake+90,activities[0][0],activities[0][1]], [750+shift,'吃午餐','eating'],
    [900+shift,activities[1][0],activities[1][1]], [1110+shift,'准备晚餐','eating'],
    [1200+shift,role === 'traveler' ? '回看今天的手记' : '阅读与休息','relaxing'], [1380+shift,'睡觉','sleeping']];
  const motif = (STORIES[ocean ? 'ocean' : 'land'][role] || STORIES.land.office_worker)[seed % 3];
  const place = ocean ? '船舱' : '小屋';
  const timeline = events.map(([minutes,title,state],index) => {
    if (ocean && role === 'office_worker' && state === 'working') title = index === 3 ? '船舱办公' : '船舱继续办公';
    if (ocean && role === 'traveler' && state === 'traveling') title = index === 3 ? '观察海面' : '记录海上见闻';
    const phase = minutes < 750 ? 1 : minutes < 1200 ? 2 : 3;
    const echo = state === 'sleeping' ? (minutes === 0 ? '今天的小事还在等它醒来。' : `${motif[3]}，结束这一天。`) : `${motif[phase]}。`;
    const action = state === 'sleeping' ? `它在${place}里安静休息。`
      : ocean && role === 'office_worker' && state === 'working' ? `它正在${title}。`
      : `它${ocean && state === 'traveling' && index === 3 ? '站在船边' : `留在${place}`}，${title}。`;
    return { time: `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`,
      title, state, description: action + echo, mood: ({sleeping:'睡得安稳',working:'专注而平静',studying:'慢慢想明白',eating:'暖暖的满足',traveling:'满怀好奇',relaxing:'自在松弛'})[state] };
  });
  return { date, dayType: weekend ? 'weekend' : 'weekday', timeline, story: { title: motif[0], phases: motif.slice(1) } };
}

export function currentIndex(timeline, minutes) {
  let index = 0;
  timeline.forEach((item, i) => { const [h,m] = item.time.split(':').map(Number); if (h*60+m <= minutes) index=i; });
  return index;
}

function period(hour) { return hour < 5 ? '夜深了' : hour < 9 ? '迎来清晨' : hour < 12 ? '是上午' : hour < 14 ? '到了午间' : hour < 18 ? '是下午' : hour < 22 ? '进入晚间' : '夜深了'; }
export function connectionText(origin, target, title) {
  const targetPeriod = target.hour < 5 ? '深夜' : target.hour < 9 ? '清晨' : target.hour < 12 ? '上午' : target.hour < 14 ? '午间' : target.hour < 18 ? '下午' : target.hour < 22 ? '晚间' : '深夜';
  const targetTime = target.relativeDay === '今天' ? targetPeriod : `${target.relativeDay}的${targetPeriod}`;
  const transition = target.relativeDay === '昨天' ? '还是' : target.relativeDay === '明天' ? '已是' : '正值';
  return `你这边${period(origin.hour)}，对面${transition}${targetTime}，它正在${title}。`;
}

/** @returns {import('../types').VirtualProfileResult} */
export function profileMoment(profile, at = new Date()) {
  const ocean = profile.targetLocation.kind === 'ocean';
  const origin = worldAt(profile.originLocation.cityName, profile.originLocation, profile.metadata.originTimezoneData, at);
  const target = worldAt(profile.targetLocation.locationLabel, profile.targetLocation, profile.metadata.timezoneData, at, origin.date, ocean);
  const plan = dailyPlan(profile.selectedAvatar.role, profile.targetLocation, target.date, ocean);
  const index = currentIndex(plan.timeline, target.localMinutes), item = plan.timeline[index];
  const timeline = plan.timeline.map((entry, i) => ({ ...entry, isCurrent: i === index }));
  const phase = target.localMinutes < 750 ? 0 : target.localMinutes < 1200 ? 1 : 2;
  const storyText = `${phase === 0 ? '今天它' : '它'}${plan.story.phases[phase]}。`;
  const connection = connectionText(origin, target, item.title);
  const next = timeline[index+1] || { time: '明天', title: '开启新的一天', state: 'relaxing' };
  const scene = { habitat: ocean ? 'boat_cabin' : profile.targetLocation.kind === 'land' ? 'land_home' : 'unknown_home',
    title: ocean ? '船上小屋' : '远方的小屋', isDay: target.isDay,
    description: ocean ? `${target.isDay ? '白昼照进舷窗' : '夜色包围小船'}，小屋始终停在地球另一端的这个坐标。` : `${target.isDay ? '日光' : '灯光'}陪着它过今天的生活。` };
  return { originWorld: origin, targetWorld: target, localTime: target.time, localDateLabel: target.date,
    dayType: plan.dayType, currentState: item.state, currentTitle: item.title,
    currentDescription: item.description, todayMood: item.mood, distanceKm: profile.result?.distanceKm || 20015,
    timeline, dailyStory: { date: target.date, title: plan.story.title, text: storyText }, nextActivity: next, scene,
    connectionText: connection, shareText: `${origin.place} ${origin.date} ${origin.time} / ${target.place} ${target.date} ${target.time}：它在${item.title}。${storyText}`,
    activityMeta: { engineVersion: 4, source: 'daily_rules' } };
}
