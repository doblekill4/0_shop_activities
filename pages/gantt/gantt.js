// pages/gantt/gantt.js
const { getGanttData } = require('../../services/activity');
const { formatDate } = require('../../utils/format');
const { getCurrentUser } = require('../../utils/auth');

const HOUR_START = 6;
const HOUR_END = 22;
const TOTAL_HOURS = HOUR_END - HOUR_START + 1;
const PX_PER_HOUR = 200; // 加大至 200，让活动条更宽更清晰

// 环节颜色方案（浅底 + 深边框），同一活动内不同环节自动区分
const STEP_COLORS = [
  { bg: '#E3F2FD', border: '#1565C0', text: '#1565C0' },  // 蓝
  { bg: '#E8F5E9', border: '#2E7D32', text: '#2E7D32' },  // 绿
  { bg: '#FFF3E0', border: '#E65100', text: '#E65100' },  // 橙
  { bg: '#F3E5F5', border: '#6A1B9A', text: '#6A1B9A' },  // 紫
  { bg: '#E0F7FA', border: '#006064', text: '#006064' },  // 青
  { bg: '#FCE4EC', border: '#880E4F', text: '#880E4F' },  // 粉
  { bg: '#FFF8E1', border: '#F57F17', text: '#F57F17' },  // 黄
  { bg: '#ECEFF1', border: '#37474F', text: '#37474F' },  // 灰蓝
];

