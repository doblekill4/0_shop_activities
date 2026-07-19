// services/admin.js - 权限组 & 部门群组管理服务层（云开发版）
const { callCloudFunc } = require('../utils/request');

/* ========== 权限组 ========== */
const getPermissionGroups = () => callCloudFunc('admin', { action: 'getPermissionGroups' });
const createPermissionGroup = (data) => callCloudFunc('admin', { action: 'createPermissionGroup', data });
const updatePermissionGroup = (id, data) => callCloudFunc('admin', { action: 'updatePermissionGroup', id, data });
const deletePermissionGroup = (id) => callCloudFunc('admin', { action: 'deletePermissionGroup', id });

/* ========== 部门群组 ========== */
const getDepartments = () => callCloudFunc('admin', { action: 'getDepartments' });
const createDepartment = (data) => callCloudFunc('admin', { action: 'createDepartment', data });
const updateDepartment = (id, data) => callCloudFunc('admin', { action: 'updateDepartment', id, data });
const deleteDepartment = (id) => callCloudFunc('admin', { action: 'deleteDepartment', id });

/* ========== 用户管理 ========== */
const getUsers = () => callCloudFunc('admin', { action: 'getUsers' });
const updateUser = (id, data) => callCloudFunc('admin', { action: 'updateUser', id, data });

module.exports = {
  getPermissionGroups,
  createPermissionGroup,
  updatePermissionGroup,
  deletePermissionGroup,
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getUsers,
  updateUser,
};
