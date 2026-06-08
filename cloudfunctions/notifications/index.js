// cloudfunctions/notifications/index.js - 通知功能云函数
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 订阅消息模板 ID
const TMPL_ID = 'XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70';

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
    openid: user.openid,
    activityId,
    activityUnit: actRes.data.activityUnit || '',
    message,
    isRead: false,
    createdAt: new Date(),
  }));

  if (notifications.length > 0) {
    // 批量插入通知记录
    for (const n of notifications) {
      await db.collection('notifications').add({ data: n });
    }
  }

  return { code: 0, data: { sentCount: notifications.length }, message: '通知已发送' };
}

/* ========== 配置提醒规则 ========== */
async function configureReminders(event, openid) {
  const { activityId, rules } = event;

  if (activityId === 'global') {
    // 全局规则存到 activities 集合的特殊文档中（_system_global_rules）
    try {
      await db.collection('activities').doc('_system_global_rules').set({
        data: { key: 'global_reminder_rules', value: rules, updatedAt: new Date() }
      });
    } catch (e) {
      // set 失败（文档已存在），改用 update
      await db.collection('activities').doc('_system_global_rules').update({
        data: { value: rules, updatedAt: new Date() }
      });
    }
    return { code: 0, message: '全局规则已更新' };
  }

  // 活动级规则存到活动文档
  await db.collection('activities').doc(activityId).update({
    data: { reminderRules: rules, updatedAt: new Date() }
  });
  return { code: 0, message: '提醒规则已更新' };
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

/* ========== 环节完成后通知下一环节负责人 ========== */
async function hookStepCompleted(event, openid) {
  const { activityId, stepIndex } = event;
  const actRes = await db.collection('activities').doc(activityId).get();
  if (!actRes.data) return { code: 0, message: '活动不存在，跳过' };

  const steps = actRes.data.steps || [];

  // 合并全局规则 + 活动级规则
  let rules = actRes.data.reminderRules || [];
  try {
    const gRes = await db.collection('activities').doc('_system_global_rules').get();
    if (gRes.data && gRes.data.value) {
      rules = [...(gRes.data.value || []), ...rules];
    }
  } catch (e) { /* 忽略 */ }

  // 1) 下一环节通知（timingIndex === 3）
  const hasNextStep = rules.some(r => r.timingIndex === 3);
  if (hasNextStep) {
    const nextStep = steps[stepIndex + 1];
    if (nextStep && nextStep.ownerId) {
      const userRes = await db.collection('users').doc(nextStep.ownerId).get().catch(() => null);
      if (userRes && userRes.data && userRes.data.openid) {
        await sendSubscribeMsg(userRes.data.openid, {
          thing1: { value: steps[stepIndex].stepName || '上一环节' },
          thing2: { value: nextStep.stepName || '下一环节' },
          thing3: { value: actRes.data.activityUnit || '' },
          time4: { value: nextStep.startTime || '' },
          thing5: { value: '上一环节已完成，请准备' },
        }, actRes.data._id);
        await recordNotification(activityId, nextStep.ownerId, userRes.data.name,
          `上一环节「${steps[stepIndex].stepName}」已完成→「${nextStep.stepName}」`);
      }
    }
  }

  // 2) 每一流程结束后通知指定部门（timingIndex === 4）
  const deptRules = rules.filter(r => r.timingIndex === 4);
  for (const rule of deptRules) {
    const doneStep = steps[stepIndex];
    const targets = rule.targets || [];
    for (const t of targets) {
      const uRes = await db.collection('users').where({ name: t.name }).get().catch(() => ({ data: [] }));
      if (uRes.data && uRes.data[0] && uRes.data[0].openid) {
        await sendSubscribeMsg(uRes.data[0].openid, {
          thing1: { value: actRes.data.activityUnit || '' },
          thing2: { value: (doneStep && doneStep.stepName) || '环节' },
          thing3: { value: actRes.data.venue || '' },
          time4: { value: actRes.data.arrivalTime || '' },
          thing5: { value: '请检查并安排清洁' },
        }, actRes.data._id);
        await recordNotification(activityId, uRes.data[0]._id, t.name,
          `活动「${actRes.data.activityUnit}」环节「${(doneStep && doneStep.stepName) || ''}」完成→请清洁`);
      }
    }
  }

  return { code: 0, message: '通知检查完成' };
}

/* ========== 用户缓存（批量查，避免 N+1） ========== */
let _userCache = null;
let _userCacheTime = 0;
async function getUserCache() {
  if (_userCache && Date.now() - _userCacheTime < 60000) return _userCache;
  const res = await db.collection('users').limit(200).get();
  _userCache = {};
  (res.data || []).forEach(u => {
    if (u.name) _userCache[u.name] = u;
    if (u._id) _userCache[u._id] = u;
  });
  _userCacheTime = Date.now();
  return _userCache;
}

/* ========== 定时扫描并发送提醒（由定时触发器调用） ========== */
async function scanAndNotify() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // 预加载用户缓存
  const userCache = await getUserCache();

  // 加载全局提醒规则
  let globalRules = [];
  try {
    const gRes = await db.collection('activities').doc('_system_global_rules').get();
    if (gRes.data && gRes.data.value) globalRules = gRes.data.value || [];
  } catch (e) { /* 忽略 */ }

  // 获取今天有活动级提醒规则的活动（排除草稿）
  const res = await db.collection('activities')
    .where({
      activityDate: todayStr,
      status: _.neq('draft'),
    })
    .get();

  let sentCount = 0;

  for (const act of res.data) {
    const rules = [...globalRules, ...(act.reminderRules || [])];
    const arrivalTime = act.arrivalTime || '08:00';
    const [aH, aM] = arrivalTime.split(':').map(Number);
    const activityStartMinutes = (aH || 8) * 60 + (aM || 0);
    const steps = act.steps || [];

    for (const rule of rules) {
      // 跳过已发送过的通知（用已发送集合去重）
      const sentKey = `sent_${act._id}_${rule.id}`;

      if (rule.timingIndex === 0) {
        // 「活动开始前 N 分钟」通知指定人员/群组
        const triggerMin = activityStartMinutes - (rule.minutes || 30);
        if (Math.abs(nowMinutes - triggerMin) <= 5) {
          await sendRuleNotifications(act, rule, sentKey);
          sentCount++;
        }
      } else if (rule.timingIndex === 1) {
        // 「活动结束后 N 分钟」通知指定人员/群组
        // 简化：以当天最后环节结束时间为准，或直接用 activityDate 当天 18:00 作为"结束"
        const endMinutes = 18 * 60; // 默认 18:00 为活动结束时间
        const triggerMin = endMinutes + (rule.minutes || 30);
        if (Math.abs(nowMinutes - triggerMin) <= 5) {
          await sendRuleNotifications(act, rule, sentKey);
          sentCount++;
        }
      } else if (rule.timingIndex === 2) {
        // 「流程开始前 N 分钟」通知该环节负责人
        for (const step of steps) {
          if (!step.startTime || !step.ownerId) continue;
          const [sH, sM] = step.startTime.split(':').map(Number);
          const stepStartMin = (sH || 0) * 60 + (sM || 0);
          const triggerMin = stepStartMin - (rule.minutes || 30);
          const stepSentKey = `${sentKey}_step_${step._id}`;

          if (Math.abs(nowMinutes - triggerMin) <= 5) {
            await sendStepStartNotify(act, step, stepSentKey);
            sentCount++;
          }
        }
      }
    }
  }

  return { code: 0, data: { sentCount }, message: '扫描完成' };
}

