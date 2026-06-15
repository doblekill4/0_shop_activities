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
      case 'getMyDraft':
        return await getMyDraft(event, openid);
      case 'export':
        return await exportActivities(event, openid);
      case 'getMonthlyCounts':
        return await getMonthlyCounts(event);
      case 'markCapacityLimit':
        return await markCapacityLimit(event, openid);
      case 'getCapacityLimits':
        return await getCapacityLimits(event);
      case 'getFileTempURL':
        return await getFileTempURL(event);
      case 'checkVenueConflict':
        return await checkVenueConflict(event);
      case 'getVenueOccupancy':
        return await getVenueOccupancy(event);
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
  const { status, sort, page = 1, pageSize = 20, filterDate, filterDateMode } = event;
  const userInfo = await getUserInfo(openid);

  console.log('[getActivityList] userInfo:', userInfo);
  console.log('[getActivityList] openid:', openid);

  let query = db.collection('activities');

  // 排除系统文档
  query = query.where({ _id: _.neq('_system_global_rules') });

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
  } else {
    // 公共列表默认排除草稿
    query = query.where({ status: _.neq('draft') });
  }

  // 日期筛选（云函数层，保证分页准确）
  if (filterDateMode) {
    if (filterDateMode === 'specific' && filterDate) {
      query = query.where({ activityDate: filterDate });
    } else if (filterDateMode === 'today') {
      query = query.where({ activityDate: filterDate });
    } else if (filterDateMode === 'todayAndAfter') {
      query = query.where({ activityDate: _.gte(filterDate) });
    }
  }

  const countRes = await query.count();
  const total = countRes.total;

  const res = await query
    .orderBy('activityDate', 'asc')
    .orderBy('arrivalTime', 'asc')
    .skip((page - 1) * pageSize)
    .limit(pageSize + 1)  // 多取1条，补偿可能被过滤的系统文档
    .get();

  // 过滤系统文档，动态计算状态
  const list = res.data
    .filter(a => !String(a._id).startsWith('_system_') && !String(a._id).startsWith('_limit_') && !String(a._id).startsWith('_task_') && a._type !== 'scheduled_msg')
    .map(a => {
      a.status = computeStatusFromVouchers(a.vouchers, a.status);
      return a;
    })
    .slice(0, pageSize);

  return { code: 0, data: { list, total }, message: 'success' };
}

/* ========== 活动详情 ========== */
async function getActivityDetail(event, openid) {
  const { id } = event;
  const res = await db.collection('activities').doc(id).get();
  if (!res.data) return { code: 404, message: '活动不存在' };
  // 动态计算状态，覆盖数据库中可能过时的 status 字段
  res.data.status = computeStatusFromVouchers(res.data.vouchers, res.data.status);
  return { code: 0, data: res.data, message: 'success' };
}

/* ========== 获取当前用户的草稿 ========== */
async function getMyDraft(event, openid) {
  try {
    const res = await db.collection('activities')
      .where({ creatorId: openid, status: 'draft' })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (res.data && res.data.length > 0) {
      const draft = res.data[0];
      return {
        code: 0,
        data: { id: draft._id, ...draft },
        message: 'success',
      };
    }
    return { code: 0, data: null, message: '无草稿' };
  } catch (e) {
    console.error('[getMyDraft] 失败', e);
    return { code: -1, message: '查询失败' };
  }
}

