import { createContext, useContext } from 'react';

/** Reporting period shared by the admin pages ('7d' | '30d' | '90d' | '12m'). */
export const AdminPeriodContext = createContext({
  period: '30d',
  setPeriod: () => {}
});

export const useAdminPeriod = () => useContext(AdminPeriodContext);
