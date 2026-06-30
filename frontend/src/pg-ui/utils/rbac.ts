type PermissionValue = boolean | string | number | { scope?: unknown } | null | undefined
type PermissionMap = Record<string, Record<string, PermissionValue>>

const RESOURCE_ALIASES: Record<string, string[]> = {
  roles: ['roles', 'admin_roles'],
  admin_roles: ['admin_roles', 'roles'],
  clients: ['users'],
}

const ACTION_ALIASES: Record<string, string[]> = {
  view: ['view', 'read'],
  read: ['read', 'view'],
  viewSimple: ['viewSimple', 'read_simple'],
  read_simple: ['read_simple', 'viewSimple'],
  viewGeneral: ['viewGeneral', 'read_general'],
  read_general: ['read_general', 'viewGeneral'],
  resetUsage: ['resetUsage', 'reset_usage'],
  reset_usage: ['reset_usage', 'resetUsage'],
  revokeSubscription: ['revokeSubscription', 'revoke_sub'],
  revoke_sub: ['revoke_sub', 'revokeSubscription'],
  activateNextPlan: ['activateNextPlan', 'activate_next_plan'],
  activate_next_plan: ['activate_next_plan', 'activateNextPlan'],
  adminFilter: ['adminFilter', 'admin_filter'],
  admin_filter: ['admin_filter', 'adminFilter'],
  setOwner: ['setOwner', 'set_owner'],
  set_owner: ['set_owner', 'setOwner'],
  updateCore: ['updateCore', 'update_core'],
  update_core: ['update_core', 'updateCore'],
  viewStatistics: ['viewStatistics', 'stats'],
  stats: ['stats', 'viewStatistics'],
  viewLogs: ['viewLogs', 'logs'],
  logs: ['logs', 'viewLogs'],
}

type RoutePermission = {
  resource: string
  action: string
}

const ROUTE_PERMISSIONS: Record<string, RoutePermission[]> = {
  '/': [{ resource: 'system', action: 'read' }],
  '/inbounds': [{ resource: 'inbounds', action: 'read' }],
  '/clients': [{ resource: 'users', action: 'read' }],
  '/groups': [{ resource: 'groups', action: 'read' }],
  '/nodes': [{ resource: 'nodes', action: 'read' }],
  '/admins': [{ resource: 'admins', action: 'read' }],
  '/admin-roles': [{ resource: 'admin_roles', action: 'read' }],
  '/outbound': [{ resource: 'outbounds', action: 'read' }],
  '/routing': [{ resource: 'routing', action: 'read' }],
  '/settings': [{ resource: 'settings', action: 'read' }],
  '/xray': [{ resource: 'cores', action: 'read' }],
  '/hosts': [{ resource: 'hosts', action: 'read' }],
}

const FALLBACK_ROUTE = '/api-docs'

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function resourceKeys(resource: string) {
  return unique([resource, ...(RESOURCE_ALIASES[resource] || [])])
}

function actionKeys(action: string) {
  return unique([action, ...(ACTION_ALIASES[action] || [])])
}

function parseMaybeJSON(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function permissionsOf(value: any): PermissionMap {
  const candidates = [
    value?.role?.permissions,
    value?.role?.permissions_json,
    value?.role?.permissionsJSON,
    value?.permissions,
    value?.permissions_json,
    value?.permissionsJSON,
    value?.rolePermissions,
  ]

  for (const candidate of candidates) {
    const parsed = parseMaybeJSON(candidate)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PermissionMap
    }
  }

  return {}
}

function permissionValueAllowed(value: PermissionValue): boolean {
  if (value === true) return true
  if (value === false || value == null) return false
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return ['true', 'yes', '1', 'own', 'all', '2'].includes(normalized)
  }
  if (typeof value === 'object') {
    return permissionValueAllowed((value as { scope?: PermissionValue }).scope)
  }
  return false
}

function permissionValueScopeAll(value: PermissionValue): boolean {
  if (value === true) return true
  if (value === false || value == null) return false
  if (typeof value === 'number') return value === 2
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'all' || normalized === '2' || normalized === 'true' || normalized === 'yes'
  }
  if (typeof value === 'object') {
    return permissionValueScopeAll((value as { scope?: PermissionValue }).scope)
  }
  return false
}

function findPermissionValue(admin: any, resource: string, action: string): PermissionValue {
  const permissions = permissionsOf(admin)
  for (const resourceKey of resourceKeys(resource)) {
    const section = permissions[resourceKey]
    if (!section || typeof section !== 'object') continue
    for (const actionKey of actionKeys(action)) {
      if (Object.prototype.hasOwnProperty.call(section, actionKey)) {
        return section[actionKey]
      }
    }
  }
  return undefined
}

export function isOwner(value: any): boolean {
  return Boolean(
    value?.role?.is_owner ||
      value?.role?.owner_role ||
      value?.role?.ownerRole ||
      value?.role?.slug === 'owner' ||
      value?.roleSlug === 'owner' ||
      value?.is_owner ||
      value?.ownerRole ||
      value?.slug === 'owner'
  )
}

export function roleLabel(value: any): string {
  if (typeof value === 'string') return value
  return value?.role?.name || value?.roleName || value?.name || 'Admin'
}

export function hasPermission(admin: any, resource: string, action: string): boolean {
  if (isOwner(admin)) return true
  return permissionValueAllowed(findPermissionValue(admin, resource, action))
}

export function hasScopeAll(admin: any, resource: string, action: string): boolean {
  if (isOwner(admin)) return true
  return permissionValueScopeAll(findPermissionValue(admin, resource, action))
}

export function canReadResourcePage(admin: any, resource: string): boolean {
  return hasPermission(admin, resource, 'read') || hasPermission(admin, resource, 'view')
}

function routeKey(pathname: string) {
  const path = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/'
  if (path === '/api-docs') return '/api-docs'
  if (path.startsWith('/settings')) return '/settings'
  if (path.startsWith('/xray')) return '/xray'
  if (path.startsWith('/outbound')) return '/outbound'
  if (path.startsWith('/routing')) return '/routing'
  if (path.startsWith('/admin-roles')) return '/admin-roles'
  if (path.startsWith('/inbounds')) return '/inbounds'
  if (path.startsWith('/clients')) return '/clients'
  if (path.startsWith('/groups')) return '/groups'
  if (path.startsWith('/nodes')) return '/nodes'
  if (path.startsWith('/admins')) return '/admins'
  if (path.startsWith('/hosts')) return '/hosts'
  return path
}

export function canAccessRoute(admin: any, pathname: string): boolean {
  const key = routeKey(pathname)
  if (key === '/api-docs') return true
  const requirements = ROUTE_PERMISSIONS[key]
  if (!requirements) return true
  return requirements.some(req => hasPermission(admin, req.resource, req.action))
}

export function firstAllowedRoute(admin: any): string {
  const orderedRoutes = ['/', '/inbounds', '/clients', '/groups', '/nodes', '/admins', '/admin-roles', '/outbound', '/routing', '/settings', '/xray', '/hosts']
  return orderedRoutes.find(route => canAccessRoute(admin, route)) || FALLBACK_ROUTE
}