/* ========== 新建活动（使用 set() 绕过 add() bug） ========== */
async function createActivity(event, openid) {
  const userInfo = await getUserInfo(openid);
  const data = event.data;
  if (!data) return { code: -1, message: '提交数据为空' };

  // 检查接待上限：非草稿提交时，检查当天是否已达接待上限
  if (data.status !== 'draft' && data.activityDate) {
    try {
      const limitDoc = await db.collection('activities').doc('_limit_' + data.activityDate).get().catch(() => null);
      if (limitDoc && limitDoc.data) {
        const hasPower = userInfo.role === 'admin' || (userInfo.permissions || []).includes('set_capacity_limit');
        if (!hasPower) {
          return { code: -1, message: '当天已达接待上限，请联系店长' };
        }
        if (!data._forceSubmit) {
          return { code: 1, message: '当天已达接待上限，是否确认提交？' };
        }
      }
    } catch (e) { /* 忽略 */ }
  }

  console.log('[createActivity] 开始，接收字段数:', Object.keys(data).length);

  // 手动生成 _id（避免 add() 的 bug）
  const _id = 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
  console.log('[createActivity] 手动 _id:', _id);

  const nowISO = new Date().toISOString();

  // 逐个赋值到 cleanDoc（不含 _id，不含 undefined）
  const cleanDoc = {};

  cleanDoc.activityDate   = (data.activityDate || '').toString();
  cleanDoc.arrivalTime    = (data.arrivalTime || '').toString();
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
    try {
      const steps = JSON.parse(JSON.stringify(data.steps));
      // 为每个步骤生成唯一 _id，确保后续流程操作（确认完成等）可精确识别
      steps.forEach(s => {
        if (!s._id) {
          s._id = 'step_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
        }
      });
      cleanDoc.steps = steps;
    } catch (e) { console.warn('[createActivity] steps 拷贝失败', e); }
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

  // 异步调度通知任务（不阻塞创建返回）
  if (cleanDoc.status !== 'draft') {
    scheduleNotificationsAsync(_id);
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
  // 异步调度通知任务（若状态变更可能影响通知时机）
  scheduleNotificationsAsync(id);
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

  // 记录修订日志
  await addVoucherRevisionLog(activityId, openid, 'uploadVoucher', type);

  // 动态更新状态（根据凭证情况）
  await updateActivityStatus(activityId);

  return { code: 0, data: voucher, message: '上传成功' };
}

/* ========== 动态更新活动状态（根据凭证情况） ========== */
async function updateActivityStatus(activityId) {
  try {
    const res = await db.collection('activities').doc(activityId).get();
    if (!res.data) return;

    const vouchers = res.data.vouchers || [];
    const hasSettlement = vouchers.some(v => v.type === 'settlement');
    const hasDeposit    = vouchers.some(v => v.type === 'deposit');

    let newStatus = res.data.status;
    if (hasSettlement) {
      newStatus = 'settled';    // 有结算凭证 → 已结算
    } else if (hasDeposit) {
      newStatus = 'confirmed';  // 有订金凭证 → 已确认
    } else {
      newStatus = 'pending';    // 无凭证 → 待确认
    }

    if (newStatus !== res.data.status) {
      await db.collection('activities').doc(activityId).update({
        data: { status: newStatus, updatedAt: new Date() }
      });
      console.log('[updateActivityStatus]', res.data.status, '→', newStatus);
    }
  } catch (e) {
    console.warn('[updateActivityStatus] 失败（非致命）：', e);
  }
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

  // 记录修订日志
  await addVoucherRevisionLog(activityId, openid, 'deleteVoucher', voucher.type);

  // 动态更新状态（删除凭证后可能需要回退）
  await updateActivityStatus(activityId);

  return { code: 0, message: '删除成功' };
}

/* ========== 甘特图数据 ========== */
async function getGanttData(event, openid) {
  const { startDate, endDate, includePending } = event;
  const whereClause = {
    activityDate: _.gte(startDate).and(_.lte(endDate)),
  };
  if (!includePending) {
    // 默认：已确认 + 已结算
    whereClause.status = _.and(_.in(['confirmed', 'settled']), _.neq('draft'));
  } else {
    // 开启开关：追加待确认，草稿始终排除
    whereClause.status = _.neq('draft');
  }
  const res = await db.collection('activities')
    .where(whereClause)
    .orderBy('activityDate', 'asc')
    .orderBy('arrivalTime', 'asc')
    .get();

  const data = res.data.filter(a => !String(a._id).startsWith('_system_') && !String(a._id).startsWith('_limit_'));
  return { code: 0, data, message: 'success' };
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

/**
 * 根据凭证列表动态计算活动状态
 * 优先级：settlement > deposit > 默认 pending
 * 注意：已结算 > 已确认（有订金）> 待确认（无凭证）
 */
function computeStatusFromVouchers(vouchers, existingStatus) {
  // 草稿状态保持不变
  if (existingStatus === 'draft') return 'draft';
  if (!vouchers || !Array.isArray(vouchers)) return 'pending';
  const hasSettlement = vouchers.some(v => v && v.type === 'settlement');
  const hasDeposit    = vouchers.some(v => v && v.type === 'deposit');
  if (hasSettlement) return 'settled';
  if (hasDeposit)    return 'confirmed';
  return 'pending';
}

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

/**
 * 凭证操作写入修订日志
 */
async function addVoucherRevisionLog(activityId, openid, action, voucherType) {
  try {
    const userInfo = await getUserInfo(openid);
    const revision = {
      action,
      updatedBy: openid,
      updatedByName: userInfo.name || '未知用户',
      updatedAt: new Date(),
      detail: { voucherType },
    };
    await db.collection('activities').doc(activityId).update({
      data: {
        revisionLog: db.command.push(revision),
      }
    });
  } catch (e) {
    console.error('[addVoucherRevisionLog] error', e);
  }
}

// 系统/内部字段，不应出现在修订日志中
const SYSTEM_FIELDS = new Set([
  '_id', 'creatorId', 'creatorName', 'createdAt', 'updatedAt',
  'participants', 'vouchers', 'revisionLog', 'status',
]);

function diffObject(oldObj, newObj) {
  const changes = [];
  const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);
  allKeys.forEach(key => {
    // 跳过系统内部字段
    if (SYSTEM_FIELDS.has(key)) return;
    const oldVal = oldObj ? oldObj[key] : undefined;
    const newVal = newObj ? newObj[key] : undefined;

    // steps 数组：逐环节比较，生成可读变更
    if (key === 'steps' && Array.isArray(oldVal) && Array.isArray(newVal)) {
      const maxLen = Math.max(oldVal.length, newVal.length);
      for (let i = 0; i < maxLen; i++) {
        const oldStep = oldVal[i];
        const newStep = newVal[i];
        if (!oldStep && newStep) {
          changes.push({ field: `环节[${i + 1}]`, old: '', new: `新增「${newStep.stepName || ''}」` });
        } else if (oldStep && !newStep) {
          changes.push({ field: `环节[${i + 1}]`, old: `「${oldStep.stepName || ''}」`, new: '已删除' });
        } else if (oldStep && newStep) {
          // 逐字段比较
          const stepFields = ['stepName', 'startTime', 'endTime', 'venue', 'ownerName'];
          stepFields.forEach(f => {
            const ov = oldStep[f] || '', nv = newStep[f] || '';
            if (ov !== nv) {
              const label = { stepName: '名称', startTime: '开始时间', endTime: '结束时间', venue: '地点', ownerName: '负责人' }[f] || f;
              changes.push({ field: `环节「${newStep.stepName || oldStep.stepName || (i + 1)}」${label}`, old: ov || '未设置', new: nv || '未设置' });
            }
          });
        }
      }
      return;
    }

    // clientInfo / venueNeeds 对象：逐字段展开
    if ((key === 'clientInfo' || key === 'venueNeeds') && JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      const objKeys = new Set([...Object.keys(oldVal || {}), ...Object.keys(newVal || {})]);
      const labels = {
        ethnicity: '民族/宗教', age: '年龄', dietaryRestrictions: '食物禁忌',
        specialRequirements: '接待需求', build: '搭建', rehearsal: '预演',
        power: '接电', mainVisual: '主视觉', filming: '拍摄/直播',
      };
      objKeys.forEach(f => {
        const ov = (oldVal || {})[f], nv = (newVal || {})[f];
        const ovStr = typeof ov === 'boolean' ? (ov ? '是' : '否') : (ov || '');
        const nvStr = typeof nv === 'boolean' ? (nv ? '是' : '否') : (nv || '');
        if (ovStr !== nvStr) {
          changes.push({ field: `${labels[f] || f}`, old: ovStr || '未设置', new: nvStr || '未设置' });
        }
      });
      return;
    }

    // 其他对象/数组：简单摘要
    const isObj = v => v && typeof v === 'object';
    if (isObj(oldVal) || isObj(newVal)) {
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        let oldStr = isObj(oldVal) ? (Array.isArray(oldVal) ? `${oldVal.length}项` : '已设置') : String(oldVal);
        let newStr = isObj(newVal) ? (Array.isArray(newVal) ? `${newVal.length}项` : '已设置') : String(newVal);
        changes.push({ field: key, old: oldStr, new: newStr });
      }
    } else if (oldVal !== newVal) {
      changes.push({ field: key, old: oldVal, new: newVal });
    }
  });
  return changes;
}

