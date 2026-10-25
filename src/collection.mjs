import { randomInt as secureRandomInt } from 'node:crypto';

export const THEME_IDS = Object.freeze(['explorer', 'xianxia', 'cyber', 'wuxia', 'fantasy', 'space', 'ocean', 'garden', 'academy', 'steampunk']);
export const ICON_IDS = Object.freeze(['compass', 'star', 'book', 'flag', 'chat', 'spark', 'leaf', 'code', 'medal', 'sword', 'lotus', 'orb', 'fox', 'robot', 'ship', 'dragon', 'moon', 'shell', 'flower', 'feather', 'gear', 'lantern', 'cat', 'owl']);
export const ANIMATION_IDS = Object.freeze(['none', 'float', 'pulse', 'orbit', 'spark']);
export const RARITIES = Object.freeze(['N', 'R', 'SR', 'SSR']);
export const FRAME_STYLES = Object.freeze([{ id: 'compact', height: 32 }, { id: 'standard', height: 64 }, { id: 'showcase', height: 104 }].map(Object.freeze));
export const COLLECTION_LIMITS = Object.freeze({ characters: 256, customCharacters: 128, characterBatch: 20, draws: 1024, artBytes: 256 * 1024, totalArtBytes: 4 * 1024 * 1024, frameHeightMin: 32, frameHeightMax: 160 });
const LABELS = ['探索', '修仙', '赛博朋克', '武侠', '奇幻', '星际', '海洋', '花园', '学院', '蒸汽朋克'];
const BASE_RATES = Object.freeze({ N: 0.60, R: 0.28, SR: 0.10, SSR: 0.02 });
const LOW_TEN = 0.88 ** 10;
const ACTUAL_RATES = Object.freeze({ N: 0.60 - LOW_TEN * (0.60 / 0.88) / 10, R: 0.28 - LOW_TEN * (0.28 / 0.88) / 10, SR: 0.10 + LOW_TEN * (10 / 12) / 10, SSR: 0.02 + LOW_TEN * (2 / 12) / 10 });
const clone = value => structuredClone(value);
const has = (value, key) => Object.hasOwn(value, key);
const integer = value => Number.isSafeInteger(value) && value >= 0;
function fail(code, message, status = 400) { throw Object.assign(new Error(message), { name: 'JournalError', code, status }); }
function fields(value, allowed) { if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_INPUT', 'Collection data contains unsupported fields.'); }
function opaque(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@+\-]{0,255}$/.test(value)) fail('INVALID_INPUT', 'Character identity must be opaque.'); return value; }
function option(value, choices) { if (!choices.includes(value)) fail('INVALID_INPUT', 'Unsupported collection value.'); return value; }
function text(value, maximum, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value) || /(?:^|\s)(?:\/(?:Users|home|private|tmp|var|etc|Volumes|opt)\/|file:\/\/|[A-Za-z]:\\|~\/)/u.test(value)) fail('INVALID_INPUT', 'Character copy must be bounded display text without private paths.');
  return value.trim();
}

