// pages/activity-list/activity-list.js
const { getActivityList } = require('../../services/activity');
const { hasPermission } = require('../../utils/auth');
const { formatDate, getStatusLabel } = require('../../utils/format');

const PAGE_SIZE = 20;

Page({
  data: {
    activities: [],
    total: 0,
    hasMore: true,
    loading: false,
    refreshing: false,
    searchKey: '',
    activeFilters: 0,
    filterDate: '',
    filterDateMode: '',  // '' | 'specific' | 'today' | 'todayAndAfter'
    filterDateLabel: '📅 选择日期',  // picker 显示标签
    // 四列选择器：年 / 月 / 日 / 模式
    multiSelectorRange: [[], [], [], []],
    multiSelectorValue: [0, 0, 0, 0],
    filterStatus: '',
    filterStatusLabel: '',
    filterBooker: '',
    canCreate: false,
    showRegister: false,
    timer: null,   // 20秒自动刷新定时器
  },

  onLoad() {
    this._needRefresh = false;
    this._waitForLogin();
  },

  _waitForLogin() {
    const app = getApp();
    if (app.globalData.loginReady) {
      // 登录检测完成，根据结果决定显示内容
      if (!app.globalData.isLoggedIn || !app.globalData.userInfo) {
        wx.reLaunch({ url: '/pages/login/login' });
        return;
      } else {
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        this._initMultiSelector(today);
        this.setData({
          canCreate: hasPermission('create_activity'),
          showRegister: false,
          filterDate: todayStr,
          filterDateMode: 'today',
          filterDateLabel: '今天',
        });
        this.loadActivities(true);
      }
    } else {
      setTimeout(() => this._waitForLogin(), 100);
    }
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.loginReady) return;
    if (!app.globalData.isLoggedIn && !wx.getStorageSync('userInfo')) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    // 日历页面跳转过来的日期筛选
    if (app.globalData._calFilterDate) {
      const d = app.globalData._calFilterDate;
      const m = app.globalData._calFilterMode || 'specific';
      app.globalData._calFilterDate = null;
      app.globalData._calFilterMode = null;
      this.setData({
        filterDate: d,
        filterDateMode: m,
        filterDateLabel: d,
      });
      this._needRefresh = true;
    }
    // 从详情/编辑页返回时刷新
    if (this._needRefresh) {
      this._needRefresh = false;
      this.loadActivities(true);
    }
    // 每次进入首页询问订阅授权（每天最多弹一次）
    this._requestNotifyAuth();
  },

  onHide() {
    // 页面隐藏时标记需要刷新，下次 onShow 自动刷新
    this._needRefresh = true;
  },

  onUnload() {
  },

  // 下拉刷新
  async onRefresh() {
    this.setData({ refreshing: true });
    await this.loadActivities(true);
    this.setData({ refreshing: false });
  },

  // 上拉加载更多
  onLoadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    this.loadActivities(false);
  },

  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this._applyFilters(), 300);
  },

  toggleFilter() {
    wx.showActionSheet({
      itemList: ['按状态筛选', '按预订人筛选'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.showActionSheet({
            itemList: ['全部', '待确认', '正式活动', '已结算'],
            success: (sRes) => {
              const map = ['', 'pending', 'confirmed', 'settled'];
              const labels = ['', '待确认', '正式活动', '已结算'];
              this.setData({
                filterStatus: map[sRes.tapIndex] || '',
                filterStatusLabel: labels[sRes.tapIndex] || '',
              });
              this._applyFilters();
            },
          });
        } else if (res.tapIndex === 1) {
          const bookers = [...new Set(this.data.activities.map(a => a.bookingPerson))];
          if (bookers.length === 0) {
            wx.showToast({ title: '暂无数据', icon: 'none' });
            return;
          }
          wx.showActionSheet({
            itemList: ['全部', ...bookers],
            success: (sRes) => {
              const val = sRes.tapIndex === 0 ? '' : bookers[sRes.tapIndex - 1];
              this.setData({ filterBooker: val });
              this._applyFilters();
            },
          });
        }
      },
    });
  },

  // ========== 四列日期选择器（年/月/日/模式） ==========

  _initMultiSelector(todayDate) {
    const now = todayDate || new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate() - 1;

    // 年份范围：当前年 ± 5
    const years = [];
    for (let i = y - 5; i <= y + 5; i++) years.push(String(i));
    const months = Array.from({ length: 12 }, (_, i) => String(i + 1));
    const days = Array.from({ length: 31 }, (_, i) => String(i + 1));
    const modes = ['指定日期', '今天', '今天及之后'];

    this._multiYears = years;
    this._multiMonths = months;
    this._multiDays = days;
    this._multiModes = modes;

    const yearIdx = years.indexOf(String(y));
    this.setData({
      multiSelectorRange: [years, months, days, modes],
      multiSelectorValue: [yearIdx, m, d, 1], // 默认选"当天"
    });
  },

  // 列切换时动态更新日数
  onMultiColumnChange(e) {
    const { column, value } = e.detail;
    const range = this.data.multiSelectorRange.slice();
    const val = this.data.multiSelectorValue.slice();
    val[column] = value;

    if (column === 0 || column === 1) {
      // 年或月变了，重新计算当月天数
      const year = parseInt(this._multiYears[val[0]]);
      const month = parseInt(this._multiMonths[val[1]]);
      const maxDay = new Date(year, month, 0).getDate();
      const days = Array.from({ length: maxDay }, (_, i) => String(i + 1));
      this._multiDays = days;
      range[2] = days;
      if (val[2] >= days.length) val[2] = days.length - 1;
    }

    // 年月日滚动后，如果不是今天日期，自动切换第四个滚轴为"指定日期"
    if (column <= 2) {
      const selYear = parseInt(this._multiYears[val[0]]);
      const selMonth = parseInt(this._multiMonths[val[1]]);
      const selDay = parseInt(this._multiDays[val[2]]);
      const today = new Date();
      if (selYear !== today.getFullYear() || selMonth !== today.getMonth() + 1 || selDay !== today.getDate()) {
        val[3] = 0; // "指定日期"
      }
    }

    this.setData({ multiSelectorRange: range, multiSelectorValue: val });
  },

  // 选择确认
  onMultiDateChange(e) {
    const val = e.detail.value;
    const year = this._multiYears[val[0]];
    const month = this._multiMonths[val[1]];
    const day = this._multiDays[val[2]];
    const mode = this._multiModes[val[3]];
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    let modeVal, label;
    if (mode === '今天') {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      modeVal = 'today';
      label = '今天';
      this.setData({ filterDate: todayStr, filterDateMode: modeVal, filterDateLabel: label });
    } else if (mode === '今天及之后') {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      modeVal = 'todayAndAfter';
      label = '今天及之后';
      this.setData({ filterDate: todayStr, filterDateMode: modeVal, filterDateLabel: label });
    } else {
      modeVal = 'specific';
      label = dateStr;
      this.setData({ filterDate: dateStr, filterDateMode: modeVal, filterDateLabel: dateStr });
    }

    // 日期筛选需重新从云函数拉数据，不能只做内存过滤
    this.loadActivities(true);
  },

  clearDateFilter() {
    this.setData({ filterDate: '', filterDateMode: '', filterDateLabel: '📅 选择日期' });
    const now = new Date();
    this._initMultiSelector(now);
    this.loadActivities(true);
  },

  clearStatusFilter() {
    this.setData({ filterStatus: '', filterStatusLabel: '' });
    this._applyFilters();
  },

  clearBookerFilter() {
    this.setData({ filterBooker: '' });
    this._applyFilters();
  },

  clearAllFilters() {
    const now = new Date();
    this._initMultiSelector(now);
    this.setData({
      filterDate: '', filterDateMode: '', filterDateLabel: '📅 选择日期',
      filterStatus: '', filterStatusLabel: '', filterBooker: '',
    });
    this._applyFilters();
  },

  // 计算当前活跃筛选数（用于角标显示）
  _calcActiveFilters() {
    let n = 0;
    if (this.data.filterDateMode) n++;
    if (this.data.filterStatus) n++;
    if (this.data.filterBooker) n++;
    return n;
  },

  // 对 this._allActivities 应用筛选，更新活动列表
  // silent=true 时只返回结果，不调用 setData（供 _silentRefresh 使用）
  _applyFilters(silent = false) {
    const all = this._allActivities || [];
    let filtered = [...all];

    // 搜索关键词：匹配单位名称和预订人
    if (this.data.searchKey) {
      const kw = this.data.searchKey.toLowerCase();
      filtered = filtered.filter(a =>
        (a.activityUnit && a.activityUnit.toLowerCase().includes(kw)) ||
        (a.bookingPerson && a.bookingPerson.toLowerCase().includes(kw))
      );
    }

    // 日期筛选已在云函数层处理，此处仅保留状态和预订人筛选
    if (this.data.filterStatus) {
      filtered = filtered.filter(a => a.status === this.data.filterStatus);
    }
    if (this.data.filterBooker) {
      filtered = filtered.filter(a => a.bookingPerson === this.data.filterBooker);
    }
    const n = this._calcActiveFilters();
    if (silent) {
      return { filtered, activeFilters: n };
    }
    this.setData({ activities: filtered, activeFilters: n });
  },

  async loadActivities(reset = false) {
    if (this.data.loading) return;
    this._refreshing = true;
    this.setData({ loading: true });

    try {
      const raw = await getActivityList({
        page: 1,
        pageSize: PAGE_SIZE,
        filterDate: this.data.filterDate,
        filterDateMode: this.data.filterDateMode,
        filterStatus: this.data.filterStatus,
      });

      // 兼容多种返回格式：
      // 1. mock 模式：raw 是数组
      // 2. 云函数模式：raw = { list, total }（callCloudFunc 剥掉了外层，返回 result.data）
      let list, total;
      if (Array.isArray(raw)) {
        list = raw;
        total = raw.length;
      } else if (raw && Array.isArray(raw.list)) {
        list = raw.list;
        total = raw.total || raw.list.length;
      } else if (raw && Array.isArray(raw.data)) {
        list = raw.data;
        total = raw.total || raw.data.length;
      } else {
        list = [];
        total = 0;
      }

      const cleanList = list.filter(a => !String(a._id).startsWith('_system_') && !String(a._id).startsWith('_limit_'));
      const formatted = cleanList.map(a => this._formatItem(a));

      // 统一为全量替换（避免与 _silentRefresh 冲突）
      this._allActivities = formatted;

      this.setData({
        total,
        hasMore: formatted.length < total,
        loading: false,
      });

      // 应用筛选
      this._applyFilters();
    } catch (e) {
      this.setData({ loading: false });
    }
    this._refreshing = false;
  },

  _formatItem(a) {
    // 兼容 activityDate 和 date 两种字段名
    const dateVal = a.activityDate || a.date || '';
    const ts = dateVal ? new Date(dateVal) : null;
    const validDate = ts && !isNaN(ts.getTime());
    if (!validDate) {
      console.warn('[formatItem] 无效日期:', dateVal, 'activity:', a);
    }
    const statusMap = {
      confirmed: 'tag-active',
      completed: 'tag-completed',
      pending:   'tag-pending',
      settled:   'tag-settled',
    };
    const rawSteps = a.steps || [];
    // 每个环节独立显示完成状态（绿=已完成，橙=未完成）
    const steps = rawSteps.map(s => ({
      id: s._id || s.id || s.tempId,
      stepName: s.stepName || '',
      startTime: s.startTime || '',
      endTime: s.endTime || '',
      venue: s.venue || '',
      status: s.completedAt ? 'done' : 'doing',
    }));
    // 从 vouchers 数组计算三个凭证的上传状态
    const voucherMap = {};
    (a.vouchers || []).forEach(v => { voucherMap[v.type] = true; });
    return {
      ...a,
      id: a._id || a.id,  // wx:key 唯一标识
      activityMonth: validDate ? `${ts.getMonth() + 1}月` : '—',
      activityDay: validDate ? `${ts.getDate()}日` : '—',
      activityDate: validDate ? formatDate(dateVal) : (dateVal || '—'),
      arrivalTime: a.arrivalTime || '',
      statusLabel: getStatusLabel(a.status),
      statusClass: statusMap[a.status] || 'tag-pending',
      steps,
      depositVoucher:    !!voucherMap['deposit'],
      billVoucher:      !!voucherMap['bill'],
      settlementVoucher: !!voucherMap['settlement'],
    };
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/activity-detail/activity-detail?id=${id}` });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/activity-create/activity-create' });
  },

  // 每次进入首页询问订阅授权（每天最多弹一次）
  _requestNotifyAuth() {
    const today = `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`;
    const lastAsk = wx.getStorageSync('notify_auth_last_ask');
    if (lastAsk === today) return; // 今天已问过

    const tmplIds = [
      'XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70',
      'gw8f84WumXoZkBDaMErZ7YVDTna9P8jwosJf0bURSSg',
      'vRCdbLk5V3L1OpnyPm7M5oOUWIBJIZh7jnNi6SFRfwA',
    ];

    // 延迟 800ms 弹窗，避免和页面渲染动画冲突
    setTimeout(() => {
      wx.requestSubscribeMessage({
        tmplIds,
        success: (res) => {
          const accepted = tmplIds.filter(id => res[id] === 'accept');
          if (accepted.length > 0) {
            // 更新数据库通知开关
            wx.cloud.callFunction({
              name: 'auth',
              data: { action: 'setNotifyEnabled', enabled: true },
            }).catch(() => {});
          }
          wx.setStorageSync('notify_auth_last_ask', today);
        },
        fail: () => {
          wx.setStorageSync('notify_auth_last_ask', today);
        },
        complete: () => {
          // 首次拒绝后提示
          if (!wx.getStorageSync('notify_auth_tip_shown')) {
            wx.setStorageSync('notify_auth_tip_shown', true);
            setTimeout(() => {
              wx.showToast({ title: '可在"我的"页面重新开启通知', icon: 'none', duration: 2500 });
            }, 1000);
          }
        },
      });
    }, 800);
  },

  onRegisterSuccess(e) {
    this.setData({ showRegister: false });
    this.setData({ canCreate: hasPermission('create_activity') });
    this.loadActivities(true);
  },
});
