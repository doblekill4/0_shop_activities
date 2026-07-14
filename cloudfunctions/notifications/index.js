// cloudfunctions/notifications/index.js - 通知功能云函数（事件驱动模式）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 订阅消息模板 ID
const TMPL_ID = 'XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70';            // 定时提醒（活动/环节开始前）
const TMPL_CLEAN = 'gw8f84WumXoZkBDaMErZ7YVDTna9P8jwosJf0bURSSg';         // 清洁任务提醒
const TMPL_STATUS = 'vRCdbLk5V3L1OpnyPm7M5oOUWIBJIZh7jnNi6SFRfwA';        // 活动状态变更通知

// 微信订阅消息字段长度限制
// thing*: 20字, name*: 10字, phrase*: 5字, time*: 无限制
function fit(v, max) { return (v || '').length > max ? (v || '').slice(0, max - 3) + '...' : (v || ''); }

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    switch (event.action) {
      case 'sendChange':
        return await sendChangeNotification(event, openid);
      case 'configureReminders':
        return await configureReminders(event, openid);
      case 'getHistory':
        return await getNotificationHistory(event, openid);
      case 'loadGlobalReminders':
        return await loadGlobalReminders();
      case 'hookStepCompleted':
        return await hookStepCompleted(event, openid);
      case 'scanAndNotify':
        return await scanAndNotify();
      case 'scheduleForActivity':
        return await scheduleForActivity(event);
      case 'testSend':
        return await testSend(event, openid);
      default:
        return { code: -1, message: '未知操作' };
    }
  } catch (e) {
    console.error('[notifications] error', e);
    return { code: -1, message: e.message || '服务异常' };
  }
};

/* ========== 发送变更通知 ========== */
async function sendChangeNotification(event, openid) {
  const { activityId, groupIds, message } = event;

  const actRes = await db.collection('activities').doc(activityId).get();
  if (!actRes.data) return { code: 404, message: '活动不存在' };

  // 兼容：groupIds 可以是部门名数组，也可以是人名数组
  const usersRes = await db.collection('users')
    .where(_.or([
      { department: _.in(groupIds) },
      { name: _.in(groupIds) },
    ]))
    .get();

  const notifications = usersRes.data.map(user => ({
    userId: user._id,
    userName: user.name,
    openid: user.openid,
    activityId,
    activityUnit: actRes.data.activityUnit || '',
    message,
    isRead: false,
    createdAt: new Date(),
  }));

  let sentCount = 0;
  if (notifications.length > 0) {
    const activityDate = actRes.data.activityDate;
    // 查当天所有非草稿活动，统计每人总环节数
    let allSteps = [];
    try {
      const dayActs = await db.collection('activities')
        .where({ activityDate, status: _.neq('draft') })
        .field({ steps: true })
        .get();
      (dayActs.data || []).forEach(a => {
        if (!String(a._id).startsWith('_')) allSteps.push(...(a.steps || []));
      });
    } catch (e) { /* 失败时仅用当前活动 */ }
    
    for (const n of notifications) {
      await db.collection('notifications').add({ data: n });
      // 统计此人当天所有活动中的总环节数
      const totalCount = allSteps.filter(s => s.ownerId === n.userId || s.ownerName === n.userName).length;
      const arrivalTime = actRes.data.arrivalTime || '';
      const dateStr = activityDate ? activityDate.slice(5).replace('-','月') + '日' : '今日';
      await sendSubscribeMsg(n.openid, {
        time4: { value: arrivalTime || (new Date().getHours() + ':' + String(new Date().getMinutes()).padStart(2,'0')) },
        thing1: { value: fit(dateStr, 20) },
        thing2: { value: totalCount > 0 ? fit(`${totalCount}个环节需留意`, 20) : fit(n.message || '活动已更新', 20) },
        phrase3: { value: '进行中' },
        thing7: { value: fit(actRes.data.bookingPerson || actRes.data.creatorName || '负责人', 20) },
      }, activityId, TMPL_STATUS);
      sentCount++;
    }
  }

  return { code: 0, data: { sentCount }, message: '通知已发送' };
}

