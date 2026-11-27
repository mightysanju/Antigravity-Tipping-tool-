import { useNavigate } from 'react-router-dom';
import { DEV_PERSONAS, useAuth, type DevPersonaKey } from '../auth/AuthContext';
import { getRoleHomeRoute } from '../shared/types';

export function DevPersonaBar() {
  const { devPersona, switchDevPersona } = useAuth();
  const navigate = useNavigate();

  if (!import.meta.env.DEV) return null;

  function handleChange(next: DevPersonaKey) {
    switchDevPersona(next);
    if (next === 'signed_out') {
      navigate('/login');
    } else {
      navigate(getRoleHomeRoute(DEV_PERSONAS[next].role));
    }
  }

  return (
    <aside
      aria-label="Local Development Persona Switcher"
      className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-xl bg-[#111827] text-white border border-[#374151] px-3 py-1.5 text-xs shadow-lg"
    >
      <span className="font-medium text-[#D1D5DB]">Dev Persona</span>
      <select
        aria-label="Select local development role"
        value={devPersona}
        onChange={(e) => handleChange(e.target.value as DevPersonaKey)}
        className="rounded-md bg-[#1F2937] border border-[#4B5563] px-2 py-1 text-xs text-white outline-none cursor-pointer"
      >
        <option value="super_admin">Super Admin</option>
        <option value="admin_paloma">Property Admin · Casa Paloma</option>
        <option value="admin_harbor">Property Admin · Harborline</option>
        <option value="dept_manager">Dept Manager · Sophia</option>
        <option value="staff_maria">Staff · Maria Garcia</option>
        <option value="signed_out">Signed Out</option>
      </select>
    </aside>
  );
}
