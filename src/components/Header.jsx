import { useEffect, useRef, useState } from 'react'
import SlaPreviewBar from './sla/SlaPreviewBar.jsx'
import { useAuth } from '../lib/AppAuth.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import Icon from './Icon.jsx'

export default function Header({ onOpenSidebar, preview, approvalNotifications, approvalNotificationError, onRefreshApprovalNotifications, onOpenApprovalNotification }) {
  const { authority, signOut } = useAuth()
  const { preference, setPreference } = useTheme()
  const [signingOut, setSigningOut] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const themeRef = useRef(null)
  const notificationRef = useRef(null)
  const isSuperAdmin = authority?.actor?.is_super_admin === true
  const contractAccess = authority?.actor?.contract_access?.[0] ?? null
  const orgAccess = authority?.actor?.organization_access?.[0] ?? null
  const activeAccess = contractAccess ?? orgAccess
  const loginRole = isSuperAdmin
    ? 'SUPER_ADMIN'
    : activeAccess?.role ?? activeAccess?.organization_role ?? 'Akses terverifikasi'
  const scopeLabel = activeAccess?.role === 'ADMIN_ULP'
    ? activeAccess.operational_unit_name
    : activeAccess?.operational_up3_name ?? activeAccess?.operational_unit_name ?? activeAccess?.internal_org_unit_name ?? null
  const pendingCount = approvalNotifications?.count ?? 0
  const hasSourceError = approvalNotifications?.groups?.some((group) => group.error) ?? false

  useEffect(() => {
    if (!themeOpen && !notificationOpen) return undefined
    const close = (event) => {
      if (themeOpen && !themeRef.current?.contains(event.target)) setThemeOpen(false)
      if (notificationOpen && !notificationRef.current?.contains(event.target)) setNotificationOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [themeOpen, notificationOpen])

  useEffect(() => {
    if (!themeOpen) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setThemeOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [themeOpen])

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    setSigningOut(false)
  }

  const toggleNotifications = () => {
    if (!notificationOpen) onRefreshApprovalNotifications?.()
    setNotificationOpen((open) => !open)
  }

  return (
    <header className="header">
      <button
        type="button"
        className="header-menu-button"
        onClick={onOpenSidebar}
        aria-label="Buka menu"
      >
        <Icon name="menu" />
      </button>
      <div className="header-right">
        <div className="theme-control-wrap" ref={themeRef}>
          <button
            type="button"
            className="theme-control"
            aria-label="Tema tampilan"
            aria-haspopup="menu"
            aria-expanded={themeOpen}
            onClick={() => setThemeOpen((open) => !open)}
            title="Tema tampilan"
          >
            <Icon name={preference === 'light' ? 'sun' : preference === 'dark' ? 'moon' : 'monitor'} size={15} />
            <span className="theme-control-label">{preference === 'light' ? 'Light' : preference === 'dark' ? 'Dark' : 'System'}</span>
            <Icon name="chevron-right" size={12} className="theme-control-chevron" />
          </button>
          {themeOpen && (
            <div className="theme-menu" role="menu" aria-label="Pilih tema">
              {[
                { value: 'light', label: 'Light', icon: 'sun' },
                { value: 'dark', label: 'Dark', icon: 'moon' },
                { value: 'system', label: 'System', icon: 'monitor' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={preference === option.value}
                  className={`theme-menu-item${preference === option.value ? ' theme-menu-item-active' : ''}`}
                  onClick={() => {
                    setPreference(option.value)
                    setThemeOpen(false)
                  }}
                >
                  <Icon name={option.icon} size={14} />
                  <span>{option.label}</span>
                  {preference === option.value && <Icon name="check" size={14} className="theme-menu-check" />}
                </button>
              ))}
            </div>
          )}
        </div>
        {approvalNotifications && (
          <div className="approval-notification" ref={notificationRef}>
            <button
              type="button"
              className="approval-notification-trigger"
              aria-label={`Persetujuan menunggu: ${pendingCount}`}
              aria-expanded={notificationOpen}
              onClick={toggleNotifications}
            >
              <Icon name="bell" />
              {pendingCount > 0 && <span className="approval-notification-badge">{pendingCount}</span>}
            </button>
            {notificationOpen && (
              <div className="approval-notification-panel">
                <div className="approval-notification-heading">
                  <div><strong>Menunggu Persetujuan</strong><span>{pendingCount} item aktif</span></div>
                  <button type="button" onClick={onRefreshApprovalNotifications}>Muat ulang</button>
                </div>
                {approvalNotificationError ? <p className="approval-notification-empty">{approvalNotificationError}</p> : pendingCount === 0 && !hasSourceError ? (
                  <p className="approval-notification-empty">Tidak ada persetujuan yang menunggu.</p>
                ) : approvalNotifications.groups.map((group) => (
                  <section className="approval-notification-group" key={group.id}>
                    <div className="approval-notification-group-title"><strong>{group.label}</strong><span>{group.count}</span></div>
                    {group.items.slice(0, 5).map((item) => (
                      <button type="button" className="approval-notification-item" data-approval-source={item.source} data-approval-id={item.id} key={`${item.source}:${item.id}`} onClick={() => { setNotificationOpen(false); onOpenApprovalNotification(item) }}>
                        <strong>{item.title}</strong>
                        <span>{item.unitName}{item.date ? ` · ${item.date}` : ''}</span>
                      </button>
                    ))}
                    {group.error ? <span className="approval-notification-group-error">{group.error}</span> : group.count === 0 && <span className="approval-notification-group-empty">Tidak ada item.</span>}
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
        <span className="header-login-status">
          {loginRole}
        </span>
        {scopeLabel && <span className="header-scope-status">{scopeLabel}</span>}
        {isSuperAdmin && preview && <SlaPreviewBar preview={preview} />}
        <button
          type="button"
          className="header-logout-button"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? 'Keluar...' : 'Keluar'}
        </button>
        <div className="header-placeholder" style={{ display: 'none' }} aria-hidden="true"></div>
      </div>
    </header>
  )
}
