require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { NAME_POOLS, continentFor, normalizeCharacter, suggestCharacter } = require('../dist/domain/names');
const { ProfileService } = require('../dist/profile.service');
const { StoreService } = require('../dist/store.service');
const { antipodeOf } = require('../dist/geo.service');

const origin = {mode:'manual',cityName:'上海',countryName:'中国',latitude:31.2304,longitude:121.4737};
const payload = character => ({originLocation:origin,
  selectedAvatar:{id:'student',role:'student',name:'学生',emoji:'📚'},character});
const ocean = (latitude,longitude) => ({kind:'ocean',latitude,longitude,locationLabel:'海洋',countryName:'',regionName:''});

test('名字库、性别与 Unicode 长度校验', () => {
  assert.deepEqual(Object.keys(NAME_POOLS).sort(), ['AF','AN','AS','EU','NA','OC','SA']);
  for (const [continent,pool] of Object.entries(NAME_POOLS)) {
    assert.equal(pool.male.length,10);
    assert.equal(pool.female.length,10);
    assert.equal(new Set([...pool.male,...pool.female]).size,20);
    for (const gender of ['male','female']) for (const name of pool[gender]) {
      assert.deepEqual(normalizeCharacter({name,gender,continent}),{name,gender,continent});
    }
  }
  const identity = {name:'  Anna Maria  ',gender:'female',continent:'SA'};
  assert.equal(normalizeCharacter(identity).name,'Anna Maria');
  assert.ok(normalizeCharacter({...identity,name:'𠮷'.repeat(12)}));
  for (const name of ['', '  ', '𠮷'.repeat(13), '小它', '小\n明', ' 小明\n', '小\t明', '小\u0000明', '小\u0085明']) {
    assert.equal(normalizeCharacter({...identity,name}),null,name);
  }
  assert.equal(normalizeCharacter({...identity,gender:'invalid'}),null);
  assert.equal(normalizeCharacter({...identity,continent:'XX'}),null);
});

test('已确认国家优先，海洋按球面邻近大洲分区且跨日期线一致', () => {
  for (const [countryCode,continent] of [['CN','AS'],['GB','EU'],['GH','AF'],['MX','NA'],['AR','SA'],['NZ','OC'],['AQ','AN']]) {
    assert.equal(continentFor({...ocean(0,0),kind:'land',countryCode}),continent);
  }
  for (const [longitude,continent] of [[30,'EU'],[59.9,'EU'],[60,'AS'],[120,'AS'],[-175,'AS']]) {
    assert.equal(continentFor({...ocean(60,longitude),kind:'land',countryCode:'RU'}),continent);
  }
  for (const [latitude,longitude,continent] of [[26,125,'AS'],[64,-20,'EU'],[-20,10,'AF'],[35,-125,'NA'],[-35,-55,'SA'],[-20,177,'OC'],[-80,0,'AN']]) {
    assert.equal(continentFor(ocean(latitude,longitude)),continent);
    assert.equal(continentFor({...ocean(latitude,longitude),kind:'unknown'}),continent);
  }
  assert.equal(continentFor(ocean(-18,179.9)),'OC');
  assert.equal(continentFor(ocean(-18,-179.9)),'OC');
  assert.equal(continentFor({...ocean(-35,-55),countryCode:'CN'}),'SA');
  const target = ocean(-35,-55), before = JSON.stringify(target);
  const first = suggestCharacter(target,'female');
  for (let i=0;i<20;i++) {
    const next = suggestCharacter(target,'female',first.name);
    assert.notEqual(next.name,first.name);
    assert.ok(NAME_POOLS.SA.female.includes(next.name));
  }
  assert.match(first.continentLabel,/海上命名参考/);
  assert.equal(JSON.stringify(target),before);
});