/* ========== 接待上限标记 ========== */
async function markCapacityLimit(event, openid) {
  const { date, remove } = event;
  const userInfo = await getUserInfo(openid);
  if (!userInfo || userInfo.role !== 'admin') {
    if (!(userInfo && userInfo.permissions || []).includes('set_capacity_limit')) {
      return { code: 403, message: '无权限' };
    }
  }
  try {
    const limitDocId = '_limit_' + date;
    if (remove) {
      try { await db.collection('activities').doc(limitDocId).remove(); } catch (e) {}
      return { code: 0, message: '已取消接待上限标记' };
    }
    // 存入 activities 集合，_id 前缀 _limit_ 区分
    await db.collection('activities').doc(limitDocId).set({
      data: { date, markedBy: openid, markedByName: userInfo.name, markedAt: new Date() }
    });
    return { code: 0, message: '已标记为接待上限' };
  } catch (e) {
    console.error('[markCapacityLimit] 失败', e.errCode, e.message);
    return { code: -1, message: '操作失败：' + (e.message || '') };
  }
}

async function getCapacityLimits(event) {
  const { year, month } = event;
  try {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const startDate = `${ym}-01`;
    const endDay = new Date(year, month, 0).getDate();
    const endDate = `${ym}-${String(endDay).padStart(2, '0')}`;
    const res = await db.collection('activities')
      .where({ _id: _.gte('_limit_' + startDate).and(_.lte('_limit_' + endDate + 'z')) })
      .get();
    return { code: 0, data: (res.data || []).filter(d => d.date).map(d => d.date), message: 'success' };
  } catch (e) {
    return { code: 0, data: [], message: 'success' };
  }
}

