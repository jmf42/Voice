import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useMemo, type PropsWithChildren } from 'react';
import { logout } from '../auth.js';
import { useTenant } from '../tenant.js';
import { Icon } from './Icon.js';

const NAV_ITEMS = [
  { to: '/dashboard', icon: 'chart', label: 'Home' },
  { to: '/calendar', icon: 'calendar', label: 'Calendar' },
  { to: '/settings', icon: 'settings', label: 'Settings' },
] as const;

export function Layout({ children }: PropsWithChildren) {
  const { settings, role } = useTenant();
  const navigate = useNavigate();

  const allowedNavItems = useMemo(() => {
    if (role === 'client_admin') {
      return NAV_ITEMS.filter((item) => ['/dashboard', '/calendar', '/settings'].includes(item.to));
    }
    return NAV_ITEMS;
  }, [role]);

  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" to="/dashboard">
          <span className="brand-icon">
            <Icon name="zap" size={16} />
          </span>
          Voice
        </Link>

        <nav className="topbar-nav" aria-label="Primary">
          {allowedNavItems.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `topbar-link${isActive ? ' active' : ''}`}
            >
              <Icon name={icon} size={15} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="topbar-actions">
          <p className={`status-chip ${settings?.enabled ? 'on' : 'off'}`}>
            {settings?.enabled ? 'AI active' : 'AI paused'}
          </p>
          <button
            className="btn-logout"
            onClick={() => {
              logout();
              navigate('/login', { replace: true });
            }}
          >
            <Icon name="logout" size={14} />
            <span className="logout-label">Sign out</span>
          </button>
        </div>
      </header>

      <main className="page-stack shell-main">{children}</main>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {allowedNavItems.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
          >
            <Icon name={icon} size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