/* ========== 配置提醒规则（保存后触发调度） ========== */
async function configureReminders(event, openid) {
  const { activityId, rules } = event;

  if (activityId === 'global') {
    try {
      await db.collection('activities').doc('_system_global_rules').set({
        data: { key: 'global_reminder_rules', value: rules, updatedAt: new Date() }
      });
    } catch (e) {
      await db.collection('activities').doc('_system_global_rules').update({
        data: { value: rules, updatedAt: new Date() }
      });
    }
    // 全局规则变更 → 重新调度所有今日活动
    await scheduleAllToday();
    return { code: 0, message: '全局规则已更新，已重新调度今日通知' };
  }

  // 活动级规则
  await db.collection('activities').doc(activityId).update({
    data: { reminderRules: rules, updatedAt: new Date() }
  });
  // 重新调度该活动的通知任务
  const scheduleResult = await scheduleForActivity({ activityId });
  return { code: 0, data: scheduleResult.data, message: '提醒规则已更新，已重新调度通知' };
}

/* ========== 加载全局提醒规则 ========== */
async function loadGlobalReminders() {
  try {
    const res = await db.collection('activities').doc('_system_global_rules').get();
    return { code: 0, data: (res.data && res.data.value) ? res.data.value : [], message: 'success' };
  } catch (e) {
    return { code: 0, data: [], message: 'success' };
  }
}

/* ========== 获取通知历史 ========== */
async function getNotificationHistory(event, openid) {
  const { activityId } = event;
  const res = await db.collection('notifications')
    .where({ activityId })
    .orderBy('createdAt', 'desc')
    .get();
  return { code: 0, data: res.data, message: 'success' };
}

/* ========== 环节完成后通知（实时触发，不走任务队列） ========== */
async function hookStepCompleted(event, openid) {
  const { activityId, stepIndex } = event;
  const actRes = await db.collection('activities').doc(activityId).get();
  if (!actRes.data) return { code: 0, message: '活动不存在，跳过' };

  const steps = actRes.data.steps || [];

  let rules = actRes.data.reminderRules || [];
  try {
    const gRes = await db.collection('activities').doc('_system_global_rules').get();
    if (gRes.data && gRes.data.value) {
      rules = [...(gRes.data.value || []), ...rules];
    }
  } catch (e) { /* 忽略 */ }

  console.log('[hookStepCompleted] stepIndex:', stepIndex, 'rules:', rules.length, 'timingIndex:', rules.map(r => r.timingIndex));

  // 下一环节通知（timingIndex === 3）：跳过已完成的环节，顺延通知下一个未完成环节
  const hasNextStep = rules.some(r => r.timingIndex === 3);
  console.log('[hookStepCompleted] hasNextStep:', hasNextStep, 'steps total:', steps.length);
  const notifyInfo = { sent: false, ownerName: '', ownerNotifyEnabled: true };
  if (hasNextStep) {
    let nextIdx = stepIndex + 1;
    while (nextIdx < steps.length && steps[nextIdx].completedAt) {
      nextIdx++;
    }
    const nextStep = steps[nextIdx];
    console.log('[hookStepCompleted] nextIdx:', nextIdx, 'nextStep:', nextStep ? nextStep.stepName : '无', 'ownerId:', nextStep ? nextStep.ownerId : '');
    if (!nextStep) {
      console.log('[hookStepCompleted] 无下一环节（已是最后一个），跳过通知');
      notifyInfo.reason = 'last_step';
    } else if (!nextStep.ownerId || nextStep.ownerId === '__pending__') {
      console.log('[hookStepCompleted] 下一环节无负责人或待分配，跳过通知');
      notifyInfo.ownerName = nextStep.stepName || '';
      notifyInfo.reason = 'no_owner';
    } else {
      notifyInfo.ownerName = nextStep.ownerName || '';
      const userRes = await db.collection('users').doc(nextStep.ownerId).get().catch(() => null);
      if (userRes && userRes.data) {
        notifyInfo.ownerNotifyEnabled = userRes.data.notifyEnabled !== false;
        notifyInfo.ownerName = userRes.data.name || nextStep.ownerName || '';
      }
      if (userRes && userRes.data && userRes.data.openid) {
        const unit = fit(actRes.data.activityUnit, 20);
        const stepMsg = fit(`${steps[stepIndex].stepName || ''}→${nextStep.stepName || ''}`, 20);
        const venue = fit(actRes.data.venue, 20);
        const owner = fit(nextStep.ownerName || userRes.data.name, 10);
        const startTime = nextStep.startTime || '';

        const sent = await sendRobust(userRes.data.openid, [
          [TMPL_ID,     { thing24: { value: unit }, thing12: { value: stepMsg }, thing10: { value: venue }, name3: { value: owner }, time27: { value: startTime } }],
          [TMPL_STATUS, { time4: { value: startTime }, thing1: { value: unit }, thing2: { value: stepMsg }, phrase3: { value: '进行中' }, thing7: { value: owner } }],
          [TMPL_CLEAN,  { time3: { value: startTime }, thing1: { value: venue }, thing2: { value: stepMsg } }],
        ], actRes.data._id);

        notifyInfo.sent = !!sent;
        if (sent) {
          await recordNotification(activityId, nextStep.ownerId, userRes.data.name,
            `上一环节「${steps[stepIndex].stepName}」已完成→「${nextStep.stepName}」`);
        }
      }
    }
  }

  // 每环节结束后通知指定部门主管（timingIndex === 4）→ 使用清洁任务提醒模板
  const deptRules = rules.filter(r => r.timingIndex === 4);
  for (const rule of deptRules) {
    const doneStep = steps[stepIndex];
    const targets = rule.targets || [];
    const deptNames = targets.map(t => t.name);
    const supervisors = [];
    for (const deptName of deptNames) {
      const deptSups = await findDepartmentSupervisors(deptName);
      supervisors.push(...deptSups);
    }
    const notified = new Set();
    for (const sup of supervisors) {
      if (!sup.openid || notified.has(sup.openid)) continue;
      notified.add(sup.openid);
      await sendSubscribeMsg(sup.openid, {
        time3: { value: new Date().toTimeString().slice(0, 5) },
        thing1: { value: fit(actRes.data.venue || '零号店', 20) },
        thing2: { value: fit(`活动「${actRes.data.activityUnit || ''}」环节「${(doneStep && doneStep.stepName) || ''}」已完成，请安排清洁`, 20) },
      }, actRes.data._id, TMPL_CLEAN);
      await recordNotification(activityId, sup._id, sup.name,
        `活动「${actRes.data.activityUnit}」环节「${(doneStep && doneStep.stepName) || ''}」完成→请清洁`);
    }
  }

  return { code: 0, message: '通知检查完成', data: notifyInfo };
}

