// cloudfunctions/api/index.js - 外部 API 接口
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 从环境变量读取密钥
const API_KEY = process.env.API_KEY;

// 活动状态白名单（只导出正式活动）
const EXPORT_STATUSES = ['pending', 'confirmed', 'completed', 'settled'];

/** 日期格式化: ISOString / "YYYY-MM-DD" → "YYYY年M月D日" */
function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 构建单活动文本 */
function formatActivity(a) {
  const steps = (a.steps || []).map((s, i) => {
    let line = `${i + 1}.${s.startTime}-${s.endTime} ${s.stepName}`;
    if (s.venue) line += ' 地点:' + s.venue;
    if (s.ownerName && s.ownerName !== '待分配') line += ' 负责人:' + s.ownerName;
    return line;
  }).join('\n');

  return `时间：${fmtDate(a.activityDate)}${a.arrivalTime ? ' ' + a.arrivalTime : ''}
活动单位：${a.activityUnit}
活动地点：${a.venue}
活动人数：${a.peopleCount}人
业务体现：${a.businessType || ''}
场地使用：${a.venueUsage || ''}
活动流程：
${steps}
结算方式：${a.settlementMethod || ''}
费用合计：${a.totalCost || ''}
活动对接人：${a.contactPerson || ''}
活动预订人：${a.bookingPerson || ''}
客户民族及宗教信仰：${(a.clientInfo || {}).ethnicity || ''}
年龄：${(a.clientInfo || {}).age || ''}
食物禁忌：${(a.clientInfo || {}).dietaryRestrictions || ''}
重要客人接待需求：${(a.clientInfo || {}).specialRequirements || ''}
场地需求：
1.是否需要搭建：${(a.venueNeeds || {}).build ? '是' : '否'}
2.是否需要预演：${(a.venueNeeds || {}).rehearsal ? '是' : '否'}
3.是否需要接电：${(a.venueNeeds || {}).power ? '是' : '否'}
4.是否有主视觉展示：${(a.venueNeeds || {}).mainVisual ? '是' : '否'}
5.是否有现场拍摄/直播：${(a.venueNeeds || {}).filming ? '是' : '否'}
发票特殊需求：${a.invoiceNeeds || ''}
香囊账户：${a.sachetAccount === 'clinic' ? '医馆账户' : a.sachetAccount === 'shop' ? '零号店账户' : '未确认'}`;
}

exports.main = async (event, context) => {
  const headers = event.headers || {};
  const token = headers.authorization || headers.Authorization || '';

  // 鉴权
  if (!API_KEY) {
    return { code: 500, message: '服务未配置 API_KEY 环境变量' };
  }
  if (token !== 'Bearer ' + API_KEY) {
    return { code: 403, message: 'Forbidden: invalid token' };
  }

  // 解析参数（兼容 HTTP body 和云函数调用两种格式）
  let action, date;
  if (event.body) {
    // HTTP 触发：body 是字符串
    try {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      action = body.action;
      date = body.date;
    } catch (e) {
      return { code: 400, message: 'JSON body required' };
    }
  } else {
    // 云函数直接调用
    action = event.action;
    date = event.date;
  }

  if (action !== 'exportByDate') {
    return { code: 404, message: 'Unknown action: ' + (action || 'none') };
  }
  if (!date) {
    return { code: 400, message: 'date is required' };
  }

  // 查询当天正式活动
  let activities;
  try {
    const res = await db.collection('activities')
      .where({
        activityDate: date,
        status: _.in(EXPORT_STATUSES),
      })
      .orderBy('arrivalTime', 'asc')
      .get();
    activities = res.data || [];
  } catch (e) {
    return { code: 500, message: '查询失败: ' + (e.message || '') };
  }

  // 过滤系统文档
  activities = activities.filter(a => !String(a._id).startsWith('_'));

  const result = {
    code: 0,
    date,
    count: activities.length,
    // list: 结构化数据（便于接收方二次处理）
    list: activities.map(a => ({
      activityUnit: a.activityUnit || '',
      venue: a.venue || '',
      arrivalTime: a.arrivalTime || '',
      date: fmtDate(a.activityDate),
      peopleCount: a.peopleCount || 0,
      businessType: a.businessType || '',
      venueUsage: a.venueUsage || '',
      steps: (a.steps || []).map(s => ({
        name: s.stepName || '',
        startTime: s.startTime || '',
        endTime: s.endTime || '',
        venue: s.venue || '',
        ownerName: (s.ownerName && s.ownerName !== '待分配') ? s.ownerName : '',
      })),
      settlementMethod: a.settlementMethod || '',
      totalCost: a.totalCost || '',
      contactPerson: a.contactPerson || '',
      bookingPerson: a.bookingPerson || '',
      clientInfo: a.clientInfo || {},
      venueNeeds: a.venueNeeds || {},
      invoiceNeeds: a.invoiceNeeds || '',
      sachetAccount: a.sachetAccount || '',
    })),
    // text: 纯文本格式（可直接用于打印/IM 转发）
    text: activities.map(formatActivity).join('\n---\n'),
  };

  return result;
};
