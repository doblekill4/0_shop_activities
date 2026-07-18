// pages/activity-create/activity-create.js
const { createActivity, updateActivity, getMyDraft, getMonthlyCounts } = require('../../services/activity');
const { getUsers } = require('../../services/admin');
const { getCurrentUser } = require('../../utils/auth');
const { requestSubscription } = require('../../services/notification');
const { VENUE_LIST, SUBSCRIBE_TMPL_IDS, matchStepVenue } = require('../../utils/constants');

// 默认表单结构
const DEFAULT_FORM = () => ({
  activityDate: '',
  arrivalTime: '09:00',
  activityUnit: '',
  venue: '',
  peopleCount: '',
  businessType: '',
  venueUsage: '',
  steps: [],
  settlementMethod: '',
  totalCost: '',
  contactPerson: '',
  bookingPerson: '',
  clientInfo: {
    ethnicity: '',
    age: '',
    dietaryRestrictions: '',
    specialRequirements: '',
  },
  venueNeeds: {
    build: false,
    rehearsal: false,
    power: false,
    mainVisual: false,
    filming: false,
  },
  invoiceNeeds: '',
  sachetAccount: '',
});

let _stepTempId = 0;

Page({
  behaviors: [
    require('../../behaviors/formBase'),
    require('../../behaviors/stepEditor'),
  ],
  data: {
    form: DEFAULT_FORM(),
    showVenueInput: false,
    customVenue: '',
    saving: false,
    submitting: false,
    draftId: null,
    hasDraft: false,
    showRegister: false,
    // 粘贴识别
    pasteText: '',
    parsing: false,
    // 活动日历
    calYear: 0,
    calMonth: 0,
    calWeeks: [],
    calExpanded: false,
    calAutoExpand: false,
    scrollTop: 0,
  },

  onFormScroll(e) {
    this._scrollTop = e.detail.scrollTop;
  },

  async onLoad() {
    const app = getApp();
    if (!app.globalData.isLoggedIn || !app.globalData.userInfo) {
      this.setData({ showRegister: true });
      return;
    }
    wx.setNavigationBarTitle({ title: '新建活动' });
    const user = getCurrentUser();
    if (user) {
      this.setData({ 'form.bookingPerson': user.name, isAdmin: user.role === 'admin' });
      if (user.role === 'admin') {
        try {
          const userList = await getUsers();
          this.setData({ userList: userList || [] });
          this._buildDeptUserPicker(userList || []);
        } catch (e) {
          console.warn('获取用户列表失败', e);
        }
      } else {
        this.setData({ userList: [user] });
      }
    }
    // 恢复日历折叠状态
    const savedExpand = wx.getStorageSync('cal_auto_expand');
    if (savedExpand) this.setData({ calExpanded: true, calAutoExpand: true });
    this._checkMyDraft();
    this._loadTodayCalendar();
  },

  onShow() {
    // 从其他页面返回时刷新日历（如标记了接待上限）
    if (this.data.calYear && this.data.calMonth) {
      this._loadCalendar(this.data.calYear, this.data.calMonth);
    }
  },

  _loadTodayCalendar() {
    const now = new Date();
    this._loadCalendar(now.getFullYear(), now.getMonth() + 1);
  },

  // 折叠/展开日历（展开时懒加载数据）
  toggleCalendar() {
    const expanded = !this.data.calExpanded;
    this.setData({ calExpanded: expanded });
    if (expanded && (!this.data.calYear || !this.data.calMonth)) {
      this._loadTodayCalendar();
    }
  },

  // 记住展开状态
  toggleAutoExpand(e) {
    const checked = e.detail.value;
    this.setData({ calAutoExpand: checked });
    wx.setStorageSync('cal_auto_expand', checked);
    if (!checked) this.setData({ calExpanded: false });
  },

  // 粘贴信息输入
  onPasteInput(e) {
    this.setData({ pasteText: e.detail.value });
  },

  // 粘贴识别按钮
  parseInfo() {
    const text = this.data.pasteText;
    if (!text || !text.trim()) {
      wx.showToast({ title: '请先粘贴预定信息', icon: 'none' });
      return;
    }

    this.setData({ parsing: true });

    try {
      const updates = {};
      const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

      // 辅助：从行中提取字段值（冒号/空格分隔）
      const extractVal = (line, ...keys) => {
        for (const k of keys) {
          // 匹配 "字段名：值" 或 "字段名:值" 或 "字段名 值"
          const m = line.match(new RegExp(`^${k}[：:\\s]+(.+)$`));
          if (m) return m[1].trim();
        }
        return null;
      };

      // 解析步骤列表（活动流程/流程 section 后面的行）
      const stepLines = [];
      let inSteps = false;
      let inClient = false;

      for (const line of lines) {
        // 检测 section 切换
        if (/^(活动流程|流程|环节)[：:]?/.test(line)) {
          inSteps = true;
          inClient = false;
          // 同行可能有第一个步骤
          const afterLabel = line.replace(/^(活动流程|流程|环节)[：:\s]*/, '').trim();
          if (afterLabel) stepLines.push(afterLabel);
          continue;
        }
        if (/^(客户|客户信息|客户特殊)/.test(line)) {
          inSteps = false;
          inClient = true;
          continue;
        }
        if (/^(结算|场地需求|发票|香囊|场地)/.test(line)) {
          inSteps = false;
          inClient = false;
        }

        if (inSteps && line.length > 2) {
          stepLines.push(line);
        }

        // 提取基本字段
        const dateVal = extractVal(line, '活动时间', '活动日期', '日期', '时间');
        if (dateVal) {
          // 解析多种日期格式 → 分离日期和到店时间
          let matched = false;
          // 格式1: "2026年6月1日 14:00" 或 "2026年6月1日14:00"（允许无空格 / 全角冒号）
          const m1 = dateVal.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})[：:](\d{2})/);
          if (m1) {
            const [, y, mo, d, h, mi] = m1;
            updates['form.activityDate'] = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            updates['form.arrivalTime'] = `${String(h).padStart(2, '0')}:${mi}`;
            matched = true;
          }
          // 格式2: "2026-06-10" 或 "2026-06-10 14:00"
          if (!matched) {
            const m2 = dateVal.match(/(\d{4}-\d{1,2}-\d{1,2})/);
            if (m2) {
              updates['form.activityDate'] = m2[1];
              const t2 = dateVal.match(/(\d{1,2}):(\d{2})/);
              if (t2) updates['form.arrivalTime'] = `${String(Number(t2[1])).padStart(2, '0')}:${t2[2]}`;
              matched = true;
            }
          }
          // 格式3: "2026/6/1 14:00"
          if (!matched) {
            const m3 = dateVal.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})/);
            if (m3) {
              const [, y, mo, d, h, mi] = m3;
              updates['form.activityDate'] = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              updates['form.arrivalTime'] = `${String(h).padStart(2, '0')}:${mi}`;
              matched = true;
            }
          }
          if (!matched) {
            updates['form.activityDate'] = dateVal;
          }
          continue;
        }

        const unitVal = extractVal(line, '活动单位', '单位', '客户名称');
        if (unitVal) { updates['form.activityUnit'] = unitVal; continue; }

        const venueVal = extractVal(line, '活动地点', '地点', '场地');
        if (venueVal) { updates['form.venue'] = venueVal; continue; }

        const countVal = extractVal(line, '活动人数', '人数');
        if (countVal !== null) {
          // 人数可能是区间 "15-20人" 或 "15~20"，取分隔符后方的数字
          let num = countVal;
          const rangeMatch = num.match(/[-~到]\s*(\d+)/);
          if (rangeMatch) {
            num = rangeMatch[1];
          } else {
            num = num.replace(/[^0-9]/g, '');
          }
          if (num) updates['form.peopleCount'] = num;
          continue;
        }

        const bizVal = extractVal(line, '业务体现', '业务类型', '业务');
        if (bizVal) { updates['form.businessType'] = bizVal; continue; }

        const vUsage = extractVal(line, '场地使用', '场地说明');
        if (vUsage) { updates['form.venueUsage'] = vUsage; continue; }

        const settVal = extractVal(line, '结算方式', '结算');
        if (settVal) { updates['form.settlementMethod'] = settVal; continue; }

        const costVal = extractVal(line, '费用合计', '费用', '金额', '总费用');
        if (costVal !== null) {
          // 处理表达式如 "20+30+40=90"，取最后一个等号后面的数字
          let num;
          if (/[+\-*/=]/.test(costVal) && costVal.indexOf('=') !== -1) {
            // 有运算符且有等号：取最后一个等号后面的数字
            const parts = costVal.split('=');
            num = parts[parts.length - 1].replace(/[^0-9.]/g, '').trim();
          } else {
            num = costVal.replace(/[^0-9.]/g, '');
          }
          if (num) updates['form.totalCost'] = num;
          continue;
        }

        const contactVal = extractVal(line, '活动对接人', '对接人');
        if (contactVal) { updates['form.contactPerson'] = contactVal; continue; }

        const bookVal = extractVal(line, '活动预订人', '预订人', '预定人');
        // 非管理员不允许覆盖预订人（只能发自己的活动）
        if (bookVal && this.data.isAdmin) { updates['form.bookingPerson'] = bookVal; continue; }

        // 发票需求
        const invoiceVal = extractVal(line, '发票需求', '发票');
        if (invoiceVal) { updates['form.invoiceNeeds'] = invoiceVal; continue; }

        // 客户信息
        const ethVal = extractVal(line, '民族', '宗教', '民族/宗教', '民族/宗教信仰');
        if (ethVal) { updates['form.clientInfo.ethnicity'] = ethVal; continue; }

        const ageVal = extractVal(line, '年龄');
        if (ageVal) { updates['form.clientInfo.age'] = ageVal; continue; }

        const dietVal = extractVal(line, '食物禁忌', '饮食禁忌', '饮食');
        if (dietVal) { updates['form.clientInfo.dietaryRestrictions'] = dietVal; continue; }

        const spReqVal = extractVal(line, '接待需求', '特殊需求', '重要接待');
        if (spReqVal) { updates['form.clientInfo.specialRequirements'] = spReqVal; continue; }
      }

      // 解析活动流程/环节
      if (stepLines.length > 0) {
        const steps = [];
        let stepTempId = 0;

        for (const line of stepLines) {
          // 格式支持：
          //   A）模板格式：时间在前 "14:00-15:00参观零号店1-3层" / "16:00集合返程"
          //   B）旧格式：名称在前 "参观零号店 14:00-15:00 张三" / "参观零号店 10:00 张三"
          // 去掉序号前缀如 "1." "1、" "1）" "1)"
          const cleaned = line.replace(/^\d+[、.．）)\s]*\s*/, '');

          let step = null;

          // 1) 时间范围在前（模板格式）：HH:MM-HH:MM 环节名
          let m = cleaned.match(/^(\d{1,2}):(\d{2})\s*[-~至到]\s*(\d{1,2}):(\d{2})\s*(.+)$/);
          if (m) {
            const [, sH, sM, eH, eM, name] = m;
            const nameClean = name.trim();
            const venueInfo = matchStepVenue(nameClean);
            step = {
              tempId: ++stepTempId,
              stepName: nameClean,
              startTime: `${sH.padStart(2, '0')}:${sM}`,
              endTime: `${eH.padStart(2, '0')}:${eM}`,
              venue: venueInfo.venue, venueIndex: venueInfo.venueIndex,
              ownerId: '', ownerName: '', ownerIndex: -1,
              ownerDeptValue: [0, this._pendingIdx || 0],
            };
          }

          // 2) 时间范围在后（旧格式）：环节名 + 时间范围 + 可选负责人
          if (!step) {
            m = cleaned.match(/^(.+?)\s+(\d{1,2}):(\d{2})\s*[-~至到]\s*(\d{1,2}):(\d{2})(?:\s+(.+))?$/);
            if (m) {
              const [, name, sH, sM, eH, eM, owner] = m;
              const nameClean = name.trim();
              const venueInfo = matchStepVenue(nameClean);
              step = {
                tempId: ++stepTempId,
                stepName: nameClean,
                startTime: `${sH.padStart(2, '0')}:${sM}`,
                endTime: `${eH.padStart(2, '0')}:${eM}`,
                venue: venueInfo.venue, venueIndex: venueInfo.venueIndex,
                ownerId: '', ownerName: owner ? owner.trim() : '', ownerIndex: -1,
                ownerDeptValue: [0, this._pendingIdx || 0],
              };
              if (owner && this.data.userList.length > 0) {
                const idx = this.data.userList.findIndex(u => u.name === owner.trim());
                if (idx >= 0) { step.ownerIndex = idx; step.ownerId = this.data.userList[idx]._id; }
              }
            }
          }

          // 3) 单个时间在前（模板格式）：HH:MM 环节名 → 起始=结束
          if (!step) {
            m = cleaned.match(/^(\d{1,2}):(\d{2})\s*(.+)$/);
            if (m) {
              const [, h, mi, name] = m;
              const t = `${h.padStart(2, '0')}:${mi}`;
              const nameClean = name.trim();
              const venueInfo = matchStepVenue(nameClean);
              step = {
                tempId: ++stepTempId,
                stepName: nameClean,
                startTime: t, endTime: t,
                venue: venueInfo.venue, venueIndex: venueInfo.venueIndex,
                ownerId: '', ownerName: '', ownerIndex: -1,
                ownerDeptValue: [0, this._pendingIdx || 0],
              };
            }
          }

          // 4) 单个时间在后（旧格式）：环节名 + 时间 + 可选负责人 → 起始=结束
          if (!step) {
            m = cleaned.match(/^(.+?)\s+(\d{1,2}):(\d{2})(?:\s+(.+))?$/);
            if (m) {
              const [, name, h, mi, owner] = m;
              const t = `${h.padStart(2, '0')}:${mi}`;
              const nameClean = name.trim();
              const venueInfo = matchStepVenue(nameClean);
              step = {
                tempId: ++stepTempId,
                stepName: nameClean,
                startTime: t, endTime: t,
                venue: venueInfo.venue, venueIndex: venueInfo.venueIndex,
                ownerId: '', ownerName: owner ? owner.trim() : '', ownerIndex: -1,
                ownerDeptValue: [0, this._pendingIdx || 0],
              };
              if (owner && this.data.userList.length > 0) {
                const idx = this.data.userList.findIndex(u => u.name === owner.trim());
                if (idx >= 0) { step.ownerIndex = idx; step.ownerId = this.data.userList[idx]._id; }
              }
            }
          }

          // 5) 仅名称
          if (!step) {
            const nameOnly = cleaned.replace(/\s*\(.*?\)\s*/g, '').trim();
            if (nameOnly && nameOnly.length > 1) {
              const venueInfo = matchStepVenue(nameOnly);
              step = {
                tempId: ++stepTempId,
                stepName: nameOnly,
                startTime: '', endTime: '',
                venue: venueInfo.venue, venueIndex: venueInfo.venueIndex,
                ownerId: '', ownerName: '', ownerIndex: -1,
                ownerDeptValue: [0, this._pendingIdx || 0],
              };
            }
          }

          if (step) steps.push(step);
        }

        if (steps.length > 0) {
          _stepTempId = Math.max(_stepTempId, stepTempId);
          updates['form.steps'] = steps;
        }
      }

      // 香囊账户识别
      const sachetLine = lines.find(l => /香囊账户/.test(l));
      if (sachetLine) {
        if (/医馆/.test(sachetLine)) {
          updates['form.sachetAccount'] = 'clinic';
        } else if (/零号店/.test(sachetLine)) {
          updates['form.sachetAccount'] = 'shop';
        }
      }

      // 应用所有更新
      if (Object.keys(updates).length > 0) {
        // 用 setData 一次性应用
        const fullUpdates = { ...updates, parsing: false };
        this.setData(fullUpdates);

        // 更新香囊显示状态
        this.setData({ showSachet: this._shouldShowSachet() });

        const fieldCount = Object.keys(updates).length;
        wx.showToast({ title: `已识别 ${fieldCount} 个字段`, icon: 'success' });
        // 恢复滚动位置，防止自动滚回顶部
        var st = this._scrollTop || 0;
        setTimeout(() => this.setData({ scrollTop: st }), 50);
        setTimeout(() => this.setData({ scrollTop: st }), 200);
      } else {
        this.setData({ parsing: false });
        wx.showToast({ title: '未识别到有效信息，请检查格式', icon: 'none' });
      }
    } catch (err) {
      console.error('[parseInfo] error:', err);
      this.setData({ parsing: false });
      wx.showToast({ title: '识别失败，请重试', icon: 'none' });
    }
  },

  // ===== 流程环节（override behavior） =====
  // 使用模块级递增计数器生成 tempId
  _getNextTempId() { return ++_stepTempId; },

  // 环节地点变更
  onStepVenueChange(e) {
    const index = e.currentTarget.dataset.index;
    const venueIdx = Number(e.detail.value);
    const venueList = VENUE_LIST;
    const venue = venueIdx < venueList.length - 1 ? venueList[venueIdx] : '';
    if (venueIdx === venueList.length - 1) {
      // 选"其他（手动输入）"
      this.setData({ showVenueInput: true, customVenue: '', _venueStepIdx: index });
    } else {
      this.setData({
        [`form.steps[${index}].venue`]: venue,
        [`form.steps[${index}].venueIndex`]: venueIdx,
      });
    }
  },

  // 手动输入地点确认
  onCustomVenueInput(e) { this.setData({ customVenue: e.detail.value }); },
  confirmCustomVenue() {
    const idx = this.data._venueStepIdx;
    if (idx === undefined || idx < 0) {
      wx.showToast({ title: '请先选择环节', icon: 'none' });
      this.setData({ showVenueInput: false, customVenue: '' });
      return;
    }
    const val = this.data.customVenue.trim();
    if (!val) { wx.showToast({ title: '请输入地点', icon: 'none' }); return; }
    this.setData({
      [`form.steps[${idx}].venue`]: val,
      [`form.steps[${idx}].venueIndex`]: VENUE_LIST.length - 1,
      showVenueInput: false,
      customVenue: '',
    });
  },
  cancelCustomVenue() { this.setData({ showVenueInput: false, customVenue: '' }); },

  // ===== 校验 =====
  _validate() {
    const f = this.data.form;
    if (!f.activityDate)  { wx.showToast({ title: '请选择活动时间', icon: 'none' }); return false; }
    if (!f.arrivalTime)   { wx.showToast({ title: '请选择到店时间', icon: 'none' }); return false; }
    if (!f.activityUnit)  { wx.showToast({ title: '请填写活动单位', icon: 'none' }); return false; }
    if (!f.venue)         { wx.showToast({ title: '请填写活动地点', icon: 'none' }); return false; }
    if (!f.peopleCount)   { wx.showToast({ title: '请填写活动人数', icon: 'none' }); return false; }
    if (!f.bookingPerson) { wx.showToast({ title: '请填写预订人',   icon: 'none' }); return false; }
    // 含香囊关键词时，账户必选
    if (this.data.showSachet && !f.sachetAccount) {
      wx.showToast({ title: '请选择香囊账户（医馆/零号店）', icon: 'none' });
      return false;
    }
    for (const [i, s] of f.steps.entries()) {
      if (!s.stepName) {
        wx.showToast({ title: `第${i+1}个环节名称不能为空`, icon: 'none' });
        return false;
      }
    }
    return true;
  },

  // ===== 草稿检查 =====
  async _checkMyDraft() {
    try {
      const res = await getMyDraft();
      // callCloudFunc 已剥掉外层，res 是 data 内容（草稿对象或 null）
      const draft = (res && res.data) || res;
      if (draft && draft._id) {
        this.setData({ hasDraft: true, draftId: draft._id });
      }
    } catch (e) {
      console.warn('[_checkMyDraft] 获取草稿失败', e);
    }
  },

  // ===== 活动日历 =====
  async _loadCalendar(year, month) {
    try {
      const res = await getMonthlyCounts(year, month);
      const counts = (res && res.counts) || {};
      const people = (res && res.people) || {};
      const limits = (res && res.limits) || [];
      this._buildCalendarGrid(year, month, counts, people, limits);
    } catch (e) {
      console.warn('[calendar] 加载失败', e);
      this._buildCalendarGrid(year, month, {}, {}, []);
    }
  },

  _buildCalendarGrid(year, month, counts, people, limits) {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const limitSet = new Set(limits);
    const daysInMonth = new Date(year, month, 0).getDate();
    let firstDow = new Date(year, month - 1, 1).getDay();
    firstDow = firstDow === 0 ? 6 : firstDow - 1;

    const cells = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = ds === todayStr;
      const isLimit = limitSet.has(ds);
      const cnt = counts[ds] || 0;
      const totalPeople = people[ds] || 0;
      let cls = 'cal-green';
      if (isLimit) {
        cls = 'cal-purple';
      } else if (cnt > 0) {
        if (totalPeople >= 300) cls = 'cal-red';
        else if (totalPeople >= 200) cls = 'cal-orange';
        else if (totalPeople >= 100) cls = 'cal-orange-light';
        else cls = 'cal-yellow';
      }
      cells.push({ day: d, dateStr: ds, count: cnt, totalPeople, isToday, isLimit, cls });
    }

    // 填充空白格（周一为起始）
    const leading = [];
    for (let i = 0; i < firstDow; i++) {
      leading.push(null);
    }

    const all = [...leading, ...cells];
    const weeks = [];
    for (let i = 0; i < all.length; i += 7) {
      weeks.push(all.slice(i, i + 7));
    }
    while (weeks.length < 6) weeks.push(new Array(7).fill(null));

    this.setData({ calYear: year, calMonth: month, calWeeks: weeks });
  },

  calPrevMonth() {
    let { calYear, calMonth } = this.data;
    if (calMonth === 1) { calYear--; calMonth = 12; }
    else calMonth--;
    this._loadCalendar(calYear, calMonth);
  },

  calNextMonth() {
    let { calYear, calMonth } = this.data;
    if (calMonth === 12) { calYear++; calMonth = 1; }
    else calMonth++;
    this._loadCalendar(calYear, calMonth);
  },

  calTapDay(e) {
    const ds = e.currentTarget.dataset.date;
    if (!ds) return;
    const app = getApp();
    app.globalData._calFilterDate = ds;
    app.globalData._calFilterMode = 'specific';
    wx.switchTab({ url: '/pages/activity-list/activity-list' });
  },

  // ===== 存为草稿 / 继续编辑 =====
  async saveDraft() {
    // 如果已有草稿 → 跳转到编辑页
    if (this.data.hasDraft && this.data.draftId) {
      wx.navigateTo({
        url: `/pages/activity-edit/activity-edit?id=${this.data.draftId}`,
      });
      return;
    }

    // 首次保存草稿
    if (this._loading) return;
    this._loading = true;
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    try {
      const res = await createActivity({ ...this.data.form, status: 'draft' });
      const draftId = res.id || res._id;
      console.log('[saveDraft] 成功:', draftId);
      this.setData({ hasDraft: true, draftId });
      wx.showToast({ title: '已存为草稿', icon: 'success' });
    } catch (e) {
      console.error('[saveDraft] 失败:', e);
      wx.showToast({ title: '保存失败：' + (e.message || e.errMsg || '未知错误'), icon: 'none', duration: 2500 });
    }
    wx.hideLoading();
    this.setData({ saving: false });
    this._loading = false;
  },

  // ===== 提交活动 =====
  submitActivity(force = false) {
    if (!this._validate()) return;
    if (this._loading) return;
    this._loading = true;
    this.setData({ submitting: true });
    this._doSubmit(force);
  },

  async _doSubmit(force) {
    wx.showLoading({ title: '提交中...' });
    try {
      // 场地冲突检测
      if (!force) {
        const steps = (this.data.form.steps || []).filter(s => s.venue && s.startTime && s.endTime);
        if (steps.length > 0) {
          const checkRes = await wx.cloud.callFunction({
            name: 'activities',
            data: { action: 'checkVenueConflict', activityDate: this.data.form.activityDate, steps }
          });
          const cr = checkRes.result;
          if (cr && cr.code === 1 && cr.data && cr.data.conflicts.length > 0) {
            const conflicts = cr.data.conflicts;
            const lines = conflicts.map(c =>
              `${c.venue}: ${c.conflictTime} ${c.conflictActivity}「${c.conflictStep}」(预订人:${c.conflictBooker})`
            ).join('\n');
            this.setData({ submitting: false });
            this._loading = false;
            wx.hideLoading();
            wx.showModal({
              title: `场地冲突 (${conflicts.length}处)`,
              content: `${lines}\n\n请沟通使用情况后提交`,
              confirmText: '已沟通，确认提交',
              confirmColor: '#D32F2F',
              success: (r) => {
                if (r.confirm) this.submitActivity(true);
              },
            });
            return;
          }
        }
      }

      const data = { ...this.data.form, status: 'pending' };
      if (force) data._forceSubmit = true;
      const res = await wx.cloud.callFunction({
        name: 'activities',
        data: { action: 'create', data }
      });
      const result = res.result;
      if (result && result.code === 1) {
        // 管理员确认弹窗
        this.setData({ submitting: false });
        this._loading = false;
        wx.hideLoading();
        wx.showModal({
          title: '接待上限提醒',
          content: '当天已达接待上限，是否确认提交？',
          confirmText: '仍然提交',
          success: (r) => {
            if (r.confirm) this.submitActivity(true);
          },
        });
        return;
      }
      if (result && result.code === 0) {
        const activityId = result.data && (result.data.id || result.data._id);
        if (!activityId) {
          wx.showToast({ title: '提交成功但未获取到活动ID', icon: 'none', duration: 2500 });
          setTimeout(() => wx.navigateBack(), 2500);
          return;
        }
        wx.hideLoading();
        wx.showToast({ title: '活动已提交', icon: 'success' });
        setTimeout(() => {
          const allTmpls = [
            'XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70',
            'vRCdbLk5V3L1OpnyPm7M5oOUWIBJIZh7jnNi6SFRfwA',
          ];
          const currentUser = getCurrentUser();
          if (currentUser && currentUser.department === '保洁') {
            allTmpls.push('gw8f84WumXoZkBDaMErZ7YVDTna9P8jwosJf0bURSSg');
          }
          requestSubscription(allTmpls).catch(() => {});
          wx.cloud.callFunction({
            name: 'auth',
            data: { action: 'setNotifyEnabled', enabled: true },
          }).catch(() => {});
          wx.cloud.callFunction({
            name: 'auth',
            data: { action: 'resetNotifyCount', version: getApp().globalData.appVersion },
          }).catch(() => {});
        }, 1500);
        setTimeout(() => {
          wx.redirectTo({ url: `/pages/activity-detail/activity-detail?id=${activityId}` });
        }, 1200);
      } else {
        wx.showToast({ title: (result && result.message) || '提交失败', icon: 'none', duration: 2500 });
      }
    } catch (e) {
      wx.showToast({ title: '提交失败', icon: 'none', duration: 2500 });
    }
    wx.hideLoading();
    this.setData({ submitting: false });
    this._loading = false;
  },

  onRegisterSuccess(e) {
    this.setData({ showRegister: false });
    this.onLoad();
  },
});
