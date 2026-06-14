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
 * 删除凭证（传 voucherId，与云函数 deleteVoucher 参数名一致）
 * @param {string} activityId - 活动 ID
 * @param {string} voucherId  - 凭证 _id（云函数用它匹配 vouchers 数组）
 */
const deleteVoucher = (activityId, voucherId) => {
  return callCloudFunc('activities', { action: 'deleteVoucher', activityId, voucherId });
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
 * 获取当前用户的草稿
 */
const getMyDraft = () => {
  return callCloudFunc('activities', { action: 'getMyDraft' });
};

/**
 * 导出活动数据（云函数生成，返回下载链接）
 * @param {string} format - 'text' | 'excel'
 * @param {Array}  ids    - 要导出的活动 ID 数组
 */
const exportActivities = (format, ids) => {
  return callCloudFunc('activities', { action: 'export', format, ids });
};

const getMonthlyCounts = (year, month) => {
  return callCloudFunc('activities', { action: 'getMonthlyCounts', year, month });
};

const markCapacityLimit = (date, remove) => {
  return callCloudFunc('activities', { action: 'markCapacityLimit', date, remove });
};

/**
 * 获取云存储文件临时链接（通过云函数管理员权限代理）
 * 解决体验版中非开发者无法直接获取临时链接的问题
 * 内置缓存：临时链接有效 2 小时，缓存 1.5 小时后刷新
 * @param {string[]} fileIDs - 云文件 ID 数组
 * @returns {Promise<Array<{fileID:string, tempFileURL:string}>>}
 */
const _tempUrlCache = {};
const _TEMP_URL_TTL = 90 * 60 * 1000; // 1.5 小时

const getFileTempURL = async (fileIDs) => {
  const now = Date.now();
  const uncached = [];  // 需要从云函数获取的 fileID
  const cached = [];    // 命中的缓存结果

  for (const fid of fileIDs) {
    const entry = _tempUrlCache[fid];
    if (entry && entry.tempFileURL && now < entry.expiresAt) {
      cached.push({ fileID: fid, tempFileURL: entry.tempFileURL, status: 0 });
    } else {
      uncached.push(fid);
    }
  }

  // 全部命中缓存，直接返回
  if (uncached.length === 0) return cached;

  // 部分或全部未命中，调用云函数
  const result = await callCloudFunc('activities', { action: 'getFileTempURL', fileIDs: uncached });
  const fileList = Array.isArray(result) ? result : (result && result.data) || [];

  // 更新缓存
  fileList.forEach(item => {
    if (item.tempFileURL && item.status === 0) {
      _tempUrlCache[item.fileID] = { tempFileURL: item.tempFileURL, expiresAt: now + _TEMP_URL_TTL };
    }
  });

  return [...cached, ...fileList];
};

module.exports = {
  getActivityList,
  getActivityDetail,
  createActivity,
  updateActivity,
  getMyDraft,
  deleteActivity,
  getRevisionLog,
  uploadVoucher,
  deleteVoucher,
  getGanttData,
  exportActivities,
  getMonthlyCounts,
  markCapacityLimit,
  getFileTempURL,
};