test('身份预生成、创建、旧档案补名与快照隔离', async t => {
  const directory = mkdtempSync(join(tmpdir(),'another-me-identity-'));
  const oldPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = join(directory,'identity.sqlite');
  let store = new StoreService(), geoCalls = 0, weatherCalls = 0;
  const targetFor = point => ({antipode:antipodeOf(point),
    targetLocation:{...antipodeOf(point),kind:'land',locationLabel:'阿根廷',countryName:'阿根廷',regionName:'',countryCode:'AR'},
    distanceKm:20015,ocean:null,timezone:{utcOffsetSeconds:-10800,countryCode:'AR'},
    geoMeta:{resolverVersion:2,source:'geonames',cached:false,resolvedAt:new Date().toISOString()}});
  const geo = {
    resolveTarget:async point => {geoCalls++;return targetFor(point);},
    resolveCombined:async point => {geoCalls++;return {target:targetFor(point),origin:null,originTimezone:{utcOffsetSeconds:28800}};},
    originTimezone:async () => ({utcOffsetSeconds:28800})
  };
  const weather = {pair:async () => {weatherCalls++;return {origin:null,target:null};}};
  let service = new ProfileService(store,geo,weather);
  try {
    await t.test('预生成不创建档案或查询天气，并按性别返回不同候选', async () => {
      const first = await service.suggestCharacter({originLocation:origin,gender:'male'});
      assert.equal(first.data.continent,'SA');
      assert.ok(NAME_POOLS.SA.male.includes(first.data.name));
      const next = await service.suggestCharacter({originLocation:origin,gender:'male',excludeName:first.data.name});
      assert.notEqual(next.data.name,first.data.name);
      assert.equal(store.getActiveProfile('owner'),null);
      assert.equal(weatherCalls,0);
      const before = geoCalls;
      await assert.rejects(service.suggestCharacter({originLocation:origin,gender:'bad'}),error => error.getStatus()===400);
      assert.equal(geoCalls,before);
    });
    let profile;
    await t.test('创建前校验身份，服务端修正客户端大洲，名字进入生成文案', async () => {
      const before = geoCalls;
      for (const character of [undefined,{name:'',gender:'male',continent:'AS'},{name:'它',gender:'male',continent:'AS'},
        {name:'1234567890123',gender:'male',continent:'AS'},{name:'露娜',gender:'bad',continent:'SA'}]) {
        await assert.rejects(service.create('owner',payload(character)),error=>error.getStatus()===400);
      }
      assert.equal(geoCalls,before);
      const result = await service.create('owner',payload({name:'  露娜  ',gender:'female',continent:'AS'}));
      profile = result.data;
      assert.deepEqual(profile.character,{name:'露娜',gender:'female',continent:'SA'});
      assert.equal(profile.openid,'owner');
      assert.deepEqual(profile.antipode,antipodeOf(origin));
      assert.ok(profile.result.currentDescription.includes('露娜'));
      assert.ok(!JSON.stringify(profile.result).includes('它'));
    });
    await t.test('公开快照身份只有名字与性别，读快照不增加请求', async () => {
      const result = await service.share('owner'), snapshot=result.data;
      assert.deepEqual(snapshot.character,{name:'露娜',gender:'female'});
      const serialized = JSON.stringify(snapshot);
      for (const key of ['continent','openid','originLocation','targetLocation','latitude','longitude']) {
        assert.ok(!serialized.includes('"'+key+'"'),key);
      }
      const counts = [geoCalls,weatherCalls];
      assert.deepEqual(service.getShare(snapshot.id).data,snapshot);
      assert.deepEqual([geoCalls,weatherCalls],counts);
    });
    await t.test('旧档案稳定补名并持久化，服务重启继续保留', async () => {
      const legacy = store.getActiveProfile('owner');
      delete legacy.character;
      store.updateProfile(legacy);
      const [a,b] = await Promise.all([service.getActive('owner',false),service.getActive('owner',false)]);
      assert.deepEqual(a.data.character,b.data.character);
      assert.equal(a.data.character.gender,'unspecified');
      assert.equal(a.data.character.continent,'SA');
      assert.equal(a.data._id,profile._id);
      assert.equal(a.data.openid,profile.openid);
      assert.deepEqual(a.data.selectedAvatar,profile.selectedAvatar);
      assert.deepEqual(store.getActiveProfile('owner').character,a.data.character);
      store.onModuleDestroy();
      store = new StoreService();
      service = new ProfileService(store,geo,weather);
      assert.deepEqual((await service.getActive('owner',false)).data.character,a.data.character);
    });
    await t.test('旧快照仅读取时投影旧称呼，物品指代正确且存储保持不变', async () => {
      const modern = (await service.share('owner')).data;
      const old = {...modern,currentDescription:'它留在小屋，写作。',dailyStory:{...modern.dailyStory,text:'它给它留出新的一页。'},
        scene:{...modern.scene,description:'日光陪着它过今天的生活。'},connectionText:'它正在写作。',shareText:'它在写作。'};
      delete old.id;
      delete old.character;
      const saved = store.createShare(old), counts = [geoCalls,weatherCalls];
      const projected = service.getShare(saved.id).data;
      assert.equal(projected.currentDescription,'另一个我留在小屋，写作。');
      assert.equal(projected.dailyStory.text,'另一个我为这个想法留出新的一页。');
      assert.ok(!JSON.stringify(projected).includes('它'));
      assert.ok(!('character' in projected));
      assert.deepEqual(store.getShare(saved.id),saved);
      assert.deepEqual([geoCalls,weatherCalls],counts);
    });
  } finally {
    store.onModuleDestroy();
    if (oldPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH=oldPath;
    rmSync(directory,{recursive:true,force:true});
  }
});