/* ========== 月度活动统计（日历用） ========== */
async function getMonthlyCounts(event) {
  const { year, month } = event;
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  // 获取当月所有活动（排除草稿和系统文档），按日期分组统计
  const startDate = `${ym}-01`;
  const endDay = new Date(year, month, 0).getDate();
  const endDate = `${ym}-${String(endDay).padStart(2, '0')}`;

  const res = await db.collection('activities')
    .where({
      activityDate: _.gte(startDate).and(_.lte(endDate)),
      status: _.neq('draft'),
    })
    .field({ activityDate: true, peopleCount: true })
    .limit(1000)
    .get();

  const countMap = {};      // { date: count }
  const peopleMap = {};     // { date: totalPeople }
  res.data.forEach(a => {
    if (!String(a._id).startsWith('_system_') && !String(a._id).startsWith('_task_') && a._type !== 'scheduled_msg') {
      countMap[a.activityDate] = (countMap[a.activityDate] || 0) + 1;
      peopleMap[a.activityDate] = (peopleMap[a.activityDate] || 0) + (a.peopleCount || 0);
    }
  });

  // 获取当月接待上限标记（存于 activities 集合，_id 前缀 _limit_）
  let limits = [];
  try {
    const lRes = await db.collection('activities')
      .where({ _id: _.gte('_limit_' + startDate).and(_.lte('_limit_' + endDate + 'z')) })
      .get();
    limits = (lRes.data || []).filter(d => d.date).map(d => d.date);
  } catch (e) { /* 忽略 */ }

  return { code: 0, data: { counts: countMap, people: peopleMap, limits }, message: 'success' };
}

/* ========== 获取云存储文件临时链接（管理员权限代理） ========== */
/**
 * 体验版中非开发者使用客户端 SDK 的 getTempFileURL / downloadFile 可能因
 * 云存储权限问题而失败。此接口在云函数端（管理员权限）获取临时链接返回给客户端。
 */
async function getFileTempURL(event) {
  const { fileIDs } = event;
  if (!fileIDs || !Array.isArray(fileIDs) || fileIDs.length === 0) {
    return { code: -1, message: 'fileIDs 不能为空' };
  }
  try {
    const res = await cloud.getTempFileURL({ fileList: fileIDs });
    return { code: 0, data: res.fileList, message: 'success' };
  } catch (e) {
    console.error('[getFileTempURL] 获取临时链接失败:', e.message);
    return { code: -1, message: '获取临时链接失败: ' + (e.message || '') };
  }
}

