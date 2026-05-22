// cloudfunctions/activities/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * 活动管理云函数
 * 接收 action 参数分发不同操作
 */
exports.main = async (event, context) => {
  const { action } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    switch (action) {
      case 'list':
        return await getActivityList(event, openid);
      case 'detail':
        return await getActivityDetail(event, openid);
      case 'create':
        return await createActivity(event, openid);
      case 'update':
        return await updateActivity(event, openid);
      case 'delete':
        return await deleteActivity(event, openid);
      case 'revisions':
        return await getRevisionLog(event, openid);
      case 'addVoucher':
        return await addVoucher(event, openid);
      case 'deleteVoucher':
        return await deleteVoucher(event, openid);
      case 'gantt':
        return await getGanttData(event, openid);
      case 'export':
        return await exportActivities(event, openid);
      default:
        return { code: -1, message: '未知操作' };
    }
  } catch (e) {
    console.error(`[activities.${action}] error`, e);
    return { code: -1, message: e.message || '服务异常' };
  }
};

/* ========== 活动列表 ========== */
async function getActivityList(event, openid) {
  const { status, sort, page = 1, pageSize = 20 } = event;
  const userInfo = await getUserInfo(openid);

  console.log('[getActivityList] userInfo:', userInfo);
  console.log('[getActivityList] openid:', openid);

  let query = db.collection('activities');

  // 管理员/经理看全部，普通用户才做权限过滤
  if (userInfo.role !== 'admin' && userInfo.role !== 'manager') {
    if (!status) {
      query = query.where(_.or([
        { creatorId: openid },
        { participants: openid },
        { status: 'confirmed' },
      ]));
    } else {
      query = query.where(_.or([
        { creatorId: openid },
        { participants: openid },
      ]));
    }
  }

  if (status) {
    query = query.where({ status });
  }

  const countRes = await query.count();
  const total = countRes.total;

  let orderByField = 'activityDate';
  let orderDirection = 'asc';
  if (sort === 'date_asc,first_step_asc') {
    orderByField = 'activityDate';
    orderDirection = 'asc';
  }

  const res = await query
    .orderBy(orderByField, orderDirection)
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return { code: 0, data: { list: res.data, total }, message: 'success' };
}

/* ========== 活动详情 ========== */
async function getActivityDetail(event, openid) {
  const { id } = event;
  const res = await db.collection('activities').doc(id).get();
  if (!res.data) return { code: 404, message: '活动不存在' };
  return { code: 0, data: res.data, message: 'success' };
}