const NAMES = Object.freeze({
  explorer: [['森径信使', 'leaf', 'float'], ['砂岩画师', 'book', 'none'], ['云谷背包客', 'compass', 'float'], ['寻星观测员', 'star', 'orbit'], ['极光领航员', 'flag', 'pulse'], ['旧图修补匠', 'book', 'spark'], ['山海绘卷师', 'medal', 'orbit'], ['黎明远行者', 'compass', 'spark']],
  xianxia: [['青苔童子', 'leaf', 'float'], ['灵泉采药人', 'lotus', 'pulse'], ['松烟符徒', 'book', 'none'], ['听雨剑修', 'sword', 'float'], ['白羽丹师', 'orb', 'orbit'], ['逐月灵狐', 'fox', 'pulse'], ['莲台御风客', 'lotus', 'orbit'], ['九霄星君', 'dragon', 'spark']],
  cyber: [['巷灯巡线员', 'code', 'pulse'], ['字节园丁', 'leaf', 'spark'], ['回声信使', 'chat', 'float'], ['霓虹译码师', 'code', 'orbit'], ['银翼守夜人', 'robot', 'pulse'], ['合成猫侦探', 'cat', 'float'], ['量子观测者', 'orb', 'orbit'], ['黎明协议主', 'robot', 'spark']],
  wuxia: [['竹篱药童', 'leaf', 'float'], ['渡口说书人', 'book', 'none'], ['青衫镖客', 'flag', 'pulse'], ['听雪剑客', 'sword', 'float'], ['流霞琴师', 'lotus', 'pulse'], ['归雁游侠', 'feather', 'orbit'], ['踏月刀隐', 'moon', 'orbit'], ['无尘宗师', 'sword', 'spark']],
  fantasy: [['苔原侏儒', 'gear', 'none'], ['烛光学徒', 'lantern', 'pulse'], ['铃鹿斥候', 'leaf', 'float'], ['银叶德鲁伊', 'leaf', 'orbit'], ['星火骑士', 'sword', 'spark'], ['月泉魔导师', 'orb', 'pulse'], ['秘境龙语者', 'book', 'orbit'], ['晨曦守誓龙', 'dragon', 'spark']],
  space: [['舷窗记录员', 'book', 'none'], ['陨石采样员', 'orb', 'float'], ['轨道修理工', 'gear', 'pulse'], ['苍蓝导航官', 'compass', 'orbit'], ['深空信号师', 'chat', 'pulse'], ['星尘测绘员', 'star', 'float'], ['折光跃迁者', 'ship', 'orbit'], ['群星引航者', 'ship', 'spark']],
  ocean: [['潮汐拾贝人', 'shell', 'float'], ['珊瑚信使', 'chat', 'pulse'], ['礁影潜行者', 'compass', 'none'], ['月湾领航员', 'ship', 'float'], ['珍珠守望者', 'orb', 'pulse'], ['海雾歌者', 'shell', 'orbit'], ['蓝渊探秘师', 'medal', 'orbit'], ['万潮御鲸者', 'dragon', 'spark']],
  garden: [['晨露植苗员', 'leaf', 'float'], ['青叶邮差', 'chat', 'none'], ['小径蘑菇匠', 'flower', 'pulse'], ['月季调香师', 'flower', 'float'], ['蕨影护林人', 'leaf', 'pulse'], ['蜂语花匠', 'spark', 'orbit'], ['流萤造景师', 'lantern', 'orbit'], ['四季森灵', 'flower', 'spark']],
  academy: [['墨羽抄录生', 'feather', 'float'], ['钟楼值日生', 'gear', 'none'], ['银页图书员', 'book', 'pulse'], ['星算研究员', 'star', 'orbit'], ['烛台辩论家', 'lantern', 'pulse'], ['羽笔咒学师', 'feather', 'float'], ['万卷巡阅者', 'owl', 'orbit'], ['穹顶贤者', 'book', 'spark']],
  steampunk: [['煤灯调试员', 'lantern', 'pulse'], ['铜壳跑腿机', 'robot', 'float'], ['铆钉制图生', 'book', 'none'], ['黄铜飞艇长', 'ship', 'float'], ['齿轮钟匠', 'gear', 'orbit'], ['蒸汽花园师', 'flower', 'pulse'], ['逆风机械师', 'gear', 'orbit'], ['永昼动力心', 'orb', 'spark']],
});
const BUILTINS = THEME_IDS.flatMap((theme, themeIndex) => NAMES[theme].map(([name, icon, animation], index) => ({ id: `builtin:${theme}:${index + 1}`, name, description: `来自${LABELS[themeIndex]}旅途的${name}，与你一起收藏真实经历。`, theme, rarity: ['N', 'N', 'N', 'R', 'R', 'R', 'SR', 'SSR'][index], icon, animation, source: 'builtin' })));

