// services/process.js - 活动流程环节服务层（云开发版）
const { callCloudFunc } = require('../utils/request');

/**
 * 获取某活动的流程环节列表
 */
const getProcessSteps = (activityId) => {
  return callCloudFunc('process', { action: 'getSteps', activityId });
};

/**
 * 新增 / 更新流程环节
 * @param {string} activityId
 * @param {object} stepData - { stepName, startTime, endTime, ownerId, sort }
 */
const upsertStep = (activityId, stepData) => {
  if (stepData.id) {
    return callCloudFunc('process', { action: 'updateStep', activityId, stepId: stepData.id, data: stepData });
  }
  return callCloudFunc('process', { action: 'addStep', activityId, data: stepData });
};

/**
 * 删除环节
 */
const deleteStep = (activityId, stepId) => {
  return callCloudFunc('process', { action: 'deleteStep', activityId, stepId });
};

/**
 * 环节负责人确认完成（自动记录完成时间，写入修订日志）
 */
const confirmStepDone = (activityId, stepId) => {
  return callCloudFunc('process', { action: 'confirmStep', activityId, stepId, completedAt: Date.now() });
};

/**
 * 指派环节负责人
 */
const assignStepOwner = (activityId, stepId, userId) => {
  return callCloudFunc('process', { action: 'assignOwner', activityId, stepId, userId });
};

module.exports = {
  getProcessSteps,
  upsertStep,
  deleteStep,
  confirmStepDone,
  assignStepOwner,
};