Page({
  data: {
    activities: [],
    hourSlots: [],
    currentDate: '',
    currentDateLabel: '',
    loading: false,
    includePending: false,
    timeGridWidth: TOTAL_HOURS * PX_PER_HOUR,
    gridRowHeight: 80, // 每行的固定高度（rpx），与 wxss 中 .gantt-row 一致
  },

  onLoad() { this.goToday(); },
  onShow() {
    const user = getCurrentUser();
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.loadGantt();
  },

  goToday() {
    const d = new Date();
    this._setDate(d);
  },

  prevDay() {
    const d = new Date(this.data.currentDate);
    d.setDate(d.getDate() - 1);
    this._setDate(d);
  },

  nextDay() {
    const d = new Date(this.data.currentDate);
    d.setDate(d.getDate() + 1);
    this._setDate(d);
  },

  _setDate(d) {
    const dateStr = formatDate(d.getTime());
    const label = `${d.getMonth()+1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
    this.setData({
      currentDate: dateStr,
      currentDateLabel: label,
      hourSlots: this._genHourSlots(),
    });
    this.loadGantt();
  },

  _genHourSlots() {
    const slots = [];
    for (let h = HOUR_START; h <= HOUR_END; h++) {
      slots.push({ hour: h, label: `${h}:00` });
    }
    return slots;
  },

  async loadGantt() {
    this.setData({ loading: true });
    try {
      const d = this.data.currentDate;
      const res = await getGanttData(d, d, this.data.includePending);
      // callCloudFunc mock 模式已剥掉 {code:0,data} 包装，res 本身就是数组
      // 云函数模式返回 { list, total }，mock 模式直接返回数组
      const list = res.list || res || [];
      const activities = list.map(a => this._buildGanttItem(a));
      this.setData({ activities, loading: false });
    } catch (e) {
      console.error('[gantt] loadGantt error', e);
      this.setData({ loading: false });
    }
  },

  /**
   * 为单个活动内的环节做时间重叠检测，分配车道（lane）
   * 同一车道内的环节时间不重叠；重叠的环节分配到不同车道，实现条形堆叠
   */
  _assignLanes(steps) {
    // 解析开始小时，过滤掉无效时间
    const parsed = steps.map((s, idx) => {
      const parseHour = (t) => {
        if (!t) return null;
        let tp = t;
        if (t.includes('T')) {
          tp = (t.split('T')[1] || '').split('.')[0].split(':').slice(0,2).join(':');
        } else if (t.includes(' ')) {
          tp = (t.split(' ')[1] || '');
        }
        const h = parseInt(tp);
        return (isNaN(h) || h < 0 || h > 23) ? null : h;
      };
      const sH = parseHour(s.startTime);
      const eH = parseHour(s.endTime);
      return {
        ...s,
        idx,
        sH: sH !== null ? Math.max(sH, HOUR_START) : null,
        eH: sH !== null && eH !== null ? Math.min(Math.max(eH, sH), HOUR_END) : null,
      };
    });

    // 有效时间的放前面，无效的放后面（按索引排）
    const valid = parsed.filter(s => s.sH !== null && s.eH !== null && s.eH > s.sH);
    const invalid = parsed.filter(s => s.sH === null || s.eH === null || s.eH <= s.sH);

    // 按开始时间排序，然后用贪心算法分配车道
    valid.sort((a, b) => a.sH - b.sH || a.eH - b.eH);
    const lanes = []; // lanes[i] = 该车道最晚结束小时
    valid.forEach(s => {
      let placed = false;
      for (let i = 0; i < lanes.length; i++) {
        if (s.sH >= lanes[i]) {
          // 不重叠，放入此车道
          s.lane = i;
          lanes[i] = s.eH;
          placed = true;
          break;
        }
      }
      if (!placed) {
        s.lane = lanes.length;
        lanes.push(s.eH);
      }
    });

    // 无效时间的环节：按原索引依次分配到现有车道（循环复用）
    invalid.forEach(s => {
      s.lane = s.idx % Math.max(lanes.length, 1);
    });

    return { valid, invalid, maxLane: lanes.length };
  },

  _buildGanttItem(a) {
    const steps = a.steps || [];
    const { valid, invalid, maxLane } = this._assignLanes(steps);

    const buildBar = (s, colorIdx) => {
      const c = STEP_COLORS[colorIdx % STEP_COLORS.length];
      const isDone = !!s.completedAt;
      const bgColor   = isDone ? c.border : c.bg;
      const textColor = isDone ? '#ffffff' : c.text;
      const barLeft = (s.sH - HOUR_START) * PX_PER_HOUR;
      const barWidth = Math.max((s.eH - s.sH) * PX_PER_HOUR, PX_PER_HOUR * 0.5);
      const barTop = 4 + (s.lane || 0) * 28;
      return {
        ...s,
        stepName: s.stepName || s.title || `环节${s.idx + 1}`,
        barLeft,
        barWidth,
        barTop,
        bgColor,
        textColor,
        borderColor: c.border,
        isDone,
        completedAtStr: s.completedAt ? formatDate(s.completedAt, true) : '',
        hasValidStart: s.sH !== null,
      };
    };

    const validBars  = valid.map((s, i) => buildBar(s, i));
    const invalidBars = invalid.map((s, i) => {
      const colorIdx = (valid.length + i) % STEP_COLORS.length;
      const c = STEP_COLORS[colorIdx];
      const fallbackLeft = (HOUR_START + s.idx * 1) * PX_PER_HOUR;
      return {
        ...s,
        stepName: s.stepName || s.title || `环节${s.idx + 1}`,
        barLeft: fallbackLeft,
        barWidth: PX_PER_HOUR * 0.8,
        barTop: 4 + ((s.idx % Math.max(maxLane, 1)) * 28),
        bgColor: c.bg,
        textColor: c.text,
        borderColor: c.border,
        isDone: false,
        completedAtStr: '',
        hasValidStart: false,
      };
    });

    const stepsForGantt = [...validBars, ...invalidBars];
    const doneCount = steps.filter(s => s.completedAt).length;

    return {
      ...a,
      id: a._id || a.id,
      activityDateStr: formatDate(a.activityDate),
      progressPct: steps.length ? Math.round((doneCount / steps.length) * 100) : 0,
      allDone:   steps.length > 0 && doneCount === steps.length,
      anyDoing:  doneCount > 0 && doneCount < steps.length,
      stepsForGantt,
      maxLanes: Math.max(maxLane, 1),
    };
  },

  goDetail(e) {
    wx.navigateTo({
      url: `/pages/activity-detail/activity-detail?id=${e.currentTarget.dataset.id}`,
    });
  },

  toggleIncludePending() {
    const next = !this.data.includePending;
    this.setData({ includePending: next });
    this.loadGantt();
  },
});