/* ========== 用户缓存 ========== */
let _userCache = null;
let _userCacheTime = 0;
async function getUserCache() {
  if (_userCache && Date.now() - _userCacheTime < 60000) return _userCache;
  const res = await db.collection('users').limit(200).get();
  _userCache = {};
  (res.data || []).forEach(u => {
    if (u.status === 'inactive') return; // 离职用户不入缓存
    if (u.name) _userCache[u.name] = u;
    if (u._id) _userCache[u._id] = u;
  });
  _userCacheTime = Date.now();
  return _userCache;
}

/* ========== 为单个活动预生成通知任务 ========== */
async function scheduleForActivity(event) {
  const { activityId } = event;

  // 1. 删除该活动旧的未发送任务
  await deleteActivityTasks(activityId);

  // 2. 加载活动数据
  const actRes = await db.collection('activities').doc(activityId).get();
  if (!actRes.data) return { code: 404, message: '活动不存在' };
  const act = actRes.data;
  if (act.status === 'draft') return { code: 0, data: { created: 0 }, message: '草稿不调度' };

  // 3. 合并规则
  let rules = act.reminderRules || [];
  try {
    const gRes = await db.collection('activities').doc('_system_global_rules').get();
    if (gRes.data && gRes.data.value) {
      rules = [...(gRes.data.value || []), ...rules];
    }
  } catch (e) { /* 忽略 */ }

  if (rules.length === 0) return { code: 0, data: { created: 0 }, message: '无规则' };

  // 4. 预加载用户缓存
  const userCache = await getUserCache();
  const tasks = [];
  const activityDate = act.activityDate;
  const arrivalTime = act.arrivalTime || '08:00';
  const [aH, aM] = arrivalTime.split(':').map(Number);
  const baseDate = new Date(activityDate + 'T00:00:00');
  const activityStart = new Date(baseDate.getTime() + (aH || 8) * 3600000 + (aM || 0) * 60000);
  const steps = act.steps || [];

  for (const rule of rules) {
    const targets = rule.targets || [];

    if (rule.timingIndex === 0) {
      // 「活动开始前 N 分钟」通知指定人员
      const triggerAt = new Date(activityStart.getTime() - (rule.minutes || 30) * 60000);
      for (const t of targets) {
        const user = userCache[t.name];
        if (!user || !user.openid) continue;
        tasks.push(createTask(activityId, user, {
          thing24: { value: fit(act.activityUnit, 20) },
          thing12: { value: fit(`${rule.minutes || 30}分钟后开始`, 20) },
          thing10: { value: fit(act.venue, 20) },
          name3: { value: fit(user.name || act.creatorName, 10) },
          time27: { value: arrivalTime || act.activityDate || '' },
        }, triggerAt));
      }
    } else if (rule.timingIndex === 1) {
      // 「活动结束后 N 分钟」通知指定人员
      const endTime = new Date(baseDate.getTime() + 18 * 3600000); // 默认 18:00
      const triggerAt = new Date(endTime.getTime() + (rule.minutes || 30) * 60000);
      for (const t of targets) {
        const user = userCache[t.name];
        if (!user || !user.openid) continue;
        tasks.push(createTask(activityId, user, {
          thing24: { value: fit(act.activityUnit, 20) },
          thing12: { value: fit('活动已结束', 20) },
          thing10: { value: fit(act.venue, 20) },
          name3: { value: fit(user.name || act.creatorName, 10) },
          time27: { value: arrivalTime || act.activityDate || '' },
        }, triggerAt));
      }
    } else if (rule.timingIndex === 2) {
      // 「流程开始前 N 分钟」通知环节负责人
      for (const step of steps) {
        if (!step.startTime || !step.ownerId) continue;
        const [sH, sM] = step.startTime.split(':').map(Number);
        const stepStart = new Date(baseDate.getTime() + (sH || 0) * 3600000 + (sM || 0) * 60000);
        const triggerAt = new Date(stepStart.getTime() - (rule.minutes || 30) * 60000);
        const user = userCache[step.ownerId];
        if (!user || !user.openid) continue;
        tasks.push(createTask(activityId, user, {
          thing24: { value: fit(act.activityUnit, 20) },
          thing12: { value: fit(`${step.stepName || ''}即将开始`, 20) },
          thing10: { value: fit(act.venue, 20) },
          name3: { value: fit(step.ownerName || user.name, 10) },
          time27: { value: step.startTime || '' },
        }, triggerAt));
      }
    }
    // timingIndex 3/4 由 hookStepCompleted 实时触发，不需要预调度
  }

  // 5. 批量写入任务文档（_task_YYYYMMDD_{activityId}_{index}）
  let created = 0;
  for (const task of tasks) {
    try {
      await db.collection('activities').add({ data: task });
      created++;
    } catch (e) {
      console.error('[scheduleForActivity] 写入任务失败:', e.message);
    }
  }

  return { code: 0, data: { created }, message: `已生成 ${created} 个通知任务` };
}

