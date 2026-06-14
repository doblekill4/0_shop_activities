// pages/gantt/gantt.js
const { getGanttData } = require('../../services/activity');
const { formatDate } = require('../../utils/format');
const { getCurrentUser } = require('../../utils/auth');

const DEFAULT_HOUR_START = 8;
const HOUR_END = 22;
const PX_PER_HOUR = 300;

const STEP_COLORS = [
  { bg: '#E3F2FD', border: '#1565C0', text: '#1565C0' },
  { bg: '#E8F5E9', border: '#2E7D32', text: '#2E7D32' },
  { bg: '#FFF3E0', border: '#E65100', text: '#E65100' },
  { bg: '#F3E5F5', border: '#6A1B9A', text: '#6A1B9A' },
  { bg: '#E0F7FA', border: '#006064', text: '#006064' },
  { bg: '#FCE4EC', border: '#880E4F', text: '#880E4F' },
  { bg: '#FFF8E1', border: '#F57F17', text: '#F57F17' },
  { bg: '#ECEFF1', border: '#37474F', text: '#37474F' },
];

Page({
  data: {
    activities: [],
    hourSlots: [],
    currentDate: '',
    currentDateLabel: '',
    loading: false,
    includePending: false,
    hourStart: DEFAULT_HOUR_START,
    hourEnd: HOUR_END,
    timeGridWidth: (HOUR_END - DEFAULT_HOUR_START) * PX_PER_HOUR,
    hourCellWidth: PX_PER_HOUR,
    gridRowHeight: 80,
    venueOccupancy: [],
  },

  onLoad() { this._firstShow = true; this.goToday(); },
  onShow() {
    if (this._firstShow) { this._firstShow = false; return; }
    const app = getApp();
    if (!app.globalData.loginReady) return;
    const user = getCurrentUser();
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.loadGantt();
  },

  goToday() { this._setDate(new Date()); },

  onDatePick(e) { this._setDate(new Date(e.detail.value)); },

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
    const label = `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
    this.setData({ currentDate: dateStr, currentDateLabel: label });
    this.loadGantt();
  },

  _genHourSlots(hourStart, hourEnd) {
    const slots = [];
    for (let h = hourStart; h <= hourEnd; h++) {
      slots.push({ hour: h, label: `${h}:00` });
    }
    return slots;
  },

  _calcDynamicHourStart(list) {
    let minHour = DEFAULT_HOUR_START;
    for (const a of (list || [])) {
      if (a.arrivalTime) {
        const h = parseInt(a.arrivalTime.split(':')[0]);
        if (!isNaN(h) && h < minHour) minHour = h;
      }
    }
    if (minHour < DEFAULT_HOUR_START) return Math.max(0, minHour - 1);
    return DEFAULT_HOUR_START;
  },

  async loadGantt() {
    this.setData({ loading: true });
    try {
      const d = this.data.currentDate;
      const [res, occRes] = await Promise.all([
        getGanttData(d, d, this.data.includePending),
        wx.cloud.callFunction({ name: 'activities', data: { action: 'getVenueOccupancy', activityDate: d } }),
      ]);
      const list = res.list || res || [];

      const hourStart = this._calcDynamicHourStart(list);
      const hourEnd = HOUR_END;

      const activities = list.map(a => this._buildGanttItem(a, hourStart, hourEnd));
      const venueOccupancy = this._buildVenueOccupancy(occRes, hourStart);
      this.setData({
        hourStart,
        hourEnd,
        hourSlots: this._genHourSlots(hourStart, hourEnd),
        timeGridWidth: (hourEnd - hourStart) * PX_PER_HOUR,
        hourCellWidth: PX_PER_HOUR,
        activities,
        venueOccupancy,
        loading: false,
      });
    } catch (e) {
      console.error('[gantt] loadGantt error', e);
      this.setData({ loading: false });
    }
  },

  _buildVenueOccupancy(occRes, hourStart) {
    const raw = (occRes && occRes.result && occRes.result.data) || {};
    const venues = [];
    const names = Object.keys(raw).sort((a, b) => a.localeCompare(b, 'zh'));
    for (const name of names) {
      const slots = (raw[name] || []).map(s => ({
        ...s,
        stepName: s.stepName || '',
        activityUnit: s.activityUnit || '',
      }));
      if (slots.length > 0) venues.push({ name, slots });
    }
    return venues;
  },

  _assignLanes(steps, hourStart, hourEnd) {
    const parseDecimalHour = (t) => {
      if (!t) return null;
      let timePart = t;
      if (t.includes('T')) {
        timePart = (t.split('T')[1] || '00:00').split('.')[0];
      } else if (t.includes(' ')) {
        timePart = (t.split(' ')[1] || '00:00');
      }
      const parts = timePart.split(':');
      const h = parseInt(parts[0]);
      const m = parseInt(parts[1]) || 0;
      if (isNaN(h) || h < 0 || h > 23) return null;
      return h + m / 60;
    };

    const parsed = steps.map((s, idx) => {
      let sH = parseDecimalHour(s.startTime);
      let eH = parseDecimalHour(s.endTime);
      // 兜底：结束时间不早于开始时间，最少 5 分钟持续
      if (sH !== null && eH !== null) {
        if (eH <= sH) eH = sH + 0.083; // 5 分钟
        sH = Math.max(sH, hourStart);
        eH = Math.min(eH, hourEnd);
      }
      return {
        ...s,
        idx,
        sH: sH !== null ? sH : null,
        eH: (sH !== null && eH !== null && eH > sH) ? eH : null,
      };
    });

    const valid = parsed.filter(s => s.sH !== null && s.eH !== null && s.eH > s.sH);
    const invalid = parsed.filter(s => s.sH === null || s.eH === null || s.eH <= s.sH);

    valid.sort((a, b) => a.sH - b.sH || a.eH - b.eH);
    const lanes = [];
    valid.forEach(s => {
      let placed = false;
      for (let i = 0; i < lanes.length; i++) {
        if (s.sH >= lanes[i]) {
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

    invalid.forEach(s => {
      s.lane = s.idx % Math.max(lanes.length, 1);
    });

    return { valid, invalid, maxLane: lanes.length };
  },

  _buildGanttItem(a, hourStart, hourEnd) {
    const steps = a.steps || [];
    const { valid, invalid, maxLane } = this._assignLanes(steps, hourStart, hourEnd);

    const buildBar = (s, colorIdx) => {
      const c = STEP_COLORS[colorIdx % STEP_COLORS.length];
      const isDone = !!s.completedAt;
      return {
        ...s,
        stepName: s.venue ? `${s.stepName || `环节${s.idx + 1}`} (${s.venue})` : (s.stepName || `环节${s.idx + 1}`),
        barLeft: (s.sH - hourStart) * PX_PER_HOUR,
        barWidth: Math.max((s.eH - s.sH) * PX_PER_HOUR, 40),
        barTop: 4 + (s.lane || 0) * 56,
        bgColor: isDone ? c.border : c.bg,
        textColor: isDone ? '#fff' : c.text,
        borderColor: c.border,
        isDone,
      };
    };

    const validBars = valid.map((s, i) => buildBar(s, i));
    const invalidBars = invalid.map((s, i) => {
      const c = STEP_COLORS[(valid.length + i) % STEP_COLORS.length];
      return {
        ...s,
        stepName: s.stepName || `环节${s.idx + 1}`,
        barLeft: (hourStart + s.idx * 1) * PX_PER_HOUR,
        barWidth: PX_PER_HOUR * 0.8,
        barTop: 4 + ((s.idx % Math.max(maxLane, 1)) * 56),
        bgColor: c.bg,
        textColor: c.text,
        borderColor: c.border,
        isDone: false,
      };
    });

    const stepsForGantt = [...validBars, ...invalidBars];
    const statusLabels = { pending: '待确认', settled: '已结算' };
    const statusClassMap = { pending: 'tag-pending', settled: 'tag-settled' };

    return {
      ...a,
      id: a._id || a.id,
      peopleCount: a.peopleCount || 0,
      arrivalTime: a.arrivalTime || '',
      statusLabel: statusLabels[a.status] || '',
      statusClass: statusClassMap[a.status] || '',
      showStatusTag: a.status !== 'confirmed' && !!statusLabels[a.status],
      stepsForGantt,
      maxLanes: Math.max(maxLane, 1),
      rowHeight: (() => {
        const laneHeight = Math.max(80, Math.max(maxLane || 1, 1) * 56 + 56);
        // 左侧冻结列文本自适应：160rpx 宽，左右各 12rpx padding，可用 ~136rpx
        const unitLen = (a.activityUnit || '').length;
        const unitLines = Math.max(1, Math.ceil(unitLen * 22 / 136));
        const textHeight = unitLines * 30 + 28 + 24 + 12; // 名称 + 人数 + 时间 + 间距
        return Math.max(laneHeight, textHeight);
      })(),
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
