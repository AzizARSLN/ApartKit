export const SystemRole = {
  SUPER_ADMIN: "SUPER_ADMIN",
  TENANT_ADMIN: "TENANT_ADMIN",
  SITE_MANAGER: "SITE_MANAGER",
  ACCOUNTANT: "ACCOUNTANT",
  BOARD_MEMBER: "BOARD_MEMBER",
  AUDITOR: "AUDITOR",
  EMPLOYEE: "EMPLOYEE",
  OWNER: "OWNER",
  RENTER: "RENTER",
} as const;

export type SystemRole = (typeof SystemRole)[keyof typeof SystemRole];

export const Permission = {
  TENANT_READ: "tenant:read",
  TENANT_WRITE: "tenant:write",
  SITE_READ: "site:read",
  SITE_WRITE: "site:write",
  UNIT_READ: "unit:read",
  UNIT_WRITE: "unit:write",
  PERSON_READ: "person:read",
  PERSON_WRITE: "person:write",
  CHARGE_PREVIEW: "charge:preview",
  CHARGE_CREATE: "charge:create",
  CHARGE_CANCEL: "charge:cancel",
  PAYMENT_PREVIEW: "payment:preview",
  PAYMENT_CREATE: "payment:create",
  PAYMENT_REVERSE: "payment:reverse",
  BANKING_IMPORT: "banking:import",
  BANKING_RECONCILE: "banking:reconcile",
  BANKING_COLLECT: "banking:collect",
  EXPENSE_WRITE: "expense:write",
  CASH_WRITE: "cash:write",
  REPORT_FINANCE: "report:finance",
  EMPLOYEE_MANAGE: "employee:manage",
  LEAVE_APPROVE: "leave:approve",
  TICKET_MANAGE: "ticket:manage",
  ANNOUNCEMENT_WRITE: "announcement:write",
  AUDIT_READ: "audit:read",
  USER_MANAGE: "user:manage",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL_READ_WRITE: Permission[] = Object.values(Permission);

const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  SUPER_ADMIN: ALL_READ_WRITE,
  TENANT_ADMIN: ALL_READ_WRITE,
  SITE_MANAGER: [
    Permission.SITE_READ,
    Permission.SITE_WRITE,
    Permission.UNIT_READ,
    Permission.UNIT_WRITE,
    Permission.PERSON_READ,
    Permission.PERSON_WRITE,
    Permission.CHARGE_PREVIEW,
    Permission.CHARGE_CREATE,
    Permission.CHARGE_CANCEL,
    Permission.PAYMENT_PREVIEW,
    Permission.PAYMENT_CREATE,
    Permission.PAYMENT_REVERSE,
    Permission.BANKING_IMPORT,
    Permission.BANKING_RECONCILE,
    Permission.BANKING_COLLECT,
    Permission.EXPENSE_WRITE,
    Permission.CASH_WRITE,
    Permission.REPORT_FINANCE,
    Permission.EMPLOYEE_MANAGE,
    Permission.LEAVE_APPROVE,
    Permission.TICKET_MANAGE,
    Permission.ANNOUNCEMENT_WRITE,
    Permission.AUDIT_READ,
    Permission.USER_MANAGE,
  ],
  ACCOUNTANT: [
    Permission.SITE_READ,
    Permission.UNIT_READ,
    Permission.PERSON_READ,
    Permission.CHARGE_PREVIEW,
    Permission.CHARGE_CREATE,
    Permission.CHARGE_CANCEL,
    Permission.PAYMENT_PREVIEW,
    Permission.PAYMENT_CREATE,
    Permission.PAYMENT_REVERSE,
    Permission.BANKING_IMPORT,
    Permission.BANKING_RECONCILE,
    Permission.BANKING_COLLECT,
    Permission.EXPENSE_WRITE,
    Permission.CASH_WRITE,
    Permission.REPORT_FINANCE,
    Permission.AUDIT_READ,
  ],
  BOARD_MEMBER: [
    Permission.SITE_READ,
    Permission.UNIT_READ,
    Permission.PERSON_READ,
    Permission.REPORT_FINANCE,
    Permission.ANNOUNCEMENT_WRITE,
    Permission.AUDIT_READ,
  ],
  AUDITOR: [
    Permission.SITE_READ,
    Permission.UNIT_READ,
    Permission.PERSON_READ,
    Permission.REPORT_FINANCE,
    Permission.AUDIT_READ,
  ],
  EMPLOYEE: [Permission.SITE_READ, Permission.TICKET_MANAGE],
  OWNER: [Permission.SITE_READ, Permission.UNIT_READ],
  RENTER: [Permission.SITE_READ, Permission.UNIT_READ],
};

export function permissionsForRoles(roles: SystemRole[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const p of ROLE_PERMISSIONS[role] ?? []) {
      set.add(p);
    }
  }
  return set;
}

export function hasPermission(roles: SystemRole[], permission: Permission): boolean {
  return permissionsForRoles(roles).has(permission);
}
