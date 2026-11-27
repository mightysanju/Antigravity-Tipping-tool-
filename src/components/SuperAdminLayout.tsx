import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Building2,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { usePropertySwitcher } from '../auth/PropertySwitcherContext';
import { callSuperAdmin } from '../lib/apiClient';

interface SwitcherProp {
  id: string;
  name: string;
  status: string;
}

const NAV_ITEMS = [
  { to: '/super/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/super/properties', label: 'Properties', icon: Building2 },
  { to: '/super/payments', label: 'Payments', icon: CreditCard },
  { to: '/super/admins', label: 'Property Admins', icon: Users },
  { to: '/super/integrations', label: 'Integrations', icon: KeyRound },
] as const;

export function SuperAdminLayout({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, signOut } = useAuth();
  const { activeProperty, setActiveProperty } = usePropertySwitcher();
  const navigate = useNavigate();
  const [properties, setProperties] = useState<SwitcherProp[]>([]);

  useEffect(() => {
    let mounted = true;
    callSuperAdmin<{ properties?: SwitcherProp[] }>({ action: 'dashboard' })
      .then((res) => {
        if (mounted && Array.isArray(res.properties)) {
          setProperties(res.properties);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  function handleSwitchProperty(propertyId: string) {
    if (!propertyId) {
      setActiveProperty(null);
      return;
    }
    const found = properties.find((p) => p.id === propertyId);
    if (!found) return;
    setActiveProperty({ id: found.id, name: found.name });
    navigate('/admin/departments');
  }

  return (
    <div className="min-h-screen bg-[#F8F4EE] text-[#1C110A] flex flex-col md:flex-row">
      {/* Sidebar (Warm Resort Espresso) */}
      <aside className="w-full md:w-60 shrink-0 bg-[#1C110A] text-[#FAF6F0] border-b md:border-b-0 md:border-r border-[#3A271B] flex flex-col justify-between p-4">
        <div className="space-y-6">
          <div className="px-2">
            <span className="serif-display text-lg font-semibold tracking-tight text-[#FAF6F0]">
              FrontDesk Tip
            </span>
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#E6C79C] mt-0.5">
              Super Admin Console
            </p>
          </div>

          <nav aria-label="Super Admin Navigation" className="flex md:flex-col gap-1 overflow-x-auto">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-[#E6C79C]/15 text-[#E6C79C] border border-[#E6C79C]/35'
                      : 'text-[#D6C7B8] hover:text-[#FAF6F0] hover:bg-[#FAF6F0]/10 border border-transparent'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="hidden md:flex items-center justify-between pt-4 border-t border-[#3A271B] px-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#FAF6F0] truncate">{user?.name}</p>
            <p className="text-xs text-[#D6C7B8]/80 truncate">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            title="Sign out"
            className="p-1.5 rounded-lg text-[#D6C7B8] hover:text-[#FAF6F0] hover:bg-[#FAF6F0]/10 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-[#FAF6F0]/90 backdrop-blur border-b border-[#E7DDD0] px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <h1 className="serif-display text-2xl font-semibold tracking-tight text-[#1C110A]">
            {title}
          </h1>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-[#5C4B3E]">
              <span className="font-medium">Property Switcher</span>
              <select
                aria-label="Open property admin view"
                value={activeProperty?.id ?? ''}
                onChange={(e) => handleSwitchProperty(e.target.value)}
                className="rounded-xl border border-[#D8CBB8] bg-white px-2.5 py-1.5 text-xs font-medium text-[#1C110A] outline-none focus:border-[#B8863B] cursor-pointer"
              >
                <option value="">Platform Overview</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.status})
                  </option>
                ))}
              </select>
            </label>
            {actions}
          </div>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">{children}</main>
      </div>
    </div>
  );
}
