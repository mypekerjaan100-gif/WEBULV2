export const ACTION_TO_OPERATION = {
  list_users: "LIST_USERS",
  invite_user: "INVITE_USER",
  assign_membership: "ASSIGN_MEMBERSHIP",
  revoke_membership: "REVOKE_MEMBERSHIP",
  assign_role: "ASSIGN_ROLE",
  revoke_role: "REVOKE_ROLE",
  disable_user: "DISABLE_USER",
  enable_user: "ENABLE_USER",
} as const;

export type UserManagementAction = keyof typeof ACTION_TO_OPERATION;

export interface UserManagementRequest {
  action: "capabilities" | UserManagementAction;
  targetUserId?: string;
  targetRoleCode?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}

export function parseRequest(value: unknown): UserManagementRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Request body must be an object");
  }
  const request = value as Record<string, unknown>;
  if (typeof request.action !== "string") {
    throw new Error("Action is required");
  }
  if (
    request.action !== "capabilities" &&
    !Object.hasOwn(ACTION_TO_OPERATION, request.action)
  ) {
    throw new Error("Unsupported action");
  }
  for (const field of ["targetUserId", "targetRoleCode", "reason"] as const) {
    if (request[field] != null && typeof request[field] !== "string") {
      throw new Error(`${field} must be a string`);
    }
  }
  if (
    request.payload != null &&
    (typeof request.payload !== "object" || Array.isArray(request.payload))
  ) {
    throw new Error("payload must be an object");
  }
  return request as unknown as UserManagementRequest;
}