/* ========== 新建活动（使用 set() 绕过 add() bug） ========== */
async function createActivity(event, openid) {
  const userInfo = await getUserInfo(openid);
  const data = event.data;
  if (!data) return { code: -1, message: '提交数据为空' };

  console.log('[createActivity] 开始，接收字段数:', Object.keys(data).length);

  // 手动生成 _id（避免 add() 的 bug）
  const _id = 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
  console.log('[createActivity] 手动 _id:', _id);

  const nowISO = new Date().toISOString();

  // 逐个赋值到 cleanDoc（不含 _id，不含 undefined）
  const cleanDoc = {};

  cleanDoc.activityDate   = (data.activityDate || '').toString();
  cleanDoc.activityUnit   = (data.activityUnit || '').toString();
  cleanDoc.venue         = (data.venue || '').toString();
  cleanDoc.peopleCount   = parseInt(data.peopleCount) || 0;
  cleanDoc.businessType  = (data.businessType || '').toString();
  cleanDoc.venueUsage   = (data.venueUsage || '').toString();
  cleanDoc.status        = (data.status || 'draft').toString();
  cleanDoc.settlementMethod = (data.settlementMethod || '').toString();
  cleanDoc.totalCost     = (data.totalCost || '').toString();
  cleanDoc.contactPerson = (data.contactPerson || '').toString();
  cleanDoc.bookingPerson = (data.bookingPerson || '').toString();
  cleanDoc.invoiceNeeds  = (data.invoiceNeeds || '').toString();
  cleanDoc.sachetAccount = (data.sachetAccount || 'clinic').toString();
  cleanDoc.creatorId    = openid;
  cleanDoc.creatorName   = (userInfo.name || '').toString();
  cleanDoc.createdAt     = nowISO;
  cleanDoc.updatedAt     = nowISO;
  cleanDoc.participants  = [];
  cleanDoc.steps         = [];
  cleanDoc.vouchers      = [];
  cleanDoc.revisionLog   = [];

  // 复杂对象：用 JSON 深拷贝（去除 undefined）
  if (data.clientInfo && typeof data.clientInfo === 'object') {
    try {
      const ci = JSON.parse(JSON.stringify(data.clientInfo));
      Object.keys(ci).forEach(k => { if (ci[k] === undefined) delete ci[k]; });
      cleanDoc.clientInfo = ci;
    } catch (e) { console.warn('[createActivity] clientInfo 拷贝失败', e); }
  }
  if (data.venueNeeds && typeof data.venueNeeds === 'object') {
    try {
      const vn = JSON.parse(JSON.stringify(data.venueNeeds));
      Object.keys(vn).forEach(k => { if (vn[k] === undefined) delete vn[k]; });
      cleanDoc.venueNeeds = vn;
    } catch (e) { console.warn('[createActivity] venueNeeds 拷贝失败', e); }
  }
  if (data.steps && Array.isArray(data.steps) && data.steps.length > 0) {
    try { cleanDoc.steps = JSON.parse(JSON.stringify(data.steps)); } catch (e) {}
  }

  console.log('[createActivity] cleanDoc 字段数:', Object.keys(cleanDoc).length);
  console.log('[createActivity] cleanDoc keys:', Object.keys(cleanDoc).join(','));

  // 使用 set() 写入（cleanDoc 不含 _id，不含 undefined）
  try {
    console.log('[createActivity] 调用 set()...');
    await db.collection('activities').doc(_id).set({ data: cleanDoc });
    console.log('[createActivity] set() 成功');
  } catch (e) {
    console.error('[createActivity] set() 失败:', e);
    throw e;
  }

  // 验证
  try {
    const verifyRes = await db.collection('activities').doc(_id).get();
    const savedFields = verifyRes.data ? Object.keys(verifyRes.data) : [];
    console.log('[createActivity] 验证：已保存', savedFields.length, '个字段:', savedFields.join(','));
    if (savedFields.length <= 1) {
      console.error('[createActivity] ⚠️ 验证失败！只有:', savedFields);
    } else {
      console.log('[createActivity] ✅ 写入成功！');
    }
  } catch (e) {
    console.error('[createActivity] 验证异常:', e);
  }

  return { code: 0, data: { id: _id }, message: '创建成功' };
}

/* ========== 更新活动（带修订记录） ========== */
async function updateActivity(event, openid) {
  const { id, data } = event;
  const userInfo = await getUserInfo(openid);

  const oldRes = await db.collection('activities').doc(id).get();
  if (!oldRes.data) return { code: 404, message: '活动不存在' };

  const revision = {
    updatedBy: openid,
    updatedByName: userInfo.name,
    updatedAt: new Date(),
    changes: diffObject(oldRes.data, data),
  };

  const existingRevisionLog = oldRes.data.revisionLog || [];
  existingRevisionLog.push(revision);

  const updateData = {};
  // 逐个赋值，避免 ... 展开运算符
  for (let key in data) {
    updateData[key] = data[key];
  }
  updateData.updatedAt = new Date();
  updateData.revisionLog = existingRevisionLog;

  await db.collection('activities').doc(id).update({ data: updateData });
  return { code: 0, message: '更新成功' };
}

/* ========== 删除活动 ========== */
async function deleteActivity(event, openid) {
  const { id } = event;
  const userInfo = await getUserInfo(openid);
  if (userInfo.role !== 'admin') return { code: 403, message: '无权限' };

  await db.collection('activities').doc(id).remove();
  return { code: 0, message: '删除成功' };
}

/* ========== 修订日志 ========== */
async function getRevisionLog(event, openid) {
  const { activityId } = event;
  const res = await db.collection('activities').doc(activityId).get();
  if (!res.data) return { code: 404, message: '活动不存在' };
  return { code: 0, data: res.data.revisionLog || [], message: 'success' };
}

