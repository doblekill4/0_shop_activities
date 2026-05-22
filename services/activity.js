// services/activity.js - 活动相关服务层（云开发版）
const { callCloudFunc, uploadFile } = require('../utils/request');

/**
 * 获取活动列表（默认显示所有状态，让云函数做权限过滤）
 */
const getActivityList = (params = {}) => {
  return callCloudFunc('activities', {
    action: 'list',
    // 不默认传 status，让云函数根据权限返回数据
    sort: 'date_asc,first_step_asc',
    ...params,
  });
};

/**
 * 获取活动详情（含修订日志、环节状态、凭证信息）
 */
const getActivityDetail = (id) => {
  return callCloudFunc('activities', { action: 'detail', id });
};

/**
 * 新建活动（草稿或直接提交）
 * @param {object} data - 活动信息
 */
const createActivity = (data) => {
  return callCloudFunc('activities', { action: 'create', data });
};

/**
 * 更新活动（自动生成修订记录）
 * @param {string} id   - 活动 ID
 * @param {object} data - 变更字段
 */
const updateActivity = (id, data) => {
  return callCloudFunc('activities', { action: 'update', id, data });
};

/**
 * 删除活动（仅管理员）
 */
const deleteActivity = (id) => {
  return callCloudFunc('activities', { action: 'delete', id });
};

/**
 * 获取活动修订日志
 */
const getRevisionLog = (activityId) => {
  return callCloudFunc('activities', { action: 'revisions', activityId });
};

/**
 * 上传凭证到云存储
 * @param {string} activityId - 活动 ID
 * @param {string} type - 'deposit'(订金) | 'settlement'(结算) | 'bill'(账单)
 * @param {string} filePath - 本地临时文件路径
 * @returns {Promise<{fileID: string}>}
 */
const uploadVoucher = (activityId, type, filePath) => {
  // 云存储路径：vouchers/{activityId}/{timestamp}_{random}.{ext}
  const ext = filePath.split('.').pop();
  const cloudPath = `vouchers/${activityId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  return uploadFile(filePath, cloudPath).then(res => {
    // 上传成功后，把 fileID 和 filePath 记录到活动文档里
    return callCloudFunc('activities', {
      action: 'addVoucher',
      activityId,
      type,
      fileID: res.fileID,
      filePath: res.fileID || filePath,  // 传 filePath 用于 mock 模式图片预览
    }).then(() => res);
  });
};

/**
 * 删除凭证（仅上传者 / 管理员）
 * @param {string} activityId - 活动 ID
 * @param {string} fileID     - 要删除的凭证 fileID（与 vouchers 数组里的 fileID 字段匹配）
 */
const deleteVoucher = (activityId, fileID) => {
  return callCloudFunc('activities', { action: 'deleteVoucher', activityId, fileID });
};

/**
 * 获取甘特图数据（按日期范围）
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate   - 'YYYY-MM-DD'
 */
const getGanttData = (startDate, endDate, includePending = false) => {
  return callCloudFunc('activities', { action: 'gantt', startDate, endDate, includePending });
};

/**
 * 导出活动数据（云函数生成，返回下载链接）
 * @param {string} format - 'text' | 'excel'
 * @param {Array}  ids    - 要导出的活动 ID 数组
 */
const exportActivities = (format, ids) => {
  return callCloudFunc('activities', { action: 'export', format, ids });
};

module.exports = {
  getActivityList,
  getActivityDetail,
  createActivity,
  updateActivity,
  deleteActivity,
  getRevisionLog,
  uploadVoucher,
  deleteVoucher,
  getGanttData,
  exportActivities,
};
