import { useEffect, useRef, useState } from 'react'
import { contracts, siteTitle } from '../data/contracts.js'
import SlaPreviewBar from './sla/SlaPreviewBar.jsx'
import { useAuth } from '../lib/AppAuth.jsx'

const PAGE_TITLES = {
  'pengguna-akses': 'Pengguna & Akses',
}

export default function Header({ activeContractId, currentPage, onOpenSidebar, preview, approvalNotifications, approvalNotificationError, onRefreshApprovalNotifications, onOpenApprovalNotification }) {
  const { authority, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const notificationRef = useRef(null)
  const isSuperAdmin = authority?.actor?.is_super_admin === true
  const activeAccess = authority?.actor?.active_access ?? authority?.actor?.contract_access?.[0] ?? null
  const loginRole = isSuperAdmin
    ? 'SUPER_ADMIN'
    : activeAccess?.role ?? 'Akses terverifikasi'
  const scopeLabel = activeAccess?.role === 'ADMIN_UP3'
    ? activeAccess.operational_up3_name
    : activeAccess?.role === 'ADMIN_ULP'
      ? activeAccess.operational_unit_name
      : null
  const activeContract = contracts.find(
    (contract) => contract.id === activeContractId,
  )
  const pendingCount = approvalNotifications?.count ?? 0
  const hasSourceError = approvalNotifications?.groups?.some((group) => group.error) ?? false

  useEffect(() => {
    if (!notificationOpen) return undefined
    const close = (event) => {
      if (!notificationRef.current?.contains(event.target)) setNotificationOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [notificationOpen])

  const title = currentPage
    ? (PAGE_TITLES[currentPage] || currentPage)
    : activeContract
      ? activeContract.title
      : 'Dashboard'

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
        &#9776;
      </button>
      <div className="header-title">
        <span className="header-title-main">{title}</span>
        <span className="header-title-sub">{siteTitle}</span>
      </div>
      <div className="header-right">
        {approvalNotifications && (
          <div className="approval-notification" ref={notificationRef}>
            <button
              type="button"
              className="approval-notification-trigger"
              aria-label={`Persetujuan menunggu: ${pendingCount}`}
              aria-expanded={notificationOpen}
              onClick={toggleNotifications}
            >
              <span aria-hidden="true">&#128276;</span>
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
          Login: {loginRole}
        </span>
        {scopeLabel && <span className="header-scope-status">Scope: {scopeLabel}</span>}
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
