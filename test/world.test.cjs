const {test}=require('node:test');
const assert=require('node:assert/strict');
const {clockAt,dailyPlan,profileMoment,worldAt}=require('../dist/domain/world');
const ocean={latitude:-31.2304,longitude:-58.5263,locationLabel:'South Atlantic Ocean',kind:'ocean'};
function profile(role='office_worker',kind='ocean'){
 return {selectedAvatar:{role,name:role},character:{name:'卢西亚',gender:'female',continent:'SA'},originLocation:{latitude:31.2304,longitude:121.4737,cityName:'上海'},
   targetLocation:{...ocean,kind},metadata:{originTimezoneData:{timezoneId:'Asia/Shanghai'},timezoneData:{timezoneId:'America/Argentina/Buenos_Aires'}},result:{distanceKm:20015}};
}
test('昨天、今天、明天和当地周末按目标时区计算',()=>{
 const p=profile();
 assert.equal(profileMoment(p,new Date('2026-10-02T00:00:00Z')).targetWorld.relativeDay,'昨天');
 assert.equal(profileMoment(p,new Date('2026-10-02T08:00:00Z')).targetWorld.relativeDay,'今天');
 p.metadata.originTimezoneData={timezoneId:'Pacific/Honolulu'};p.metadata.timezoneData={timezoneId:'Pacific/Kiritimati'};
 assert.equal(profileMoment(p,new Date('2026-10-02T13:00:00Z')).targetWorld.relativeDay,'明天');
 assert.equal(profileMoment(profile(),new Date('2026-10-03T00:00:00Z')).dayType,'weekday');
 assert.equal(profileMoment(profile(),new Date('2026-10-03T04:00:00Z')).dayType,'weekend');
});
test('四角色工作日周末有区别，每天稳定且不同日期有变化',()=>{
 for(const role of ['office_worker','student','freelancer','traveler']){
   for(const isOcean of [true,false]){
     const friday=dailyPlan(role,ocean,'2026-10-02',isOcean);
     assert.deepEqual(friday,dailyPlan(role,ocean,'2026-10-02',isOcean));
     assert.notDeepEqual(friday.timeline,dailyPlan(role,ocean,'2026-10-03',isOcean).timeline);
     assert.notDeepEqual(friday,dailyPlan(role,ocean,'2026-10-09',isOcean));
     assert.equal(friday.timeline[0].time,'00:00');
     assert.equal(new Set(friday.timeline.map(i=>i.time)).size,friday.timeline.length);
   }
 }
});
test('跨活动边界同步更新标题、描述、心情、日程与分享，小事自然呼应',()=>{
 const p=profile('student'); const morning=profileMoment(p,new Date('2026-10-02T12:00:00Z'));
 const afternoon=profileMoment(p,new Date('2026-10-02T19:00:00Z'));
 const evening=profileMoment(p,new Date('2026-10-03T00:00:00Z'));
 for(const m of [morning,afternoon,evening]){
   const current=m.timeline.find(i=>i.isCurrent);
   assert.equal(m.currentTitle,current.title);assert.equal(m.currentDescription,current.description);assert.equal(m.todayMood,current.mood);
   assert.ok(m.shareText.includes(m.currentTitle));
   assert.equal(m.timeline.filter(i=>i.isCurrent).length,1);
 }
 assert.equal(morning.dailyStory.title,evening.dailyStory.title);
 assert.notEqual(morning.dailyStory.text,evening.dailyStory.text);
 assert.notEqual(morning.currentTitle,evening.currentTitle);
 const a=profileMoment(p,new Date('2026-10-02T12:00:00Z')),b=profileMoment(p,new Date('2026-10-02T12:01:00Z'));
 assert.deepEqual(a.timeline,b.timeline);assert.equal(a.dailyStory.text,b.dailyStory.text);assert.equal(a.todayMood,b.todayMood);
});
test('确认海洋才使用船舱，船上四角色文案没有城市代理活动',()=>{
 for(const role of ['office_worker','student','freelancer','traveler']){
  const m=profileMoment(profile(role),new Date('2026-10-02T15:00:00Z'));
  assert.equal(m.scene.habitat,'boat_cabin');
  assert.doesNotMatch(JSON.stringify(m),/通勤|食堂|夜市|教室|街头|搭车/);
 }
 assert.equal(profileMoment(profile('traveler','unknown')).scene.habitat,'unknown_home');
});
test('名字贯穿各角色、环境、日期和活动，所有角色文案不用物品代词',()=>{
 for(const role of ['office_worker','student','freelancer','traveler']) {
  for(const kind of ['land','ocean','unknown']) {
   for(const date of ['2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08']) {
    for(const hour of [0,6,9,12,16,20,23]) {
     const p=profile(role,kind);
     const moment=profileMoment(p,new Date(`${date}T${String(hour).padStart(2,'0')}:00:00Z`));
     assert.doesNotMatch(JSON.stringify(moment),/它/);
     assert.match(moment.currentDescription,/卢西亚/);
     assert.match(moment.connectionText,/卢西亚/);
     assert.match(moment.shareText,/卢西亚/);
    }
   }
  }
 }
 const p=profile('student'),at=new Date('2026-10-02T12:00:00Z');
 const before=profileMoment(p,at);
 p.character={...p.character,name:'玛雅'};
 const after=profileMoment(p,at);
 assert.deepEqual(before.timeline.map(({time,title,state,mood})=>({time,title,state,mood})),after.timeline.map(({time,title,state,mood})=>({time,title,state,mood})));
 assert.equal(before.dailyStory.title,after.dailyStory.title);
 assert.match(after.shareText,/玛雅/);
});
test('时区支持 DST、零偏移与海洋整数 UTC 估算',()=>{
 assert.equal(clockAt({timezoneId:'Europe/London'},new Date('2026-01-01T00:00:00Z'),120).time,'00:00');
 assert.equal(clockAt({timezoneId:'America/New_York'},new Date('2026-03-08T06:59:00Z')).time,'01:59');
 assert.equal(clockAt({timezoneId:'America/New_York'},new Date('2026-03-08T07:00:00Z')).time,'03:00');
 const sea=worldAt('海域',{latitude:0,longitude:-150},null,new Date('2026-10-02T04:00:00Z'),'2026-10-02',true);
 assert.equal(sea.date,'2026-10-01');assert.equal(sea.utcOffsetSeconds,-36000);assert.match(sea.timeLabel,/海上时间 · 估算/);
 assert.equal(clockAt({utcOffsetSeconds:0},new Date('2026-10-02T04:00:00Z'),120).time,'04:00');
});
test('实时时钟的毫秒不改变海上整数偏移或确认偏移',()=>{
 for(const ms of [1,499,500,999]) {
  const at=new Date(`2026-10-02T00:00:00.${String(ms).padStart(3,'0')}Z`);
  assert.equal(clockAt(null,at,-77.2817).utcOffsetSeconds,-18000);
  assert.equal(clockAt({utcOffsetSeconds:0},at,120).utcOffsetSeconds,0);
  assert.equal(clockAt({timezoneId:'Asia/Shanghai'},at).utcOffsetSeconds,28800);
  assert.match(worldAt('南太平洋',{latitude:-25.0389,longitude:-77.2817},null,at,undefined,true).timeLabel,/UTC-5$/);
 }
});
test('可信当日太阳数据优先，过期数据不决定昼夜；极昼极夜可区分',()=>{
 const point={latitude:80,longitude:0};
 assert.equal(worldAt('北极区域',point,null,new Date('2026-06-21T00:00:00Z')).isDay,true);
 assert.equal(worldAt('北极区域',point,null,new Date('2026-12-21T12:00:00Z')).isDay,false);
 const tz={timezoneId:'UTC',sunrise:'2026-10-02 06:00',sunset:'2026-10-02 18:00'};
 assert.equal(worldAt('测试',{latitude:0,longitude:0},tz,new Date('2026-10-02T17:00:00Z')).dayNightEstimated,false);
 assert.equal(worldAt('测试',{latitude:0,longitude:0},tz,new Date('2026-10-03T17:00:00Z')).dayNightEstimated,true);
});
