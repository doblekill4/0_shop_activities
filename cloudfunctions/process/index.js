// cloudfunctions/process/index.js - 流程环节管理云函数
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    switch (event.action) {
      case 'getSteps':
        return await getSteps(event, openid);
      case 'addStep':
        return await addStep(event, openid);
      case 'updateStep':
        return await updateStep(event, openid);
      case 'deleteStep':
        return await deleteStep(event, openid);
      case 'confirmStep':
        return await confirmStep(event, openid);
      case 'undoConfirmStep':
        return await undoConfirmStep(event, openid);
      case 'assignOwner':
        return await assignOwner(event, openid);
      default:
        return { code: -1, message: '未知操作' };
    }
  } catch (e) {
    console.error('[process] error', e);
    return { code: -1, message: e.message || '服务异常' };
  }
};

/* ========== 获取流程环节列表 ========== */
async function getSteps(event, openid) {
  const { activityId } = event;
  const res = await db.collection('activities').doc(activityId).get();
  if (!res.data) return { code: 404, message: '活动不存在' };

  const steps = res.data.steps || [];
  // 按 sort 排序
  steps.sort((a, b) => (a.sort || 0) - (b.sort || 0));

  return { code: 0, data: steps, message: 'success' };
}

/* ========== 添加环节 ========== */
async function addStep(event, openid) {
  const { activityId, data } = event;
  const userInfo = await getUserInfo(openid);

  const newStep = {
    _id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    stepName: data.stepName,
    startTime: data.startTime,
    endTime: data.endTime,
    ownerId: data.ownerId || '',
    ownerName: data.ownerName || '',
    sort: data.sort || 0,
    status: 'pending',  // pending | in_progress | completed
    completedAt: null,
    createdAt: new Date(),
  };

  await db.collection('activities').doc(activityId).update({
    data: {
      steps: db.command.push(newStep),
      updatedAt: new Date(),
    }
  });

  // 记录修订
  await addRevisionLog(activityId, openid, userInfo.name, 'addStep', { stepName: newStep.stepName });

  return { code: 0, data: newStep, message: '环节添加成功' };
}

/* ========== 更新环节 ========== */
async function updateStep(event, openid) {
  const { activityId, stepId, data } = event;
  const userInfo = await getUserInfo(openid);

  const res = await db.collection('activities').doc(activityId).get();
  if (!res.data) return { code: 404, message: '活动不存在' };

  const steps = res.data.steps || [];
  const idx = findStepIndex(steps, stepId);
  if (idx === -1) return { code: 404, message: '环节不存在' };

  // 修复旧数据：确保有 _id
  ensureStepId(steps[idx]);

  // 更新字段
  Object.keys(data).forEach(key => {
    if (key !== '_id') {
      steps[idx][key] = data[key];
    }
  });
  steps[idx].updatedAt = new Date();

  await db.collection('activities').doc(activityId).update({
    data: {
      steps: steps,
      updatedAt: new Date(),
    }
  });
 
  // 记录修订
  await addRevisionLog(activityId, openid, userInfo.name, 'updateStep', { stepName: steps[idx].stepName });

  return { code: 0, data: steps[idx], message: '环节更新成功' };
}

/* ========== 删除环节 ========== */
async function deleteStep(event, openid) {
  const { activityId, stepId } = event;
  const userInfo = await getUserInfo(openid);

  const res = await db.collection('activities').doc(activityId).get();
  if (!res.data) return { code: 404, message: '活动不存在' };

  const steps = res.data.steps || [];
  const idx = findStepIndex(steps, stepId);
  if (idx === -1) return { code: 404, message: '环节不存在' };
  const stepName = steps[idx].stepName;
  const newSteps = steps.filter((s, i) => i !== idx);

  await db.collection('activities').doc(activityId).update({
    data: {
      steps: newSteps,
      updatedAt: new Date(),
    }
  });

  // 记录修订
  await addRevisionLog(activityId, openid, userInfo.name, 'deleteStep', { stepName: stepName });

  return { code: 0, message: '环节删除成功' };
}