/* ========== 为今日所有活动批量调度（安全兜底） ========== */
async function scheduleAllToday() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const res = await db.collection('activities')
    .where({ activityDate: todayStr, status: _.neq('draft') })
    .field({ _id: true })
    .get();

  let total = 0;
  for (const act of res.data) {
    if (String(act._id).startsWith('_system_') || String(act._id).startsWith('_limit_') || String(act._id).startsWith('_task_')) continue;
    const r = await scheduleForActivity({ activityId: act._id });
    total += (r.data && r.data.created) || 0;
  }
  return { code: 0, data: { total }, message: '全量调度完成' };
}

/* ========== 定时扫描：只查待发送任务 ========== */
async function scanAndNotify() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Step 1: 安全兜底 — 检查今日活动是否已调度，未调度的补上
  await ensureTodayScheduled(todayStr);

  // Step 2: 查询所有到期未发送任务
  const tasks = await db.collection('activities')
    .where({
      _type: 'scheduled_msg',
      triggerAt: _.lte(now),
      sent: false,
    })
    .limit(50)
    .get();

  let sentCount = 0;
  for (const task of tasks.data) {
    try {
      // 再次检查 sent 状态（防止并发重复发送）
      const fresh = await db.collection('activities').doc(task._id).get().catch(() => null);
      if (!fresh || !fresh.data || fresh.data.sent) continue;

      await sendSubscribeMsg(task.openid, task.templateData, task.activityId);
      await recordNotification(
        task.activityId,
        task.openid,
        task.userName || '',
        task.notifyMsg || '定时提醒'
      );

      // 标记为已发送
      await db.collection('activities').doc(task._id).update({
        data: { sent: true, sentAt: now }
      });
      sentCount++;
    } catch (e) {
      console.error('[scanAndNotify] 发送任务失败:', task._id, e.message);
    }
  }

  // Step 3: 清理已过期但未发送的任务（超过触发时间 2 小时）
  const expireTime = new Date(now.getTime() - 2 * 3600000);
  try {
    const expired = await db.collection('activities')
      .where({ _type: 'scheduled_msg', triggerAt: _.lte(expireTime), sent: false })
      .limit(20)
      .get();
    for (const t of expired.data) {
      await db.collection('activities').doc(t._id).remove().catch(() => {});
    }
  } catch (e) { /* 忽略 */ }

  return { code: 0, data: { sentCount }, message: '扫描完成' };
}