/* ========== 发送订阅消息（检查用户通知开关） ========== */
async function sendSubscribeMsg(openid, data, pageId) {
  // 检查用户是否开启了通知
  try {
    const userRes = await db.collection('users').where({ openid }).get();
    if (userRes.data && userRes.data.length > 0 && userRes.data[0].notifyEnabled === false) {
      console.log('[sendSubscribeMsg] 用户已关闭通知，跳过');
      return;
    }
  } catch (e) { /* 查询失败不影响发送 */ }

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: TMPL_ID,
      page: pageId ? `pages/activity-detail/activity-detail?id=${pageId}` : '',
      data,
      miniprogramState: 'developer',
    });
  } catch (e) {
    console.error('[sendSubscribeMsg] 发送失败:', e.errMsg || e.message);
  }
}

/* ========== 按规则通知指定人员/群组 ========== */
async function sendRuleNotifications(act, rule, sentKey) {
  const existing = await db.collection('_sent_notifications').doc(sentKey).get().catch(() => null);
  if (existing && existing.data) return;

  const targets = rule.targets || [];
  const actUnit = act.activityUnit || '';
  const userCache = await getUserCache();

  for (const t of targets) {
    const user = userCache[t.name];
    if (!user || !user.openid) continue;
    const label = rule.timingIndex === 0 ? `${rule.minutes || 30}分钟后开始` : '活动已结束';
    await sendSubscribeMsg(user.openid, {
      thing1: { value: actUnit },
      thing2: { value: label },
      thing3: { value: act.venue || '' },
      time4: { value: act.arrivalTime || act.activityDate || '' },
      thing5: { value: '请及时查看活动详情' },
    }, act._id);
    await recordNotification(act._id, user._id, t.name,
      `活动「${actUnit}」${rule.timingIndex === 0 ? '即将开始' : '已结束'}`);
  }
  await db.collection('_sent_notifications').doc(sentKey).set({ data: { sentAt: new Date() } }).catch(() => {});
}

/* ========== 环节开始前通知负责人 ========== */
async function sendStepStartNotify(act, step, sentKey) {
  const existing = await db.collection('_sent_notifications').doc(sentKey).get().catch(() => null);
  if (existing && existing.data) return;

  const userCache = await getUserCache();
  const user = userCache[step.ownerId];
  if (!user || !user.openid) return;

  await sendSubscribeMsg(user.openid, {
    thing1: { value: step.stepName || '' },
    thing2: { value: '环节即将开始' },
    thing3: { value: act.activityUnit || '' },
    time4: { value: step.startTime || '' },
    thing5: { value: '请及时准备' },
  }, act._id);

  await db.collection('_sent_notifications').doc(sentKey).set({ data: { sentAt: new Date() } }).catch(() => {});
  await recordNotification(act._id, step.ownerId, user.name, `环节「${step.stepName}」即将开始`);
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