/* ========== 异步触发通知调度（fire-and-forget） ========== */
function scheduleNotificationsAsync(activityId) {
  cloud.callFunction({
    name: 'notifications',
    data: { action: 'scheduleForActivity', activityId },
  }).then(() => {
    console.log('[scheduleNotificationsAsync] 调度成功:', activityId);
  }).catch(e => {
    console.warn('[scheduleNotificationsAsync] 调度失败:', activityId, e.message);
  });
}

/* ========== 场地冲突检测 ========== */
/**
 * 检测提交的环节是否与已有正式活动（confirmed/settled）冲突
 * 输入: { activityDate, steps: [{ stepName, startTime, endTime, venue }], excludeId }
 * 返回: { code: 0/1, data: { conflicts: [...] } }
 */
async function checkVenueConflict(event) {
  const { activityDate, steps, excludeId } = event;
  if (!activityDate || !steps || !steps.length) {
    return { code: 0, data: { conflicts: [] }, message: '无环节无需检测' };
  }

  // 查当天所有正式活动（confirmed/settled），排除自身
  const where = {
    activityDate,
    status: _.in(['confirmed', 'settled']),
  };
  if (excludeId) where._id = _.neq(excludeId);

  const res = await db.collection('activities')
    .where(where)
    .field({ _id: true, activityUnit: true, bookingPerson: true, steps: true })
    .get();

  const existingActs = (res.data || []).filter(a => !String(a._id).startsWith('_system_') && !String(a._id).startsWith('_limit_'));
  const conflicts = [];

  for (const newStep of steps) {
    if (!newStep.venue || !newStep.startTime || !newStep.endTime) continue;
    const [nsH, nsM] = newStep.startTime.split(':').map(Number);
    const [neH, neM] = newStep.endTime.split(':').map(Number);
    const newStart = nsH * 60 + nsM;
    const newEnd = neH * 60 + neM;
    if (isNaN(newStart) || isNaN(newEnd)) continue;

    for (const act of existingActs) {
      for (const exStep of (act.steps || [])) {
        if (!exStep.venue || exStep.venue !== newStep.venue) continue;
        if (!exStep.startTime || !exStep.endTime) continue;
        const [esH, esM] = exStep.startTime.split(':').map(Number);
        const [eeH, eeM] = exStep.endTime.split(':').map(Number);
        const exStart = esH * 60 + esM;
        const exEnd = eeH * 60 + eeM;
        if (isNaN(exStart) || isNaN(exEnd)) continue;

        // 时间段重叠判断: not (newEnd <= exStart || newStart >= exEnd)
        if (newEnd > exStart && newStart < exEnd) {
          conflicts.push({
            venue: newStep.venue,
            newStepName: newStep.stepName || '未命名环节',
            newTime: `${newStep.startTime}-${newStep.endTime}`,
            conflictActivity: act.activityUnit || '未知活动',
            conflictStep: exStep.stepName || '未命名环节',
            conflictTime: `${exStep.startTime}-${exStep.endTime}`,
            conflictBooker: act.bookingPerson || '未知',
          });
        }
      }
    }
  }

  if (conflicts.length > 0) {
    return { code: 1, data: { conflicts }, message: `发现 ${conflicts.length} 处场地冲突` };
  }
  return { code: 0, data: { conflicts: [] }, message: '无冲突' };
}

/* ========== 场地占用查询（可视化用） ========== */
async function getVenueOccupancy(event) {
  const { activityDate } = event;
  if (!activityDate) return { code: -1, message: '缺少活动日期' };

  const res = await db.collection('activities')
    .where({ activityDate, status: _.in(['confirmed', 'settled']) })
    .field({ activityUnit: true, bookingPerson: true, steps: true })
    .get();

  const occupancy = {};
  (res.data || []).forEach(act => {
    if (String(act._id).startsWith('_system_') || String(act._id).startsWith('_limit_')) return;
    (act.steps || []).forEach(step => {
      if (!step.venue || !step.startTime || !step.endTime) return;
      if (!occupancy[step.venue]) occupancy[step.venue] = [];
      occupancy[step.venue].push({
        activityUnit: act.activityUnit || '',
        bookingPerson: act.bookingPerson || '',
        stepName: step.stepName || '',
        startTime: step.startTime,
        endTime: step.endTime,
      });
    });
  });

  return { code: 0, data: occupancy, message: 'success' };
}
