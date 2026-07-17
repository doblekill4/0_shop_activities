// cloudfunctions/auth/index.js - 鐧诲綍璁よ瘉浜戝嚱鏁?const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 瀹℃牳妯″紡锛氳烦杩囬棬搴楃兢鐧藉悕鍗曪紝鍏佽浠绘剰鐢ㄦ埛娉ㄥ唽锛堜笂绾垮悗鍏抽棴锛?const REVIEW_MODE = process.env.REVIEW_MODE === 'true';

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action } = event;

  console.log('[auth] 鏀跺埌璇锋眰', { action, openid });

  try {
    switch (action) {
      case 'autoLogin':
        return await autoLogin(openid, event);
      case 'checkReviewMode':
        return { code: 0, data: { reviewMode: REVIEW_MODE }, message: 'ok' };
      case 'login':
        return await login(event, openid);
      case 'listDepartments':
        return await listDepartments();
      case 'getPublicUserList':
        return await getPublicUserList();
      case 'activateStoreGroup':
        return await activateStoreGroup(openid);
      case 'resetStoreGroup':
        return await resetStoreGroup(openid);
      case 'setNotifyEnabled':
        return await setNotifyEnabled(openid, event.enabled);
      case 'resetNotifyCount':
        return await resetNotifyCount(openid, event.version);
      case 'listUsers':
        return await listUsers();
      case 'setUserStatus':
        return await setUserStatus(event, openid);
      default:
        return { code: -1, message: '鏈煡鎿嶄綔' };
    }
  } catch (e) {
    console.error('[auth] 鎵ц鍑洪敊', e);
    return { code: -1, message: e.message || '鐧诲綍澶辫触' };
  }
};

