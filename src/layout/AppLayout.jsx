import { useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Header from '../components/Header.jsx'

export default function AppLayout({ activeContractId, currentPage, onNavigate, onNavigatePage, preview, approvalNotifications, approvalNotificationError, onRefreshApprovalNotifications, onOpenApprovalNotification, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        open={sidebarOpen}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        activeContractId={activeContractId}
        currentPage={currentPage}
        onNavigate={(id) => {
          onNavigate(id)
          closeSidebar()
        }}
        onNavigatePage={(id) => {
          onNavigatePage(id)
          closeSidebar()
        }}
        onClose={closeSidebar}
      />
      <div className="app-main">
        <Header
          onOpenSidebar={() => setSidebarOpen(true)}
          preview={preview}
          approvalNotifications={approvalNotifications}
          approvalNotificationError={approvalNotificationError}
          onRefreshApprovalNotifications={onRefreshApprovalNotifications}
          onOpenApprovalNotification={onOpenApprovalNotification}
        />
        <main className="app-content">{children}</main>
      </div>
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={closeSidebar} />
      )}
    </div>
  )
}
