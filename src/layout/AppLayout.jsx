import { useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Header from '../components/Header.jsx'

export default function AppLayout({ activeContractId, currentPage, onNavigate, onNavigatePage, preview, approvalNotifications, approvalNotificationError, onRefreshApprovalNotifications, onOpenApprovalNotification, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="app-shell">
      <Sidebar
        open={sidebarOpen}
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
          activeContractId={activeContractId}
          currentPage={currentPage}
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
