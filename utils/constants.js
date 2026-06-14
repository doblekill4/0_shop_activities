/**
 * 共享常量：场地列表、别名映射、匹配函数
 * create 页和 edit 页共用，一处修改两页生效
 */

const VENUE_LIST = [
  '零号店1-3层', '零号店正门', '吧台后方书吧', '吧台沙发区', '吧台前台',
  '战略报告厅', '大包间', '小包间', '西餐厅',
  '散台小吃用餐区', '散台圆桌', '二层', '三层',
  '三层LED区', '四层DIY区', '五层多功能厅',
  '五层会议室一', '五层会议室二', '五层圆桌会议室',
  '员工餐厅', '元宇宙数字化工厂', '其他（手动输入）',
];

// 地点别名映射：粘贴文本中的常用说法 → VENUE_LIST 中的正式名称
const VENUE_ALIASES = {
  '食堂':       '员工餐厅',
  '园区餐厅':   '员工餐厅',
  '饭堂':       '员工餐厅',
  '餐厅':       '员工餐厅',
  '会议室二':   '五层会议室二',
  '会议室一':   '五层会议室一',
  '会议室':     '五层会议室二',
  '圆桌会议室': '五层圆桌会议室',
  'LED区':        '三层LED区',
  '开放式报告厅': '三层LED区',
  '售药机':       '零号店正门',
  'DIY区':        '四层DIY区',
  '四层':         '四层DIY区',
  '多功能厅':   '五层多功能厅',
  '报告厅':     '战略报告厅',
  '书吧':       '吧台后方书吧',
  '沙发区':     '吧台沙发区',
  '前台':       '吧台前台',
  '包间':       '大包间',
  '大包':       '大包间',
  '小包':       '小包间',
  '西餐':       '西餐厅',
  '数字化':     '元宇宙数字化工厂',
  '元宇宙':     '元宇宙数字化工厂',
};

const SUBSCRIBE_TMPL_IDS = ['XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70'];

/**
 * 根据环节名称模糊匹配预设地点
 * 返回 { venue, venueIndex }，未匹配则返回 venue:'' venueIndex:0
 */
function matchStepVenue(stepName) {
  if (!stepName) return { venue: '', venueIndex: 0 };

  const text = stepName.replace(/\s+/g, '');
  const venues = VENUE_LIST.slice(0, -1);  // 排除"其他（手动输入）"

  // 1) 别名精确命中
  for (const [alias, target] of Object.entries(VENUE_ALIASES)) {
    if (text.includes(alias)) {
      const idx = venues.indexOf(target);
      if (idx >= 0) return { venue: target, venueIndex: idx };
    }
  }

  // 2) 直接子串匹配
  let best = { venue: '', venueIndex: 0, score: 0 };
  for (let i = 0; i < venues.length; i++) {
    const v = venues[i];
    const vClean = v.replace(/\s+/g, '');
    let score = 0;

    if (text.includes(vClean)) {
      score = vClean.length * 10;
    } else if (vClean.includes(text)) {
      score = text.length * 8;
    } else {
      const bigrams = new Set();
      for (let j = 0; j < text.length - 1; j++) bigrams.add(text.slice(j, j + 2));
      for (let j = 0; j < vClean.length - 1; j++) {
        if (bigrams.has(vClean.slice(j, j + 2))) score += 2;
      }
    }
    if (/[一二三四五六七]层/.test(text) && /[一二三四五六七]层/.test(vClean)) score += 5;
    if (score > best.score) { best = { venue: v, venueIndex: i, score }; }
  }

  if (best.score >= 4 && best.venue) return { venue: best.venue, venueIndex: best.venueIndex };
  return { venue: '', venueIndex: 0 };
}

module.exports = {
  VENUE_LIST,
  VENUE_ALIASES,
  SUBSCRIBE_TMPL_IDS,
  matchStepVenue,
};
