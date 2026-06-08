// utils/format.js - date/time/format utilities

/**
 * Format timestamp to display string
 * @param {number|string} ts - timestamp ms or ISO string
 * @param {boolean} showTime - whether to show time
 */
const formatDate = (ts, showTime = false) => {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (showTime) {
    return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return date;
};

/**
 * Format time range
 * @param {string} startTime - "HH:MM"
 * @param {string} endTime   - "HH:MM"
 */
const formatTimeRange = (startTime, endTime) => {
  if (!startTime) return '';
  if (!endTime) return startTime;
  return `${startTime}-${endTime}`;
};

/**
 * Calculate days difference between two dates
 */
const daysDiff = (dateA, dateB) => {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.ceil((b - a) / (1000 * 60 * 60 * 24));
};

/**
 * Convert time string "HH:MM" to minutes (for Gantt chart positioning)
 */
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  return h * 60 + m;
};

/**
 * Field name → Chinese label mapping (for revision log display)
 */
const FIELD_LABEL_MAP = {
  activityDate:    '活动日期',
  arrivalTime:     '到店时间',
  activityUnit:    '活动单位',
  venue:           '活动地点',
  peopleCount:     '活动人数',
  businessType:    '业务体现',
  venueUsage:      '场地使用',
  settlementMethod:'结算方式',
  totalCost:       '费用合计',
  contactPerson:   '活动对接人',
  bookingPerson:   '活动预订人',
  invoiceNeeds:    '发票需求',
  sachetAccount:  '香囊账户',
  clientInfo:      '客户信息',
  venueNeeds:      '场地需求',
  steps:           '活动流程环节',
  status:          '活动状态',
};

/**
 * Generate human-readable revision summary
 * @param {Array} changes - [{field, old, new}]
 */
const buildRevisionSummary = (changes) => {
  if (!Array.isArray(changes) || !changes.length) return '无变更';
  return changes.map(c => {
    const label = FIELD_LABEL_MAP[c.field] || c.field;
    const oldStr = c.old !== undefined && c.old !== null ? String(c.old) : '—';
    const newStr = c.new !== undefined && c.new !== null ? String(c.new) : '—';
    return `【${label}】${oldStr} → ${newStr}`;
  }).join('；');
};

/**
 * Truncate long text
 */
const truncate = (str, maxLen = 20) => {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
};

/**
 * Activity status text mapping
 */
const ACTIVITY_STATUS_LABEL = {
  draft:     '草稿',
  pending:   '待确认',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消',
  settled:   '已结算',
};

const getStatusLabel = (status) => ACTIVITY_STATUS_LABEL[status] || status;

module.exports = {
  formatDate,
  formatTimeRange,
  daysDiff,
  timeToMinutes,
  buildRevisionSummary,
  truncate,
  getStatusLabel,
  ACTIVITY_STATUS_LABEL,
};