// These titles describe the same sixteen canonical conditions in seven new
// presentation themes; historical award snapshots are never rewritten.
const ACHIEVEMENT_IDS = ['first', 'hundred', 'million', 'tenmillion', 'fiftymillion', 'first-read', 'first-change', 'formats', 'first-skill', 'skills', 'delegate', 'present', 'explorer', 'read-then-change', 'skill-then-change', 'delegate-then-present'];
const TITLES = {
  wuxia: ['初入江湖', '百番历练', '千山初涉', '万里行侠', '五湖留名', '开卷识路', '初试锋芒', '百家见闻', '拜读秘籍', '诸艺入囊', '同道相助', '成卷呈书', '门派游历', '谋定后动', '学以致用', '群侠合卷'],
  fantasy: ['初入秘境', '百次冒险', '星火初燃', '秘银回响', '群星铭刻', '古卷初启', '第一道符文', '异域图鉴', '法典翻页', '诸法收藏', '同伴来信', '冒险归档', '界门寻访', '读卷施法', '学徒实践', '小队结卷'],
  space: ['首次出港', '百航记录', '星尘初积', '银河航迹', '深空刻度', '舷窗观测', '首个修订', '多谱扫描', '导航手册', '舱载知识', '协航回声', '星图交付', '多轨巡航', '扫描后修复', '手册到执行', '舰队汇报'],
  ocean: ['初次扬帆', '百潮相伴', '浅湾微光', '远海航迹', '深蓝刻印', '潮汐读本', '初绘海图', '多海见闻', '航海手册', '海图收藏', '同行来帆', '航卷入港', '航线探索', '观潮落笔', '循卷掌舵', '船队归航'],
  garden: ['播下初芽', '百日耕读', '晨露初聚', '繁叶成荫', '四季年轮', '翻开花谱', '第一铲新土', '百花见闻', '园艺手册', '诸法育苗', '园中相助', '花笺成册', '花径漫游', '识叶再修枝', '循谱栽种', '共育花卷'],
  academy: ['首次入课', '百课同行', '墨点初积', '万页书痕', '学海留印', '开卷有声', '初次批注', '多科见闻', '借阅手册', '诸科书签', '同窗相助', '课题归档', '学科寻访', '读后批注', '习后践行', '小组交卷'],
  steampunk: ['首次点火', '百次传动', '铜屑初积', '蒸汽轨迹', '永昼刻度', '翻开蓝图', '首枚铆钉', '多轴见闻', '机匠手册', '图纸收藏', '协作齿轮', '图卷交付', '管线巡访', '看图再装配', '循册开工', '机组交卷'],
};
export const ACHIEVEMENT_THEME_TITLES = Object.freeze(Object.fromEntries(Object.entries(TITLES).map(([theme, titles]) => [theme, Object.freeze(Object.fromEntries(ACHIEVEMENT_IDS.map((id, index) => [id, titles[index]])))])));