/* ========== 确保今日任务已调度（仅今日第一次运行时执行） ========== */
let _lastScheduleDate = '';
async function ensureTodayScheduled(todayStr) {
  if (_lastScheduleDate === todayStr) return; // 今日已调度过
  _lastScheduleDate = todayStr;

  // 检查今日是否已有任务
  const existing = await db.collection('activities')
    .where({ _type: 'scheduled_msg', triggerAt: _.gte(new Date(todayStr + 'T00:00:00')) })
    .limit(1)
    .get();

  if (existing.data.length > 0) return; // 已有任务，跳过

  // 没有任务 → 补调度
  console.log('[ensureTodayScheduled] 今日任务缺失，补调度:', todayStr);
  await scheduleAllToday();
}

/* ========== 删除活动的通知任务 ========== */
async function deleteActivityTasks(activityId) {
  try {
    const tasks = await db.collection('activities')
      .where({ _type: 'scheduled_msg', activityId, sent: false })
      .get();
    for (const t of tasks.data) {
      await db.collection('activities').doc(t._id).remove().catch(() => {});
    }
  } catch (e) { /* 忽略 */ }
}

/* ========== 生成单个任务文档 ========== */
function createTask(activityId, user, templateData, triggerAt) {
  return {
    _type: 'scheduled_msg',
    activityId,
    openid: user.openid,
    userName: user.name || '',
    templateData,
    triggerAt,
    sent: false,
    notifyMsg: templateData.thing12 ? templateData.thing12.value : '',
    createdAt: new Date(),
  };
}

/* ========== 测试通知（仅王万全使用） ========== */
async function testSend(event, openid) {
  // 查找王万全的 openid
  const userRes = await db.collection('users').where({ name: '王万全' }).get();
  if (!userRes.data || !userRes.data[0]) {
    return { code: 404, message: '未找到用户王万全' };
  }
  const targetOpenid = userRes.data[0].openid;
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: targetOpenid,
      templateId: TMPL_ID,
      page: 'pages/activity-list/activity-list',
      data: {
        thing24: { value: '知嘛健康零号店' },
        thing12: { value: '通知系统测试' },
        thing10: { value: '零号店' },
        name3: { value: '王万全' },
        time27: { value: new Date().toTimeString().slice(0, 5) },
      },
      miniprogramState: 'formal',
    });
    return { code: 0, message: '测试通知已发送给王万全' };
  } catch (e) {
    console.error('[testSend] 发送失败:', e.errMsg || e.message);
    return { code: -1, message: '发送失败: ' + (e.errMsg || e.message) };
  }
}

/* ========== 发送订阅消息（检查用户通知开关，支持多模板） ========== */
// templateId: 不传则默认用定时提醒模板
// skipAuthCheck: true 跳过 notifyEnabled 检查（用于 hookStepCompleted 等实时通知场景）
async function sendSubscribeMsg(openid, data, pageId, templateId, skipAuthCheck) {
  const tmplId = templateId || TMPL_ID;
  if (!skipAuthCheck) {
    try {
      const userRes = await db.collection('users').where({ openid }).get();
      if (userRes.data && userRes.data.length > 0) {
        const u = userRes.data[0];
        if (u.notifyEnabled === false) { console.log('[sendSubscribeMsg] 用户已关闭通知，跳过'); return; }
        if (u.status === 'inactive')    { console.log('[sendSubscribeMsg] 用户已离职，跳过'); return; }
      }
    } catch (e) { /* 查询失败不影响发送 */ }
  }

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: tmplId,
      page: pageId ? `pages/activity-detail/activity-detail?id=${pageId}` : '',
      data,
      miniprogramState: 'formal',
    });
    console.log('[sendSubscribeMsg] 发送成功:', tmplId, openid.slice(-6));
    await incrNotifyCount(openid);
  } catch (e) {
    console.error('[sendSubscribeMsg] 发送失败:', e.errCode, e.errMsg || e.message, 'tmplId:', tmplId);
    await setNotifyError(openid, e.errCode || 0, e.errMsg || e.message || '');
    throw e;  // 上抛给调用方判断是否需要换模板
  }
}

