import { randomInt } from 'node:crypto';

export const CONTINENT_LABELS = Object.freeze({
  AS: '亚洲', EU: '欧洲', AF: '非洲', NA: '北美洲', SA: '南美洲', OC: '大洋洲', AN: '南极洲'
});

// 使用真实人名的短中文译名，不赋予名字未经核实的民族含义。
// 北美常见名字参考 SSA：https://www.ssa.gov/oact/babynames/
// 北美原住民人名参考 NPS：Sequoyah、Tecumseh、Zitkala-Ša、Sacagawea。
// https://www.nps.gov/seki/learn/historyculture/sequoias-historic-park-entrance-sign.htm
// https://home.nps.gov/articles/tecumseh.htm
// https://www.nps.gov/people/zitkala-sa.htm
// https://www.nps.gov/articles/000/mandan-hidatsa-and-arikara-histories-of-sacagawea.htm
// 南美葡语名字参考 IBGE：https://www.ibge.gov.br/censo2010/nomes
// 毛利名字参考新西兰内政部：https://www.dia.govt.nz/press.nsf/d77da9b523f12931cc256ac5000d19b6/4cf0831e7fd2c198cc258cad007b30c1!OpenDocument
// 每洲男、女各 10 个；未设定性别时从该洲全部 20 个名字中选择。
export const NAME_POOLS = Object.freeze({
  AS: {
    male: ['浩然', '悠真', '民俊', '阿琼', '拉胡尔', '迪帕克', '阿米尔', '哈桑', '阿里', '健太'],
    female: ['美咲', '葵', '智友', '普莉娅', '拉妮', '法蒂玛', '莱拉', '阿米娜', '莉娜', '诗涵']
  },
  EU: {
    male: ['亚历山大', '奥利弗', '卢卡', '雨果', '路易', '利奥', '费利克斯', '伊万', '安东', '马特奥'],
    female: ['艾玛', '米娅', '索菲亚', '奥莉维亚', '伊莎贝拉', '克拉拉', '艾丽丝', '安娜', '艾拉', '艾娃']
  },
  AF: {
    male: ['科菲', '夸梅', '夸库', '塞古', '穆萨', '伊德里斯', '阿马杜', '夸西', '阿里', '奥卢'],
    female: ['阿玛', '阿库阿', '阿贝娜', '阿乔阿', '阿米娜', '法蒂玛', '玛丽亚', '阿莎', '万吉鲁', '内玛']
  },
  NA: {
    male: ['塞阔雅', '特库姆塞', '詹姆斯', '亨利', '本杰明', '伊桑', '加布里埃尔', '胡安', '迭戈', '路易斯'],
    female: ['齐特卡拉·萨', '萨卡加维亚', '夏洛特', '阿米莉亚', '索菲亚', '伊莎贝拉', '艾娃', '米娅', '露娜', '卡米拉']
  },
  SA: {
    male: ['何塞', '若昂', '佩德罗', '卢卡斯', '米格尔', '拉斐尔', '胡安', '迭戈', '马特奥', '圣地亚哥'],
    female: ['玛丽亚', '安娜', '弗朗西斯卡', '朱莉娅', '贝阿特丽斯', '拉里萨', '卡米拉', '露西亚', '瓦伦蒂娜', '加布里埃拉']
  },
  OC: {
    male: ['尼考', '阿里基', '阿里', '马努', '塔马', '利亚姆', '诺亚', '奥利弗', '杰克', '查理'],
    female: ['阿罗哈', '玛娅', '莫阿娜', '阿娜赫拉', '阿塔朗伊', '伊斯拉', '阿米莉亚', '艾娃', '米娅', '奥莉维亚']
  },
  // 南极没有本土命名文化，使用国际名字库。
  AN: {
    male: ['亚历山大', '丹尼尔', '大卫', '马丁', '卢卡斯', '诺亚', '利奥', '安东', '阿米尔', '拉斐尔'],
    female: ['安娜', '艾玛', '索菲亚', '玛丽亚', '莉娜', '米娅', '艾丽丝', '克拉拉', '露娜', '艾娃']
  }
});

// 国家/地区按地理大洲归组，海外地区使用自身地理位置；不按宗主国归组。
const COUNTRY_GROUPS = {
  AS: 'AE AF AM AZ BD BH BN BT CN CY GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
  EU: 'AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  AF: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW IO KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TF TG TN TZ UG YT ZA ZM ZW',
  NA: 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  SA: 'AR BO BR CL CO EC FK GF GS GY PE PY SR UY VE',
  OC: 'AS AU CC CK CX FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS',
  AN: 'AQ BV HM'
};
const COUNTRY_CONTINENTS = Object.fromEntries(Object.entries(COUNTRY_GROUPS)
  .flatMap(([continent, countries]) => countries.split(' ').map(code => [code, continent])));