/* ========== 确认环节完成 ========== */
async function confirmStep(event, openid) {
  const { activityId, stepId, completedAt } = event;
  const userInfo = await getUserInfo(openid);

  const res = await db.collection('activities').doc(activityId).get();
  if (!res.data) return { code: 404, message: '活动不存在' };

  const steps = res.data.steps || [];
  const idx = findStepIndex(steps, stepId);
  if (idx === -1) return { code: 404, message: '环节不存在' };

  // 修复旧数据：确保有 _id
  ensureStepId(steps[idx]);

  // 检查是否是负责人
  if (steps[idx].ownerId !== openid && userInfo.role !== 'admin') {
    return { code: 403, message: '只有环节负责人可以确认完成' };
  }

  steps[idx].status = 'completed';
  steps[idx].completedAt = completedAt || new Date();
  steps[idx].updatedAt = new Date();

  await db.collection('activities').doc(activityId).update({
    data: {
      steps: steps,
      updatedAt: new Date(),
    }
  });
 
  // 记录修订
  await addRevisionLog(activityId, openid, userInfo.name, 'confirmStep', { stepName: steps[idx].stepName });

  // 钩子：检查是否有「上一流程结束后通知下一环节负责人」规则
  try {
    await cloud.callFunction({
      name: 'notifications',
      data: { action: 'hookStepCompleted', activityId, stepIndex: idx },
    });
  } catch (e) {
    console.warn('[confirmStep] 通知钩子调用失败（非致命）', e.message);
  }

  return { code: 0, message: '环节已确认完成' };
}

/* ========== 撤销环节完成 ========== */
async function undoConfirmStep(event, openid) {
  const { activityId, stepId } = event;
  const userInfo = await getUserInfo(openid);

  const res = await db.collection('activities').doc(activityId).get();
  if (!res.data) return { code: 404, message: '活动不存在' };

  const steps = res.data.steps || [];
  const idx = findStepIndex(steps, stepId);
  if (idx === -1) return { code: 404, message: '环节不存在' };

  // 修复旧数据：确保有 _id
  ensureStepId(steps[idx]);

  // 权限：只有负责人或管理员可以撤销
  if (steps[idx].ownerId !== openid && userInfo.role !== 'admin') {
    return { code: 403, message: '只有环节负责人可以撤销完成' };
  }

  // 还原为未完成状态
  steps[idx].status = 'pending';
  steps[idx].completedAt = null;
  steps[idx].updatedAt = new Date();

  await db.collection('activities').doc(activityId).update({
    data: {
      steps: steps,
      updatedAt: new Date(),
    }
  });

  // 记录修订
  await addRevisionLog(activityId, openid, userInfo.name, 'undoConfirmStep', { stepName: steps[idx].stepName });

  return { code: 0, message: '环节完成已撤销' };
}

/* ========== 指派环节负责人 ========== */
async function assignOwner(event, openid) {
  const { activityId, stepId, userId } = event;
  const userInfo = await getUserInfo(openid);

  // 获取新负责人信息
  const userRes = await db.collection('users').doc(userId).get();
  const newOwner = userRes.data;

  const res = await db.collection('activities').doc(activityId).get();
  if (!res.data) return { code: 404, message: '活动不存在' };

  const steps = res.data.steps || [];
  const idx = findStepIndex(steps, stepId);
  if (idx === -1) return { code: 404, message: '环节不存在' };

  // 修复旧数据：确保有 _id
  ensureStepId(steps[idx]);

  steps[idx].ownerId = userId;
  steps[idx].ownerName = newOwner ? newOwner.name : '';
  steps[idx].updatedAt = new Date();

  await db.collection('activities').doc(activityId).update({
    data: {
      steps: steps,
      updatedAt: new Date(),
    }
  });
 
  // 记录修订
  await addRevisionLog(activityId, openid, userInfo.name, 'assignOwner', {
    stepName: steps[idx].stepName,
    ownerName: newOwner ? newOwner.name : '',
  });

  return { code: 0, message: '负责人已指派' };
}

/* ========== 工具函数 ========== */
async function getUserInfo(openid) {
  const res = await db.collection('users').where({ openid }).get();
  return res.data[0] || { role: 'user', name: '未知用户' };
}

/**
 * 查找环节索引：兼容旧数据（无 _id）和旧格式字段
 * 优先级：_id > id > tempId
 */
function findStepIndex(steps, stepId) {
  // 1) 精确匹配 _id
  let idx = steps.findIndex(s => s._id === stepId);
  if (idx !== -1) return idx;
  // 2) 兼容旧数据：匹配 id 或 tempId
  idx = steps.findIndex(s => s.id === stepId || String(s.tempId) === String(stepId));
  return idx;
}

/**
 * 确保环节有 _id，没有则生成并返回
 */
function ensureStepId(step) {
  if (!step._id) {
    step._id = 'step_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
  }
  return step;
}

async function addRevisionLog(activityId, openid, userName, action, detail) {
  const revision = {
    action,
    updatedBy: openid,
    updatedByName: userName,
    updatedAt: new Date(),
    detail,
  };

  try {
    await db.collection('activities').doc(activityId).update({
      data: {
        revisionLog: db.command.push(revision),
      }
    });
  } catch (e) {
    console.error('addRevisionLog error', e);
  }
}