/**
 * 多模板接力发送：授权耗尽时自动换下一模板
 * 返回成功发送的模板 ID，全部失败返回 null
 */
async function sendRobust(openid, tmplDataPairs, pageId) {
  let lastErr = '';
  for (let i = 0; i < tmplDataPairs.length; i++) {
    const [tmplId, data] = tmplDataPairs[i];
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: openid,
        templateId: tmplId,
        page: pageId ? `pages/activity-detail/activity-detail?id=${pageId}` : '',
        data,
        miniprogramState: 'formal',
      });
      console.log('[sendRobust] 发送成功:', tmplId, openid.slice(-6));
      await incrNotifyCount(openid);
      return tmplId;
    } catch (e) {
      lastErr = `[${e.errCode}] ${e.errMsg || e.message || ''}`;
      if (e.errCode === 43101) {
        console.log('[sendRobust] 模板', tmplId, '已用完，尝试下一个');
        continue;
      }
      console.error('[sendRobust] 发送失败:', e.errCode, e.errMsg, 'tmplId:', tmplId);
      await setNotifyError(openid, e.errCode || 0, e.errMsg || e.message || '');
      return null;
    }
  }
  console.warn('[sendRobust] 所有模板已用完');
  await setNotifyError(openid, 43101, lastErr || '所有模板授权已用完');
  return null;
}

/* ========== 通知状态追踪 ========== */
async function incrNotifyCount(openid) {
  try {
    await db.collection('users').where({ openid }).update({
      data: { notifySentCount: db.command.inc(1), notifyLastError: '' }
    });
  } catch (e) { /* 非致命 */ }
}
async function setNotifyError(openid, code, msg) {
  try {
    await db.collection('users').where({ openid }).update({
      data: { notifyLastError: `${new Date().toISOString().slice(0,16).replace('T',' ')} [${code}] ${msg}`.slice(0, 200) }
    });
  } catch (e) { /* 非致命 */ }
}

/* ========== 查找部门主管（交集逻辑） ========== */
/**
 * 部门主管 = 同时满足：
 * ① 属于该部门（users.department === departmentName）
 * ② 属于「部门主管」权限组（users.permissionGroupId 指向该组）
 */
async function findDepartmentSupervisors(departmentName) {
  // 查找该部门的所有用户
  const deptUsers = await db.collection('users')
    .where({ department: departmentName })
    .field({ _id: true, openid: true, name: true, permissionGroupId: true, permissions: true, role: true })
    .get();

  if (!deptUsers.data || deptUsers.data.length === 0) return [];

  // 找到「部门主管」权限组
  const supervisorGroup = await db.collection('permission_groups')
    .where({ name: '部门主管' })
    .limit(1)
    .get();

  const supervisorGroupId = supervisorGroup.data && supervisorGroup.data[0] ? supervisorGroup.data[0]._id : null;

  // 主管判断：属于部门主管权限组 || 拥有管理类权限 || admin
  const mgmtPerms = ['manage_users', 'manage_departments', 'assign_process_owner', 'send_notification'];
  const supervisors = deptUsers.data.filter(u => {
    // 通过权限组ID匹配
    if (supervisorGroupId && u.permissionGroupId === supervisorGroupId) return true;
    // 通过权限列表匹配
    const perms = u.permissions || [];
    if (perms.some(p => mgmtPerms.includes(p))) return true;
    if (u.role === 'admin') return true;
    return false;
  });

  return supervisors.map(s => ({ _id: s._id, openid: s.openid, name: s.name }));
}

/* ========== 记录通知日志 ========== */
async function recordNotification(activityId, userId, userName, message) {
  try {
    await db.collection('notifications').add({
      data: {
        activityId,
        userId,
        userName,
        message,
        isRead: false,
        createdAt: new Date(),
      }
    });
  } catch (e) {
    console.error('[recordNotification] 写入失败', e);
  }
}
