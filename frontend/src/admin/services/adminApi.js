/**
 * Clozflow Admin Intelligence — API Client
 * Interfaces with /api/admin endpoints using verified bearer authentication.
 */

const API_BASE = window.APP_API_BASE || 'http://localhost:8000';

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse(response) {
  if (response.status === 401) {
    throw new Error('Authentication required');
  }
  if (response.status === 403) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Administrative authorization required');
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Request failed with status ${response.status}`);
  }
  return response.json();
}

export const adminApi = {
  // Identity & Auth Verification
  getMe: async () => {
    const res = await fetch(`${API_BASE}/api/admin/me`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // Overview Dashboard
  getOverview: async (period = '30d', startDate = null, endDate = null) => {
    let url = `${API_BASE}/api/admin/overview?period=${encodeURIComponent(period)}`;
    if (startDate && endDate) {
      url += `&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
    }
    const res = await fetch(url, { headers: getAuthHeaders() });
    return handleResponse(res);
  },

  // User Analytics
  getUserAnalytics: async (period = '30d') => {
    const res = await fetch(`${API_BASE}/api/admin/analytics/users?period=${encodeURIComponent(period)}`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // Revenue Analytics
  getRevenueAnalytics: async (period = '30d', currency = 'INR') => {
    const res = await fetch(
      `${API_BASE}/api/admin/analytics/revenue?period=${encodeURIComponent(period)}&currency=${encodeURIComponent(currency)}`,
      { headers: getAuthHeaders() }
    );
    return handleResponse(res);
  },

  // Retention Cohorts
  getRetentionAnalytics: async () => {
    const res = await fetch(`${API_BASE}/api/admin/analytics/retention`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // User Management Table
  getUsers: async ({ search = '', status = '', role = '', isPaying = null, page = 1, pageSize = 25 } = {}) => {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString()
    });
    if (search) params.append('search', search);
    if (status) params.append('status', status);
    if (role) params.append('role', role);
    if (isPaying !== null && isPaying !== undefined && isPaying !== '') {
      params.append('is_paying', isPaying.toString());
    }
    const res = await fetch(`${API_BASE}/api/admin/users?${params.toString()}`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // User Customer 360 Detail
  getUserDetail: async (userId) => {
    const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // Mutate User Account Status (suspend/activate)
  updateUserStatus: async (userId, accountStatus, reason = '') => {
    const res = await fetch(`${API_BASE}/api/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ account_status: accountStatus, reason })
    });
    return handleResponse(res);
  },

  // Mutate User Role (super_admin only)
  updateUserRole: async (userId, adminRole, isAdmin, reason = '') => {
    const res = await fetch(`${API_BASE}/api/admin/users/${userId}/role`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ admin_role: adminRole, is_admin: isAdmin, reason })
    });
    return handleResponse(res);
  },

  // Adjust PAYG User Credits
  adjustCredits: async (userId, amount, reason, type = 'adjustment') => {
    const res = await fetch(`${API_BASE}/api/admin/users/${userId}/adjust-credits`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ amount: parseInt(amount, 10), reason, type })
    });
    return handleResponse(res);
  },

  // Subscriptions Table
  getSubscriptions: async ({ status = '', plan = '', page = 1, pageSize = 25 } = {}) => {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString()
    });
    if (status) params.append('status', status);
    if (plan) params.append('plan', plan);
    const res = await fetch(`${API_BASE}/api/admin/subscriptions?${params.toString()}`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // Orders Table
  getOrders: async ({ status = '', page = 1, pageSize = 25 } = {}) => {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString()
    });
    if (status) params.append('status', status);
    const res = await fetch(`${API_BASE}/api/admin/orders?${params.toString()}`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // Payments Table
  getPayments: async ({ status = '', page = 1, pageSize = 25 } = {}) => {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString()
    });
    if (status) params.append('status', status);
    const res = await fetch(`${API_BASE}/api/admin/payments?${params.toString()}`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // Product Usage
  getUsage: async () => {
    const res = await fetch(`${API_BASE}/api/admin/usage`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // Pearl AI Telemetry & Unit Economics
  getPearlMetrics: async (period = '30d') => {
    const res = await fetch(`${API_BASE}/api/admin/pearl?period=${encodeURIComponent(period)}`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // Audit Logs
  getAuditLogs: async ({ action = '', resourceType = '', adminEmail = '', page = 1, pageSize = 50 } = {}) => {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString()
    });
    if (action) params.append('action', action);
    if (resourceType) params.append('resource_type', resourceType);
    if (adminEmail) params.append('admin_email', adminEmail);
    const res = await fetch(`${API_BASE}/api/admin/audit-logs?${params.toString()}`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // CSV Export Trigger
  downloadExport: async (resource) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}/api/admin/export/${resource}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) {
      throw new Error(`Export failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clozflow_${resource}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }
};
