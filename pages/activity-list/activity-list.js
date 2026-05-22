// pages/activity-list/activity-list.js
const { getActivityList } = require('../../services/activity');
const { hasPermission } = require('../../utils/auth');
const { formatDate, getStatusLabel } = require('../../utils/format');

const PAGE_SIZE = 20;

Page({
  data: {
    activities: [],
    total: 0,
    page: 1,
    hasMore: true,
    loading: false,
    refreshing: false,
    searchKey: '',
    activeFilters: 0,
    filterDate: '',
    filterStatus: '',
    filterBooker: '',
    canCreate: false,
    showRegister: false,
  },

  onLoad() {
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
        this.setData({
          canCreate: hasPermission('create_activity'),
          showRegister: false,
        });
        this.loadActivities(true);
      }
    } else {
      setTimeout(() => this._waitForLogin(), 100);
    }
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.isLoggedIn || !app.globalData.userInfo) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    // 从详情/编辑页返回时刷新
    if (this._needRefresh) {
      this._needRefresh = false;
      this.loadActivities(true);
    }
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
    this._searchTimer = setTimeout(() => this.loadActivities(true), 400);
  },

  toggleFilter() {
    wx.showActionSheet({
      itemList: ['按日期筛选', '按状态筛选', '按预订人筛选', '清除筛选'],
      success: (res) => {
        if (res.tapIndex === 0) {
          // 日期筛选：从活动列表中提取唯一日期供选择
          const dates = [...new Set((this._allActivities || []).map(a => a.activityDate))].sort();
          if (dates.length === 0) {
            wx.showToast({ title: '暂无数据', icon: 'none' });
            return;
          }
          wx.showActionSheet({
            itemList: ['全部', ...dates],
            success: (sRes) => {
              const val = sRes.tapIndex === 0 ? '' : dates[sRes.tapIndex - 1];
              this.setData({ filterDate: val });
              this._applyFilters();
            },
          });
        } else if (res.tapIndex === 1) {
          // 状态筛选
          wx.showActionSheet({
            itemList: ['全部', '待确认', '正式活动', '已结束'],
            success: (sRes) => {
              const map = ['', 'pending', 'confirmed', 'completed'];
              this.setData({ filterStatus: map[sRes.tapIndex] || '' });
              this._applyFilters();
            },
          });
        } else if (res.tapIndex === 2) {
          // 预订人筛选：从当前列表中提取唯一预订人
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
        } else if (res.tapIndex === 3) {
          // 清除筛选
          this.setData({ filterDate: '', filterStatus: '', filterBooker: '' });
          this._applyFilters();
        }
      },
    });
  },

  // 计算当前活跃筛选数（用于角标显示）
  _calcActiveFilters() {
    let n = 0;
    if (this.data.filterDate) n++;
    if (this.data.filterStatus) n++;
    if (this.data.filterBooker) n++;
    return n;
  },

  // 对 this._allActivities 应用筛选，更新活动列表
  _applyFilters() {
    const all = this._allActivities || [];
    let filtered = [...all];
    if (this.data.filterDate) {
      filtered = filtered.filter(a => a.activityDate === this.data.filterDate);
    }
    if (this.data.filterStatus) {
      filtered = filtered.filter(a => a.status === this.data.filterStatus);
    }
    if (this.data.filterBooker) {
      filtered = filtered.filter(a => a.bookingPerson === this.data.filterBooker);
    }
    const n = this._calcActiveFilters();
    this.setData({ activities: filtered, activeFilters: n });
  },

  async loadActivities(reset = false) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });

    try {
      const raw = await getActivityList({
        page,
        pageSize: PAGE_SIZE,
        keyword: this.data.searchKey,
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

      // 格式化列表项
      if (list.length > 0) {
        console.log('[loadActivities] 第一条数据字段:', Object.keys(list[0]));
        console.log('[loadActivities] 第一条数据详情:');
        const sample = list[0];
        Object.keys(sample).forEach(k => {
          console.log('  ', k, ':', sample[k]);
        });
      }
      const formatted = list.map(a => this._formatItem(a));

      // 存储原始数据（用于筛选）
      let all = reset ? [] : [...(this._allActivities || [])];
      all = [...all, ...formatted];
      this._allActivities = all;

      this.setData({
        total,
        page: page + 1,
        hasMore: all.length < total,
        loading: false,
      });

      // 应用筛选
      this._applyFilters();
    } catch (e) {
      this.setData({ loading: false });
    }
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
      pending: 'tag-pending',
    };
    const steps = (a.steps || []).map(s => ({
      id: s.id,
      status: s.completedAt ? 'done' : 'doing',
    }));
    return {
      ...a,
      activityMonth: validDate ? `${ts.getMonth() + 1}月` : '—',
      activityDay: validDate ? `${ts.getDate()}日` : '—',
      activityDate: validDate ? formatDate(dateVal) : (dateVal || '—'),
      firstStepTime: a.steps && a.steps[0] ? a.steps[0].startTime : '',
      statusLabel: getStatusLabel(a.status),
      statusClass: statusMap[a.status] || 'tag-pending',
      steps,
    };
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    // 兼容 _id 和 id 两种字段名
    const activityId = id || this.data.activities.find(a => a._id === id)?._id;
    wx.navigateTo({ url: `/pages/activity-detail/activity-detail?id=${id}` });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/activity-create/activity-create' });
  },

  onRegisterSuccess(e) {
    this.setData({ showRegister: false });
    this.setData({ canCreate: hasPermission('create_activity') });
    this.loadActivities(true);
  },
});
