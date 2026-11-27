import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Plus, QrCode, Search, X } from 'lucide-react';
import { AdminLayout } from '../../components/AdminLayout';
import { useAuth } from '../../auth/AuthContext';
import { usePropertySwitcher } from '../../auth/PropertySwitcherContext';
import { callAdminDirectory } from '../../lib/apiClient';

interface PersonRow {
  id: string;
  name: string;
  email: string;
  role: 'property_admin' | 'dept_manager' | 'staff';
  departmentId: string | null;
  departmentName: string | null;
  status: 'active' | 'inactive';
  authLinked: boolean;
}

interface DepartmentOption {
  id: string;
  name: string;
}

export function AdminPeoplePage() {
  const { user } = useAuth();
  const { activeProperty } = usePropertySwitcher();
  const propertyId =
    user?.role === 'super_admin' ? activeProperty?.id ?? null : user?.propertyId ?? null;

  const [people, setPeople] = useState<PersonRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add Person Drawer
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'staff' | 'dept_manager'>('staff');
  const [newDeptId, setNewDeptId] = useState('');

  // Join QR Modal
  const [joinQrDataUrl, setJoinQrDataUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      const [pplRes, deptRes] = await Promise.all([
        callAdminDirectory<{ people: PersonRow[]; toggles: Record<string, boolean> }>({
          action: 'list_people',
          propertyId,
        }),
        callAdminDirectory<{ departments: DepartmentOption[] }>({
          action: 'list_departments',
          propertyId,
        }),
      ]);
      setPeople(pplRes.people || []);
      setToggles(pplRes.toggles || {});
      setDepartments(deptRes.departments || []);
      if (!newDeptId && deptRes.departments?.[0]) {
        setNewDeptId(deptRes.departments[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load people');
    }
  }, [propertyId, newDeptId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAddPerson(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId) return;
    setError(null);
    setNotice(null);
    try {
      const res = await callAdminDirectory<{ emailSent: boolean }>({
        action: 'create_person',
        propertyId,
        name: newName,
        email: newEmail,
        role: newRole,
        departmentId: newDeptId,
      });
      setNotice(
        res.emailSent
          ? `Added ${newName} and sent invite email.`
          : `Added ${newName} (invite email toggle disabled).`
      );
      setNewName('');
      setNewEmail('');
      setAddOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create person');
    }
  }

  async function handleMoveDept(personId: string, departmentId: string) {
    setError(null);
    try {
      await callAdminDirectory({ action: 'update_person', personId, departmentId });
      setSavedId(personId);
      setTimeout(() => setSavedId((cur) => (cur === personId ? null : cur)), 1500);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update department');
    }
  }

  async function handleToggleStatus(person: PersonRow) {
    setError(null);
    const nextStatus = person.status === 'active' ? 'inactive' : 'active';
    try {
      await callAdminDirectory({ action: 'update_person', personId: person.id, status: nextStatus });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  }

  async function handleOpenJoinQr() {
    if (!propertyId) return;
    const url = `${window.location.origin}/join/${propertyId}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 260, margin: 2 });
    setJoinQrDataUrl(dataUrl);
  }

  if (!propertyId) {
    return (
      <AdminLayout title="People">
        <div className="bg-white border border-[#E7DDD0] rounded-xl p-5 text-sm text-[#5C4B3E]">
          Select a property using the Super Admin Property Switcher to manage staff.
        </div>
      </AdminLayout>
    );
  }

  const ft15DeptMgr = toggles.department_manager_role ?? true;
  const ft23JoinQr = toggles.join_qr ?? true;

  const filtered = people.filter((p) => {
    const matchesSearch =
      !search.trim() ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.email.toLowerCase().includes(search.toLowerCase());
    const matchesDept = !deptFilter || p.departmentId === deptFilter;
    return matchesSearch && matchesDept;
  });

  return (
    <AdminLayout title="People">
      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-xs text-[#047857]">
          {notice}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#7A6859] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email..."
              className="rounded-lg border border-[#D8CBB8] bg-white pl-8 pr-3 py-1.5 text-xs outline-none focus:border-[#B8863B]"
            />
          </div>

          <select
            aria-label="Filter by department"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="rounded-lg border border-[#D8CBB8] bg-white px-2.5 py-1.5 text-xs"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {ft23JoinQr && (
            <button
              type="button"
              onClick={() => void handleOpenJoinQr()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CBB8] bg-white px-3 py-1.5 text-xs font-medium text-[#1C110A] hover:bg-[#F3F4F6] cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Join QR</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A1A10] text-white px-3.5 py-1.5 text-xs font-medium hover:bg-[#3D281B] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Person</span>
          </button>
        </div>
      </div>

      {/* People Table */}
      <section className="bg-white border border-[#E7DDD0] rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#E7DDD0] bg-[#F9FAFB] text-[#5C4B3E]">
              <th className="py-3 px-4 font-medium">Name</th>
              <th className="py-3 px-4 font-medium">Role</th>
              <th className="py-3 px-4 font-medium">Department</th>
              <th className="py-3 px-4 font-medium">Account</th>
              <th className="py-3 px-4 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {filtered.map((p) => (
              <tr key={p.id} className="hover:bg-[#F9FAFB]">
                <td className="py-3 px-4">
                  <p className="font-semibold text-[#1C110A]">{p.name}</p>
                  <p className="text-[#7A6859]">{p.email}</p>
                </td>
                <td className="py-3 px-4 capitalize">{p.role.replace('_', ' ')}</td>
                <td className="py-3 px-4">
                  {p.role === 'property_admin' ? (
                    <span className="text-[#7A6859]">All Departments</span>
                  ) : (
                    <div className="inline-flex items-center gap-2">
                      <select
                        value={p.departmentId ?? ''}
                        onChange={(e) => void handleMoveDept(p.id, e.target.value)}
                        className="rounded-md border border-[#D8CBB8] bg-white px-2 py-1 text-xs"
                      >
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      {savedId === p.id && (
                        <span className="text-[#047857] font-medium">Saved</span>
                      )}
                    </div>
                  )}
                </td>
                <td className="py-3 px-4">
                  {p.authLinked ? 'Claimed' : 'Unclaimed (Join QR / Invite)'}
                </td>
                <td className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => void handleToggleStatus(p)}
                    className={`rounded-full border px-2.5 py-0.5 font-medium capitalize cursor-pointer ${
                      p.status === 'active'
                        ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
                        : 'bg-[#F3F4F6] text-[#5C4B3E] border-[#D8CBB8]'
                    }`}
                  >
                    {p.status}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Add Person Drawer */}
      {addOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 flex justify-end">
          <form
            onSubmit={handleAddPerson}
            className="w-full max-w-md bg-white h-full p-6 flex flex-col justify-between"
          >
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-[#E7DDD0] pb-3">
                <h2 className="text-base font-semibold text-[#1C110A]">Add Team Member</h2>
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="p-1.5 rounded-lg border border-[#D8CBB8] text-[#5C4B3E] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <label className="block space-y-1">
                <span className="font-medium text-[#374151]">Full Name</span>
                <input
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Rosa Martinez"
                  className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
                />
              </label>

              <label className="block space-y-1">
                <span className="font-medium text-[#374151]">Email Address</span>
                <input
                  required
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="rosa@hotel.com"
                  className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
                />
              </label>

              <label className="block space-y-1">
                <span className="font-medium text-[#374151]">Role</span>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'staff' | 'dept_manager')}
                  className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm bg-white"
                >
                  <option value="staff">Frontline Staff</option>
                  {ft15DeptMgr && <option value="dept_manager">Department Manager</option>}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="font-medium text-[#374151]">Department</span>
                <select
                  required
                  value={newDeptId}
                  onChange={(e) => setNewDeptId(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm bg-white"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-[#2A1A10] text-white py-2.5 text-xs font-medium hover:bg-[#3D281B] cursor-pointer"
            >
              Create Account
            </button>
          </form>
        </div>
      )}

      {/* Join QR Modal */}
      {joinQrDataUrl && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E7DDD0] p-6 max-w-sm w-full space-y-4 text-center">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#1C110A]">Staff Join QR Code</h2>
              <button
                type="button"
                onClick={() => setJoinQrDataUrl(null)}
                className="p-1 rounded-lg border border-[#D8CBB8] text-[#5C4B3E] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={joinQrDataUrl}
              alt="Property Join QR Code"
              className="mx-auto rounded-xl border border-[#E7DDD0]"
            />
            <p className="text-xs text-[#5C4B3E]">
              New staff scan this QR to pick their name, verify their email OTP, set a password, and sign the Staff Agreement.
            </p>
            <a
              href={joinQrDataUrl}
              download={`join-qr-${propertyId}.png`}
              className="inline-block rounded-lg bg-[#2A1A10] text-white px-4 py-2 text-xs font-medium"
            >
              Download Join QR PNG
            </a>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