/* ========== 鑷姩鐧诲綍锛堟鏌ユ槸鍚﹀凡娉ㄥ唽锛?========== */
async function autoLogin(openid, event = {}) {
  try {
    // 宸叉敞鍐岀敤鎴蜂粠缇ゅ叆鍙ｆ墦寮€鏃讹紝灏濊瘯璁惧畾/鍒锋柊鐧藉悕鍗?    const storeGroupExists = await checkStoreGroupExists();
    if (!storeGroupExists && event.groupEncryptedData && event.groupIv) {
      console.log('[autoLogin] 鐧藉悕鍗曟湭璁惧畾锛屽皾璇曚粠缇ゅ叆鍙ｇ櫥璁?);
      await verifyStoreGroup(event.groupEncryptedData, event.groupIv, openid, '');
    }

    const res = await db.collection('users').where({ openid }).get();
    if (res.data && res.data.length > 0) {
      const user = res.data[0];
      // 鍚堝苟閮ㄩ棬鍏宠仈鐨勬潈闄愮粍鏉冮檺
      let permissions = user.permissions || [];
      // 涓虹幇鏈夌鐞嗗憳鑷姩琛ュ叏鏂板鏉冮檺
      if (user.role === 'admin') {
        const adminPerms = [
          'create_activity', 'edit_activity', 'delete_activity',
          'upload_voucher', 'manage_users', 'manage_departments',
          'view_all_revisions', 'export_data',
          'send_notification', 'assign_process_owner', 'set_capacity_limit',
        ];
        const missing = adminPerms.filter(p => !permissions.includes(p));
        if (missing.length > 0) {
          permissions = [...permissions, ...missing];
          await db.collection('users').doc(user._id).update({
            data: { permissions }
          }).catch(() => {});
        }
      }
      if (user.department) {
        try {
          const deptRes = await db.collection('departments')
            .where({ name: user.department }).get();
          if (deptRes.data && deptRes.data.length > 0 && deptRes.data[0].permissionGroupId) {
            const pgRes = await db.collection('permission_groups')
              .doc(deptRes.data[0].permissionGroupId).get();
            if (pgRes.data && Array.isArray(pgRes.data.permissions)) {
              // 鍚堝苟锛屽幓閲?              permissions = [...new Set([...permissions, ...pgRes.data.permissions])];
            }
          }
        } catch (e) {
          console.warn('[autoLogin] 閮ㄩ棬鏉冮檺鍚堝苟澶辫触', e.message);
        }
      }
      return {
        code: 0,
        data: {
          reviewMode: REVIEW_MODE,
          userInfo: {
            _id: user._id,
            openid: user.openid || openid,
            name: user.name || '鏈煡鐢ㄦ埛',
            nickname: user.nickname || '',
            department: user.department || '鏈垎閰?,
            avatarUrl: user.avatarUrl || '',
            employeeId: user.employeeId || '',
            permissions,
            role: user.role || 'user',
            notifyEnabled: user.notifyEnabled !== false,
            notifyAuthVersion: user.notifyAuthVersion || '',
            notifyAuthAt: user.notifyAuthAt || '',
            notifySentCount: user.notifySentCount || 0,
            notifyLastError: user.notifyLastError || '',
          },
        },
        message: 'success',
      };
    }
    return { code: 401, message: '鏈櫥褰?, data: { reviewMode: REVIEW_MODE } };
  } catch (e) {
    console.error('[auth.autoLogin] 鏁版嵁搴撻敊璇?, e);
    return { code: 401, message: '鏈櫥褰曪紙鏁版嵁搴撳紓甯革細' + e.message + '锛? };
  }
}

/* ========== 鐧诲綍锛堟敞鍐屾垨鏇存柊锛?========== */
async function login(event, openid) {
  const { name, department, nickname, avatarUrl, employeeId, role, fromGroup, groupEncryptedData, groupIv, scene } = event;
  // 浣撻獙鐗?getGroupEnterInfo 鍙兘鏃犲姞瀵嗘暟鎹紝鐢?scene 鍏滃簳
  const fromGroupScene = !fromGroup && scene === 1044;
  const effectiveFromGroup = fromGroup || fromGroupScene;

  try {
    // 鍏堟鏌ョ敤鎴锋槸鍚﹀凡瀛樺湪
    const existRes = await db.collection('users').where({ openid }).get();

    if (existRes.data && existRes.data.length > 0) {
      // 宸插瓨鍦細鏇存柊鐧诲綍淇℃伅
      const user = existRes.data[0];

      // 鍙湁鐜嬩竾鍏ㄥ彲浠ヨ嚜鍔ㄥ崌绾т负绠＄悊鍛?      let needUpgrade = false;
      if (user.name === '鐜嬩竾鍏? && user.role !== 'admin') {
        try {
          const countRes = await db.collection('users').count();
          if (countRes.total <= 1) {
            needUpgrade = true;
          }
        } catch (e) {
          console.log('[auth.login] count 澶辫触锛岃烦杩囧崌绾ф鏌?, e);
        }
      }

      const updateData = {
        lastLoginAt: db.serverDate(),
        ...(needUpgrade ? {
          role: 'admin',
          permissions: [
            'create_activity', 'edit_activity', 'delete_activity',
            'upload_voucher', 'manage_users', 'manage_departments',
            'view_all_revisions', 'export_data',
            'send_notification', 'assign_process_owner', 'set_capacity_limit',
          ],
        } : {}),
      };
      if (name) updateData.name = name;
      if (department) updateData.department = department;
      if (nickname) updateData.nickname = nickname;
      if (avatarUrl) updateData.avatarUrl = avatarUrl;
      if (employeeId) updateData.employeeId = employeeId;

      await db.collection('users').doc(user._id).update({ data: updateData });

      // 閲嶆柊鑾峰彇鏈€鏂版暟鎹?      const updated = await db.collection('users').doc(user._id).get();
      return {
        code: 0,
        data: {
          userInfo: {
            _id: updated.data._id,
            openid: updated.data.openid || openid,
            name: updated.data.name,
            nickname: updated.data.nickname || '',
            department: updated.data.department,
            avatarUrl: updated.data.avatarUrl || '',
            employeeId: updated.data.employeeId || '',
            permissions: updated.data.permissions || [],
            role: updated.data.role || 'user',
            notifyEnabled: updated.data.notifyEnabled !== false,
          },
        },
        message: needUpgrade ? '宸茶嚜鍔ㄥ崌绾т负绠＄悊鍛? : '鐧诲綍鎴愬姛',
      };
    } else {
      // 鏂扮敤鎴凤細濡傛灉娌℃湁鎻愪緵 name锛岃繑鍥?402 璁╁墠绔脊娉ㄥ唽琛ㄥ崟
      if (!name || !department) {
        return { code: 402, message: '璇峰厛瀹屽杽淇℃伅瀹屾垚娉ㄥ唽' };
      }

      // 鍙湁"鐜嬩竾鍏?棣栨娉ㄥ唽鏃舵墠鏄鐞嗗憳
      const isAdmin = name === '鐜嬩竾鍏?;

      // 楠岃瘉缇ゅ叆鍙ｏ細瑙ｅ瘑鑾峰彇 openGId锛屼笌宸插瓨鍌ㄧ殑闂ㄥ簵缇D姣斿
      let verifiedStoreGroup = false;
      if (groupEncryptedData && groupIv) {
        verifiedStoreGroup = await verifyStoreGroup(groupEncryptedData, groupIv, openid, name);
        console.log('[auth.login] 缇ら獙璇佺粨鏋?', verifiedStoreGroup);
      } else if (effectiveFromGroup && !groupEncryptedData) {
        // 浣撻獙鐗?fallback锛歴cene 纭浠庣兢杩涗絾鏃犲姞瀵嗘暟鎹?鈫?涓嶈兘楠岃瘉鍏蜂綋缇わ紝鍙兘纭鏉ヨ嚜缇?        console.log('[auth.login] 浣撻獙鐗堢兢鍏ュ彛锛堟棤鍔犲瘑鏁版嵁锛夛紝scene=' + scene);
      }

      // 闂ㄥ簵缇ょ櫧鍚嶅崟鎷︽埅锛氬鏍告ā寮忎笅璺宠繃
      if (!REVIEW_MODE) {
        const storeGroupExists = await checkStoreGroupExists();
        if (storeGroupExists && !effectiveFromGroup) {
          console.log('[auth.login] 闂ㄥ簵缇ゅ凡鐧昏锛岄潪缇ゅ叆鍙ｆ敞鍐岃鎷?);
          return { code: 403, message: '浠呴檺闂ㄥ簵缇ゆ垚鍛樻敞鍐岋紝璇蜂粠缇よ亰涓墦寮€灏忕▼搴? };
        }
      }

      // 鏈€缁堣鑹诧細admin > 闂ㄥ簵缇ら獙璇侀€氳繃 > user
      const finalRole = isAdmin ? 'admin'
        : verifiedStoreGroup ? 'employee'
        : 'user';

      console.log('[auth.login] 鏂扮敤鎴疯鑹?', finalRole,
        'fromGroup:', !!fromGroup, 'verified:', verifiedStoreGroup);

      // 鍛樺伐鏉冮檺姣旀櫘閫氱敤鎴峰
      const employeePermissions = [
        'create_activity', 'edit_activity', 'upload_voucher',
        'confirm_step', 'send_notification',
      ];

      const newUser = {
        openid: openid,
        name: name,
        nickname: nickname || name,
        department: department,
        avatarUrl: avatarUrl || '',
        employeeId: employeeId || '',
        permissions: isAdmin
          ? [
              'create_activity', 'edit_activity', 'delete_activity',
              'upload_voucher', 'manage_users', 'manage_departments',
              'view_all_revisions', 'export_data',
              'send_notification', 'assign_process_owner', 'set_capacity_limit',
            ]
          : (finalRole === 'employee') ? employeePermissions
          : ['create_activity'],
        role: finalRole,
        createdAt: db.serverDate(),
        lastLoginAt: db.serverDate(),
      };

      const addRes = await db.collection('users').add({ data: newUser });
      console.log('[auth.login] 鏂扮敤鎴峰垱寤烘垚鍔?, addRes._id,
        'role:', finalRole);

      return {
        code: 0,
        data: {
          userInfo: {
            _id: addRes._id,
            openid: openid,
            name: newUser.name,
            nickname: newUser.nickname || '',
            department: newUser.department,
            avatarUrl: newUser.avatarUrl || '',
            employeeId: newUser.employeeId || '',
            permissions: newUser.permissions,
            role: newUser.role,
            notifyEnabled: true,
          },
        },
        message: finalRole === 'admin' ? '娉ㄥ唽鎴愬姛锛佹偍宸叉槸绠＄悊鍛?
          : finalRole === 'employee' ? '娉ㄥ唽鎴愬姛锛佸凡璇嗗埆涓洪棬搴楀憳宸?
          : '娉ㄥ唽鎴愬姛',
      };
    }
  } catch (e) {
    console.error('[auth.login] 鎵ц鍑洪敊', e);
    return {
      code: -1,
      message: '娉ㄥ唽澶辫触锛? + (e.message || '鏈煡閿欒'),
      errDetail: {
        name: e.name,
        code: e.errCode || e.code,
      },
    };
  }
}

/* ========== 鍏紑鐢ㄦ埛鍒楄〃锛堜粎 _id + name锛屾棤鏉冮檺瑕佹眰锛?========== */
async function getPublicUserList() {
  try {
    const res = await db.collection('users')
      .field({ name: true, department: true })
      .limit(200)
      .get();
    return { code: 0, data: res.data || [], message: 'success' };
  } catch (e) {
    console.error('[getPublicUserList] 澶辫触', e);
    return { code: -1, message: '鑾峰彇澶辫触' };
  }
}

/* ========== 鎵嬪姩婵€娲婚棬搴楃兢鐧藉悕鍗曪紙浣撻獙鐗?鐜鍙楅檺鏃跺厹搴曪級 ========== */
async function activateStoreGroup(openid) {
  try {
    const userRes = await db.collection('users').where({ openid }).get();
    const user = userRes.data && userRes.data[0];
    if (!user) return { code: 403, message: 'not authorized' };
    let existDoc;
    try { existDoc = await db.collection('activities').doc('_system_settings_store_group').get(); } catch (e) {}
    if (existDoc && existDoc.data) {
      return { code: 0, message: '白名单已存在' };
    }
    await db.collection('activities').doc('_system_settings_store_group').set({
      data: { key: 'store_group_id', value: 'manual_activated', _system: true, createdBy: openid, createdAt: db.serverDate() },
    });
    return { code: 0, message: '已激活' };
  } catch (e) {
    return { code: -1, message: '激活失败' };
  }
}

/* ========== 閲嶇疆闂ㄥ簵缇ょ櫧鍚嶅崟锛堢鐞嗗憳鎿嶄綔锛?========== */
async function resetStoreGroup(openid) {
  try {
    const userRes = await db.collection('users').where({ openid }).get();
    const user = userRes.data && userRes.data[0];
    if (!user) return { code: 403, message: 'not authorized' };
    try {
      await db.collection('activities').doc('_system_settings_store_group').remove();
      return { code: 0, message: '已重置' };
    } catch (e) {
      return { code: 0, message: '当前无白名单' };
    }
  } catch (e) {
    return { code: -1, message: '操作失败' };
  }
}
/* ========== 鑾峰彇閮ㄩ棬鍒楄〃锛堝叕寮€鎺ュ彛锛屾棤闇€鐧诲綍锛?========== */
async function listDepartments() {
  try {
    const res = await db.collection('departments').get();
    return {
      code: 0,
      data: res.data || [],
      message: 'success',
    };
  } catch (e) {
    console.error('[auth.listDepartments] 澶辫触', e);
    return { code: -1, message: '鑾峰彇閮ㄩ棬鍒楄〃澶辫触' };
  }
}

/* ========== 璁剧疆閫氱煡寮€鍏筹紙鍐欏叆鐢ㄦ埛鏂囨。锛?========== */
async function setNotifyEnabled(openid, enabled) {
  try {
    await db.collection('users').where({ openid }).update({
      data: { notifyEnabled: !!enabled }
    });
    return { code: 0, message: '宸叉洿鏂? };
  } catch (e) {
    console.error('[setNotifyEnabled] 澶辫触', e);
    return { code: -1, message: '鏇存柊澶辫触' };
  }
}

/* ========== 閲嶇疆閫氱煡璁℃暟锛堟巿鏉冩垚鍔熷悗璋冪敤锛?========== */
async function resetNotifyCount(openid, version) {
  try {
    await db.collection('users').where({ openid }).update({
      data: {
        notifyAuthAt: new Date(),
        notifyAuthVersion: version || '',
        notifySentCount: 0,
        notifyLastError: '',
      }
    });
    return { code: 0, message: '宸查噸缃? };
  } catch (e) {
    console.error('[resetNotifyCount] 澶辫触', e);
    return { code: -1, message: '閲嶇疆澶辫触' };
  }
}

/* ========== 妫€鏌ラ棬搴楃兢鏄惁宸茬櫥璁?========== */
async function checkStoreGroupExists() {
  try {
    const doc = await db.collection('activities').doc('_system_settings_store_group').get();
    return !!(doc && doc.data);
  } catch (e) {
    return false;
  }
}

/* ========== 楠岃瘉闂ㄥ簵缇わ紙瑙ｅ瘑 + 鐧藉悕鍗曟瘮瀵癸級 ========== */
async function verifyStoreGroup(encryptedData, iv, openid, userName) {
  try {
    // 浣跨敤 cloud.openData 瑙ｅ瘑缇ゅ叆鍙ｄ俊鎭紙鍒╃敤浜戝嚱鏁颁笂涓嬫枃涓殑 session key锛?    const openResult = await cloud.openData({
      list: [{ encryptedData, iv }],
    });

    if (!openResult || !openResult.list || !openResult.list[0]) {
      console.warn('[verifyStoreGroup] 瑙ｅ瘑鏃犺繑鍥炴暟鎹?);
      return false;
    }

    const decrypted = openResult.list[0];
    const openGId = decrypted.openGId || (decrypted.data && decrypted.data.openGId) || '';
    if (!openGId) {
      console.warn('[verifyStoreGroup] 瑙ｅ瘑缁撴灉涓棤 openGId');
      return false;
    }
    console.log('[verifyStoreGroup] 瑙ｅ瘑鎴愬姛, openGId:', openGId);

    // 鏌ヨ宸插瓨鍌ㄧ殑闂ㄥ簵缇D锛堝瓨浜?activities 闆嗗悎锛?    let storedValue = '';
    try {
      const doc = await db.collection('activities').doc('_system_settings_store_group').get();
      storedValue = (doc && doc.data) ? doc.data.value : '';
    } catch (e) { /* 鏂囨。涓嶅瓨鍦?*/ }

    if (!storedValue) {
      // 鐧藉悕鍗曟湭璁惧畾 鈫?浠呯帇涓囧叏浠庣兢鍏ュ彛鍙縺娲?      if (userName === '鐜嬩竾鍏?) {
        try {
          await db.collection('activities').doc('_system_settings_store_group').set({
            data: { key: 'store_group_id', value: openGId, _system: true, createdBy: openid, createdAt: db.serverDate() },
          });
          console.log('[verifyStoreGroup] 鉁?鐜嬩竾鍏ㄦ縺娲婚棬搴楃兢鐧藉悕鍗?);
          return true;
        } catch (e) {
          console.error('[verifyStoreGroup] 瀛樺偍鐧藉悕鍗曞け璐?', e.message);
        }
      } else {
        console.log('[verifyStoreGroup] 鈿?鐧藉悕鍗曟湭璁惧畾锛屼粎鐜嬩竾鍏ㄤ粠缇ゅ叆鍙ｅ彲婵€娲?);
      }
      return false;
    }

    // 姣斿
    if (storedValue === 'manual_activated') {
      console.log('[verifyStoreGroup] 鎵嬪姩婵€娲绘ā寮忥紝璺宠繃缇D姣斿');
      return true;
    }
    const match = storedValue === openGId;
    console.log('[verifyStoreGroup] 姣斿:', match ? '鉁?鍖归厤' : '鉂?涓嶅尮閰?,
      ', 鏈熸湜:', storedValue, ', 瀹為檯:', openGId);
    return match;

  } catch (e) {
    console.error('[verifyStoreGroup] 瑙ｅ瘑楠岃瘉澶辫触:', e.message || e);
    return false;
  }
}

/* ========== 鐢ㄦ埛鍒楄〃锛堝惈鐘舵€佸瓧娈碉紝浠卆dmin鍙敤锛?========== */
async function listUsers() {
  try {
    const res = await db.collection('users')
      .field({ openid: false })
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    return { code: 0, data: res.data || [], message: 'success' };
  } catch (e) {
    return { code: -1, message: '鑾峰彇澶辫触' };
  }
}

/* ========== 璁剧疆鐢ㄦ埛鐘舵€?========== */
async function setUserStatus(event, operatorOpenid) {
  const { userId, status } = event;
  if (!userId || !status) return { code: -1, message: '鍙傛暟涓嶅叏' };
  // 浠?admin 鍙搷浣?  const opRes = await db.collection('users').where({ openid: operatorOpenid }).get();
  const op = opRes.data && opRes.data[0];
  if (!op || op.role !== 'admin') return { code: 403, message: '浠呯鐞嗗憳鍙搷浣? };

  await db.collection('users').doc(userId).update({
    data: { status, updatedAt: new Date() }
  });
  return { code: 0, message: status === 'inactive' ? '宸叉爣璁颁负绂昏亴' : '宸叉仮澶? };
}