/* ========== 添加凭证记录 ========== */
async function addVoucher(event, openid) {
  const { activityId, type, fileID } = event;
  console.log('[addVoucher] activityId:', activityId, 'type:', type, 'fileID:', fileID);

  const voucher = {
    _id: Date.now() + '_' + Math.random().toString(36).slice(2),
    type: type,
    fileID: fileID,
    url: fileID,  // 存一份 url 供前端预览用
    uploadedBy: openid,
    uploadedAt: new Date(),
  };

  // 先获取当前活动文档
  const activityRes = await db.collection('activities').doc(activityId).get();
  if (!activityRes.data) {
    return { code: 404, message: '活动不存在' };
  }

  // 手动管理数组
  const existingVouchers = activityRes.data.vouchers || [];
  existingVouchers.push(voucher);

  // 更新文档
  await db.collection('activities').doc(activityId).update({
    data: {
      vouchers: existingVouchers,
      updatedAt: new Date(),
    }
  });

  console.log('[addVoucher] 写入成功');

  // 自动检查：如果订金、结算、账单三种凭证都已上传，自动将状态改为 confirmed
  try {
    const updatedRes = await db.collection('activities').doc(activityId).get();
    const allVouchers = updatedRes.data.vouchers || [];
    const hasDeposit    = allVouchers.some(v => v.type === 'deposit');
    const hasSettlement = allVouchers.some(v => v.type === 'settlement');
    const hasBill       = allVouchers.some(v => v.type === 'bill');
    if (hasDeposit && hasSettlement && hasBill) {
      await db.collection('activities').doc(activityId).update({
        data: { status: 'confirmed', updatedAt: new Date() }
      });
      console.log('[addVoucher] 三种凭证已齐，状态自动变更为 confirmed');
    }
  } catch (e) {
    console.warn('[addVoucher] 自动确认状态失败（非致命）:', e);
  }

  return { code: 0, data: voucher, message: '上传成功' };
}

/* ========== 删除凭证 ========== */
async function deleteVoucher(event, openid) {
  const { activityId, voucherId } = event;
  const res = await db.collection('activities').doc(activityId).get();
  if (!res.data) return { code: 404, message: '活动不存在' };

  const voucher = res.data.vouchers.find(v => v._id === voucherId);
  if (!voucher) return { code: 404, message: '凭证不存在' };

  const userInfo = await getUserInfo(openid);
  if (voucher.uploadedBy !== openid && userInfo.role !== 'admin') {
    return { code: 403, message: '无权限删除此凭证' };
  }

  try { await cloud.deleteFile({ fileList: [voucher.fileID] }); } catch (e) {}

  const newVouchers = res.data.vouchers.filter(v => v._id !== voucherId);
  await db.collection('activities').doc(activityId).update({
    data: {
      vouchers: newVouchers,
      updatedAt: new Date(),
    }
  });

  return { code: 0, message: '删除成功' };
}

/* ========== 甘特图数据 ========== */
async function getGanttData(event, openid) {
  const { startDate, endDate, includePending } = event;
  const whereClause = {
    activityDate: _.gte(startDate).and(_.lte(endDate)),
  };
  if (!includePending) {
    whereClause.status = 'confirmed';
  }
  const res = await db.collection('activities')
    .where(whereClause)
    .orderBy('activityDate', 'asc')
    .get();

  return { code: 0, data: res.data, message: 'success' };
}

/* ========== 导出 ========== */
async function exportActivities(event, openid) {
  const { format, ids } = event;
  const res = await db.collection('activities')
    .where({ _id: _.in(ids) })
    .get();
  return { code: 0, data: res.data, message: 'success' };
}

/* ========== 工具函数 ========== */
async function getUserInfo(openid) {
  if (!openid) {
    console.warn('[getUserInfo] openid is empty');
    return { role: 'user', name: '未知用户' };
  }
  try {
    const res = await db.collection('users').where({ openid }).get();
    if (res.data && res.data.length > 0) {
      console.log('[getUserInfo] found user:', res.data[0].name, 'role:', res.data[0].role);
      return res.data[0];
    }
    console.warn('[getUserInfo] no user found for openid:', openid);
    return { role: 'user', name: '未知用户' };
  } catch (e) {
    console.error('[getUserInfo] query failed:', e);
    return { role: 'user', name: '未知用户' };
  }
}

function diffObject(oldObj, newObj) {
  const changes = [];
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  allKeys.forEach(key => {
    if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key])) {
      changes.push({ field: key, old: oldObj[key], new: newObj[key] });
    }
  });
  return changes;
}