export function collectionCatalog() {
  return clone({ themeIds: THEME_IDS, themes: THEME_IDS.map((id, index) => ({ id, label: LABELS[index] })), rarities: RARITIES, iconIds: ICON_IDS, animationIds: ANIMATION_IDS, animations: ANIMATION_IDS, drawSize: 10, drawCost: 1,
    baseRates: BASE_RATES, actualRates: ACTUAL_RATES, rates: { base: BASE_RATES, actual: ACTUAL_RATES, actualBasis: 'average_per_card_after_ten_pull_guarantee', characterSelection: 'uniform_within_theme_and_rarity' },
    guarantee: { drawSize: 10, minimumRarity: 'SR', rerollPosition: 10, rerollRates: { SR: 10 / 12, SSR: 2 / 12 }, condition: 'If all ten base rolls are N/R, reroll the tenth rarity as SR/SSR with weights 10:2.' }, frameStyles: FRAME_STYLES, limits: COLLECTION_LIMITS, pointsRule: 'One point per unique permanent award; one point buys exactly ten characters. Duplicates increase ownership count.' });
}
export function freshCollection(at, awards = []) {
  const earned = new Set(awards.map(award => award.id)).size;
  return { points: { earned, spent: 0, balance: earned }, characters: BUILTINS.map(character => ({ ...character, revision: 1, createdAt: at, updatedAt: at })), owned: [], draws: [] };
}
export function syncCollectionPoints(collection, awards) {
  const earned = new Set(awards.map(award => award.id)).size, spent = collection.draws.length;
  if (spent > earned) fail('CORRUPT_STATE', 'Draw spending exceeds unique earned awards.');
  collection.points = { earned, spent, balance: earned - spent };
}
export function validateArt(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(COLLECTION_LIMITS.artBytes / 3) * 4 + 64) fail('INVALID_ART', 'Inline art exceeds the per-image budget.');
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) fail('INVALID_ART', 'Art must be an inline base64 PNG, JPEG, GIF or WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > COLLECTION_LIMITS.artBytes || bytes.toString('base64') !== match[2]) fail('INVALID_ART', 'Invalid or oversized inline image bytes.');
  const mime = match[1];
  const magic = mime === 'png' ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR'
    : mime === 'jpeg' ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217
      : mime === 'gif' ? bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
        : bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.readUInt32LE(4) === bytes.length - 8 && bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16));
  if (!magic) fail('INVALID_ART', 'Image magic does not match its declared raster type.');
  return { value, bytes: bytes.length };
}
export function configureCollectionCharacters(collection, items, { requestHash, source, at }) {
  if (!Array.isArray(items) || items.length < 1 || items.length > COLLECTION_LIMITS.characterBatch) fail('INVALID_INPUT', 'Configure between one and twenty characters.');
  const touched = new Set();
  for (const [index, item] of items.entries()) {
    fields(item, ['id', 'name', 'description', 'theme', 'rarity', 'icon', 'animation', 'art']);
    const id = item.id === undefined ? `character-${requestHash.slice(0, 16)}-${index + 1}` : opaque(item.id);
    if (touched.has(id)) fail('INVALID_INPUT', 'A batch cannot repeat a character identity.'); touched.add(id);
    const old = collection.characters.find(character => character.id === id);
    if (old?.source === 'builtin' || id.startsWith('builtin:')) fail('BUILTIN_CHARACTER_IMMUTABLE', 'Built-in characters cannot be replaced.', 409);
    const theme = option(item.theme ?? old?.theme, THEME_IDS), rarity = option(item.rarity ?? old?.rarity, RARITIES);
    if (old && collection.owned.some(owned => owned.id === id) && (theme !== old.theme || rarity !== old.rarity)) fail('CHARACTER_POOL_IMMUTABLE', 'An owned character keeps its original theme and rarity.', 409);
    const character = { id, name: text(item.name ?? old?.name, 60), description: text(item.description ?? old?.description, 240, '与你一同记录旅途的原创角色。'), theme, rarity,
      icon: option(item.icon ?? old?.icon ?? 'star', ICON_IDS), animation: option(item.animation ?? old?.animation ?? 'none', ANIMATION_IDS), source: old?.source ?? option(source, ['model', 'user']), revision: (old?.revision ?? 0) + 1, createdAt: old?.createdAt ?? at, updatedAt: at };
    const art = item.art === undefined ? old?.art : item.art;
    if (art !== undefined && art !== null) character.art = validateArt(art).value;
    if (old) collection.characters[collection.characters.indexOf(old)] = character; else collection.characters.push(character);
  }
  assertCollectionBudget(collection);
}
function assertCollectionBudget(collection) {
  if (collection.characters.length > COLLECTION_LIMITS.characters || collection.characters.filter(character => character.source !== 'builtin').length > COLLECTION_LIMITS.customCharacters || collection.draws.length > COLLECTION_LIMITS.draws) fail('BUDGET_EXCEEDED', 'The collection reached its explicit budget.', 503);
  const bytes = collection.characters.reduce((total, character) => total + (character.art ? validateArt(character.art).bytes : 0), 0);
  if (bytes > COLLECTION_LIMITS.totalArtBytes) fail('BUDGET_EXCEEDED', 'The total inline art budget is full.', 503);
}
export function drawCollection(collection, { requestHash, theme, at, randomInt = secureRandomInt }) {
  option(theme, THEME_IDS);
  if (collection.points.balance < 1) fail('NOT_ENOUGH_POINTS', 'One achievement point is required for a ten-pull.', 409);
  if (collection.draws.length >= COLLECTION_LIMITS.draws) fail('BUDGET_EXCEEDED', 'The draw receipt budget is full.', 503);
  const roll = maximum => { let value; try { value = randomInt(maximum); } catch { fail('RANDOM_UNAVAILABLE', 'The secure random source is unavailable.', 503); } if (!Number.isSafeInteger(value) || value < 0 || value >= maximum) fail('RANDOM_UNAVAILABLE', 'The random source did not return an integer in range.', 503); return value; };
  const results = []; let high = false;
  for (let index = 0; index < 10; index++) {
    const rarityRoll = roll(100);
    let rarity = rarityRoll < 60 ? 'N' : rarityRoll < 88 ? 'R' : rarityRoll < 98 ? 'SR' : 'SSR';
    if (index === 9 && !high && !['SR', 'SSR'].includes(rarity)) rarity = roll(12) < 10 ? 'SR' : 'SSR';
    high ||= ['SR', 'SSR'].includes(rarity);
    const pool = collection.characters.filter(character => character.theme === theme && character.rarity === rarity);
    if (!pool.length) fail('CHARACTER_POOL_UNAVAILABLE', 'The selected rarity pool is unavailable.', 503);
    const character = pool[roll(pool.length)], previous = collection.owned.find(owned => owned.id === character.id);
    results.push({ id: character.id, rarity, isNew: !previous });
    if (previous) { if (!Number.isSafeInteger(previous.count + 1)) fail('COUNTER_OVERFLOW', 'Character ownership exceeded its safe range.', 503); previous.count++; }
    else collection.owned.push({ id: character.id, count: 1, firstAt: at });
  }
  collection.draws.push({ requestId: requestHash, theme, at, results, cost: 1 });
  collection.points.spent++; collection.points.balance--;
}
export function validateCollection(collection, { awards, requests, character }) {
  fields(collection, ['points', 'characters', 'owned', 'draws']); fields(collection.points, ['earned', 'spent', 'balance']);
  if (!Array.isArray(collection.characters) || !Array.isArray(collection.owned) || !Array.isArray(collection.draws)) fail('CORRUPT_STATE', 'Invalid collection arrays.');
  assertCollectionBudget(collection);
  const cards = new Map();
  for (const card of collection.characters) {
    fields(card, ['id', 'name', 'description', 'theme', 'rarity', 'icon', 'animation', 'source', 'revision', 'createdAt', 'updatedAt', 'art']);
    opaque(card.id); if (cards.has(card.id)) fail('CORRUPT_STATE', 'Duplicate character identity.');
    text(card.name, 60); text(card.description, 240); option(card.theme, THEME_IDS); option(card.rarity, RARITIES); option(card.icon, ICON_IDS); option(card.animation, ANIMATION_IDS); option(card.source, ['builtin', 'model', 'user']);
    if (!integer(card.revision) || card.revision < 1 || !integer(card.createdAt) || !integer(card.updatedAt)) fail('CORRUPT_STATE', 'Invalid character metadata.');
    if (card.art !== undefined) validateArt(card.art);
    const builtin = BUILTINS.find(candidate => candidate.id === card.id);
    if (card.source === 'builtin') {
      if (!builtin || card.art !== undefined || Object.keys(builtin).some(key => card[key] !== builtin[key]) || card.revision !== 1) fail('CORRUPT_STATE', 'A built-in character was replaced.');
    } else if (builtin || card.id.startsWith('builtin:')) fail('CORRUPT_STATE', 'Reserved character identity.');
    cards.set(card.id, card);
  }
  if (BUILTINS.some(builtin => !cards.has(builtin.id))) fail('CORRUPT_STATE', 'A built-in character pool is incomplete.');
  const reconstructed = new Map(), drawIds = new Set();
  for (const draw of collection.draws) {
    fields(draw, ['requestId', 'theme', 'at', 'results', 'cost']);
    if (!/^[a-f0-9]{64}$/.test(draw.requestId) || drawIds.has(draw.requestId) || !has(requests, draw.requestId) || requests[draw.requestId].method !== 'draw' || !integer(draw.at) || draw.cost !== 1 || !Array.isArray(draw.results) || draw.results.length !== 10) fail('CORRUPT_STATE', 'Invalid draw receipt.');
    option(draw.theme, THEME_IDS); drawIds.add(draw.requestId); let high = false;
    for (const result of draw.results) {
      fields(result, ['id', 'rarity', 'isNew']); const card = cards.get(result.id), previous = reconstructed.get(result.id);
      if (!card || card.theme !== draw.theme || card.rarity !== result.rarity || typeof result.isNew !== 'boolean' || result.isNew !== !previous || card.createdAt > draw.at) fail('CORRUPT_STATE', 'A draw result disagrees with its card or ownership.');
      high ||= ['SR', 'SSR'].includes(result.rarity);
      if (previous) previous.count++; else reconstructed.set(result.id, { id: result.id, count: 1, firstAt: draw.at });
    }
    if (!high) fail('CORRUPT_STATE', 'A ten-pull lacks its SR guarantee.');
  }
  if (Object.entries(requests).some(([id, request]) => request.method === 'draw' && !drawIds.has(id))) fail('CORRUPT_STATE', 'A draw request has no permanent receipt.');
  const ownedIds = new Set();
  for (const owned of collection.owned) { fields(owned, ['id', 'count', 'firstAt']); const expected = reconstructed.get(owned.id); if (ownedIds.has(owned.id) || !expected || owned.count !== expected.count || owned.firstAt !== expected.firstAt) fail('CORRUPT_STATE', 'Ownership totals disagree with draw receipts.'); ownedIds.add(owned.id); }
  if (ownedIds.size !== reconstructed.size || character !== null && !ownedIds.has(character)) fail('CORRUPT_STATE', 'Invalid owned or equipped character.');
  const earned = new Set(awards.map(award => award.id)).size;
  if (!integer(collection.points.earned) || !integer(collection.points.spent) || !integer(collection.points.balance) || collection.points.earned !== earned || collection.points.spent !== collection.draws.length || collection.points.balance !== earned - collection.draws.length) fail('CORRUPT_STATE', 'Achievement point totals disagree with permanent awards and draw receipts.');
}