// 海洋和未确认坐标没有政治上的“所属大洲”。仅为取名使用邻近海岸/岛群
// 的球面分区；这些参考点从不成为角色位置，不参与时区、环境或天气解析。
const COAST_REFERENCES = {
  AS: [[70,60],[75,90],[73,125],[70,165],[65,-170],[58,162],[50,156],[43,145],[35,140],
    [25,122],[20,110],[10,109],[1,104],[-6,106],[-8,115],[-9,124],[4,118],[12,125],
    [20,73],[8,77],[6,80],[22,90],[20,58],[13,45],[30,48],[36,36],[40,30]],
  EU: [[71,25],[70,16],[63,5],[58,8],[55,12],[54,20],[60,30],[59,-3],[52,-10],[50,-5],
    [44,-9],[36,-6],[43,4],[40,9],[38,15],[36,23],[42,28],[45,36],[65,-18],[79,15],[80,50]],
  AF: [[35,-6],[37,10],[33,23],[31,32],[24,35],[12,43],[3,48],[-12,40],[-25,33],[-34,18],
    [-30,16],[-20,12],[-6,12],[0,9],[5,0],[5,-8],[10,-15],[20,-17],[28,-13],[16,-24],
    [-12,49],[-25,47],[-20,57],[-5,55]],
  NA: [[70,-165],[60,-150],[55,-130],[48,-124],[40,-124],[30,-116],[22,-110],[16,-96],
    [8,-80],[9,-77],[18,-88],[21,-87],[30,-82],[35,-76],[45,-63],[52,-55],[60,-64],
    [70,-70],[80,-90],[72,-125],[60,-43],[70,-22],[80,-25],[22,-80],[18,-68],[15,-61],[32,-65]],
  SA: [[12,-72],[10,-62],[5,-52],[-5,-35],[-15,-39],[-23,-43],[-34,-53],[-42,-64],[-54,-68],
    [-46,-75],[-35,-73],[-20,-70],[-5,-81],[1,-80],[-1,-90],[-52,-59]],
  OC: [[-11,142],[-15,129],[-23,114],[-35,116],[-35,138],[-39,146],[-33,151],[-22,150],
    [-6,147],[-3,153],[-9,160],[-16,167],[-21,165],[-18,178],[-21,-175],[-14,-172],
    [-17,-149],[1,173],[7,134],[7,151],[13,144],[21,-157],[-35,173],[-42,174],[-46,168],[-27,-109]],
  AN: [[-65,-60],[-70,-10],[-70,20],[-67,50],[-67,80],[-66,110],[-67,140],[-75,170],[-75,-150],[-73,-120],[-70,-95]]
};
const rad = Math.PI / 180;

export function continentFor(target) {
  // 俄罗斯横跨欧亚：乌拉尔附近的 60°E 为取名分区边界，负经度远东在亚洲侧。
  if (target.kind === 'land' && String(target.countryCode || '').toUpperCase() === 'RU') {
    return target.longitude >= 60 || target.longitude < 0 ? 'AS' : 'EU';
  }
  const confirmed = target.kind === 'land' && COUNTRY_CONTINENTS[String(target.countryCode || '').toUpperCase()];
  if (confirmed) return confirmed;
  const latitude = target.latitude * rad, longitude = target.longitude * rad;
  let nearest = 'AN', bestSimilarity = -Infinity;
  for (const [continent, points] of Object.entries(COAST_REFERENCES)) {
    for (const [lat, lon] of points) {
      // cos 经度差天然跨越日期线；最大球面点积即最短大圆距离。
      const similarity = Math.sin(latitude) * Math.sin(lat * rad)
        + Math.cos(latitude) * Math.cos(lat * rad) * Math.cos(longitude - lon * rad);
      if (similarity > bestSimilarity) { bestSimilarity = similarity; nearest = continent; }
    }
  }
  return nearest;
}

export function isCharacterGender(value) {
  return ['male', 'female', 'unspecified'].includes(value);
}

export function normalizeCharacter(value) {
  if (!value || typeof value.name !== 'string' || !isCharacterGender(value.gender)
    || !Object.hasOwn(CONTINENT_LABELS, value.continent) || /[\u0000-\u001f\u007f-\u009f]/u.test(value.name)) return null;
  const name = value.name.trim();
  if (!name || Array.from(name).length > 12 || /它/u.test(name)) return null;
  return {name, gender:value.gender, continent:value.continent};
}

function namesFor(continent, gender) {
  const pool = NAME_POOLS[continent];
  return gender === 'unspecified' ? [...pool.male, ...pool.female] : pool[gender];
}

export function suggestCharacter(target, gender, excludeName) {
  const continent = continentFor(target);
  const names = namesFor(continent, gender).filter(name => name !== excludeName?.trim());
  return {name:names[randomInt(names.length)], gender, continent,
    continentLabel:CONTINENT_LABELS[continent] + (target.kind === 'ocean' ? ' · 海上命名参考' : target.kind === 'unknown' ? ' · 坐标命名参考' : ''),
    locationLabel:target.locationLabel, targetKind:target.kind};
}

export function legacyCharacter(profileId, target) {
  const continent = continentFor(target), names = namesFor(continent, 'unspecified');
  const index = Array.from(profileId).reduce((sum, character, position) => sum + character.codePointAt(0) * (position + 1), 0) % names.length;
  return {name:names[index], gender:'unspecified', continent};
}
