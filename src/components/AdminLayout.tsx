import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, CalendarCheck, DollarSign, QrCode, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { usePropertySwitcher } from '../auth/PropertySwitcherContext';

const ADMIN_NAV = [
  { to: '/admin/departments', label: 'Departments', icon: Building2, roles: ['property_admin', 'super_admin'] },
  { to: '/admin/people', label: 'People', icon: Users, roles: ['property_admin', 'super_admin'] },
  { to: '/admin/rooms', label: 'Rooms & QRs', icon: QrCode, roles: ['property_admin', 'super_admin'] },
  { to: '/admin/assignments', label: 'Assignments', icon: CalendarCheck, roles: ['property_admin', 'dept_manager', 'super_admin'] },
  { to: '/admin/tips', label: 'Tips Overview', icon: DollarSign, roles: ['property_admin', 'dept_manager', 'super_admin'] },
] as const;

export function AdminLayout({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();
  const { activeProperty, setActiveProperty } = usePropertySwitcher();
  const navigate = useNavigate();

  const visibleNav = ADMIN_NAV.filter((item) =>
    user ? (item.roles as readonly string[]).includes(user.role) : false
  );

  return (
    <div className="min-h-screen bg-[#F8F4EE] text-[#1C110A] flex flex-col">
      {user?.role === 'super_admin' && (
        <div className="bg-[#2D1B10] text-[#F5EBE0] border-b border-[#3A271B] px-6 py-2 text-xs flex items-center justify-between gap-3">
          <span>
            Viewing Property Console:{' '}
            <strong className="text-[#E6C79C]">
              {activeProperty?.name || 'Select a property from Platform Dashboard'}
            </strong>
          </span>
          <button
            type="button"
            onClick={() => {
              setActiveProperty(null);
              navigate('/super/dashboard');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#E6C79C]/15 border border-[#E6C79C]/35 px-2.5 py-1 font-medium text-[#E6C79C] hover:bg-[#E6C79C]/25 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Platform</span>
          </button>
        </div>
      )}

      <header className="bg-[#1C110A] text-[#FAF6F0] border-b border-[#3A271B] px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6 flex-wrap">
          <span className="serif-display text-lg font-semibold text-[#FAF6F0]">FrontDesk Tip</span>
          <nav aria-label="Property Admin Navigation" className="flex items-center gap-1 overflow-x-auto">
            {visibleNav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-[#E6C79C]/15 text-[#E6C79C] border border-[#E6C79C]/35'
                      : 'text-[#D6C7B8] hover:bg-[#FAF6F0]/10 hover:text-[#FAF6F0] border border-transparent'
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
        <span className="text-xs text-[#E6C79C]/90">{user?.name}</span>
      </header>

      <main className="flex-1 p-6 max-w-6xl w-full mx-auto space-y-4">
        <h1 className="serif-display text-2xl font-semibold text-[#1C110A]">{title}</h1>
        {children}
      </main>
    </div>
  );
}
