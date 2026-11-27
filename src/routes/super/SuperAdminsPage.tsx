import { useCallback, useEffect, useState } from 'react';
import { Plus, UserX, X } from 'lucide-react';
import { SuperAdminLayout } from '../../components/SuperAdminLayout';
import { callSuperAdmin } from '../../lib/apiClient';

interface AdminRow {
  id: string;
  propertyId: string;
  propertyName: string;
  propertyStatus: string;
  name: string;
  email: string;
  status: 'active' | 'inactive';
  authLinked: boolean;
  agreementSignedAt: string | null;
}

interface PropOption {
  id: string;
  name: string;
}

export function SuperAdminsPage() {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [properties, setProperties] = useState<PropOption[]>([]);
  const [filterPropertyId, setFilterPropertyId] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [invitePropId, setInvitePropId] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [adminsRes, dashRes] = await Promise.all([
        callSuperAdmin<{ admins: AdminRow[] }>({ action: 'list_admins' }),
        callSuperAdmin<{ properties: PropOption[] }>({ action: 'dashboard' }),
      ]);
      setAdmins(adminsRes.admins || []);
      setProperties(dashRes.properties || []);
      if (!invitePropId && dashRes.properties?.[0]) {
        setInvitePropId(dashRes.properties[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load property admins');
    }
  }, [invitePropId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await callSuperAdmin<{ emailSent: boolean; emailInviteEnabled: boolean }>({
        action: 'invite_admin',
        propertyId: invitePropId,
        name: inviteName,
        email: inviteEmail,
      });
      setNotice(
        res.emailSent
          ? `Added ${inviteName} and sent invitation email.`
          : `Added ${inviteName} (email invites toggle is disabled for this property).`
      );
      setInviteName('');
      setInviteEmail('');
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite property admin');
    }
  }

  async function handleRemove(personId: string) {
    setError(null);
    try {
      await callSuperAdmin({ action: 'remove_admin', personId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove property admin');
    }
  }

  const visibleAdmins = filterPropertyId
    ? admins.filter((a) => a.propertyId === filterPropertyId)
    : admins;

  return (
    <SuperAdminLayout
      title="Property Admins"
      actions={
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A1A10] text-white px-3.5 py-2 text-xs font-medium hover:bg-[#3D281B] cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Invite Property Admin</span>
        </button>
      }
    >
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

      <div className="flex items-center justify-between">
        <select
          aria-label="Filter admins by property"
          value={filterPropertyId}
          onChange={(e) => setFilterPropertyId(e.target.value)}
          className="rounded-lg border border-[#D8CBB8] bg-white px-3 py-1.5 text-xs font-medium"
        >
          <option value="">All Properties ({admins.length})</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <section className="bg-white border border-[#E7DDD0] rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#E7DDD0] bg-[#F9FAFB] text-[#5C4B3E]">
              <th className="py-3 px-4 font-medium">Admin</th>
              <th className="py-3 px-4 font-medium">Property</th>
              <th className="py-3 px-4 font-medium">Onboarding</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {visibleAdmins.map((a) => (
              <tr key={a.id} className="hover:bg-[#F9FAFB]">
                <td className="py-3 px-4">
                  <p className="font-semibold text-[#1C110A]">{a.name}</p>
                  <p className="text-[#7A6859]">{a.email}</p>
                </td>
                <td className="py-3 px-4">{a.propertyName}</td>
                <td className="py-3 px-4">
                  {a.authLinked ? 'Claimed Account' : 'Awaiting First Sign-In'}
                </td>
                <td className="py-3 px-4 capitalize font-medium">{a.status}</td>
                <td className="py-3 px-4 text-right">
                  {a.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => void handleRemove(a.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C] px-2.5 py-1 font-medium hover:bg-[#FEE2E2] cursor-pointer"
                    >
                      <UserX className="w-3.5 h-3.5" />
                      <span>Deactivate</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 flex justify-end">
          <form
            onSubmit={handleInvite}
            className="w-full max-w-md bg-white h-full p-6 flex flex-col justify-between"
          >
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-[#E7DDD0] pb-3">
                <h2 className="text-base font-semibold text-[#1C110A]">Invite Property Admin</h2>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="p-1.5 rounded-lg border border-[#D8CBB8] text-[#5C4B3E] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <label className="block space-y-1">
                <span className="font-medium text-[#374151]">Property</span>
                <select
                  required
                  value={invitePropId}
                  onChange={(e) => setInvitePropId(e.target.value)}
                  className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm bg-white"
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="font-medium text-[#374151]">Full Name</span>
                <input
                  required
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
                />
              </label>

              <label className="block space-y-1">
                <span className="font-medium text-[#374151]">Email Address</span>
                <input
                  required
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="alex.rivera@hotel.com"
                  className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
                />
              </label>
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-[#2A1A10] text-white py-2.5 text-xs font-medium hover:bg-[#3D281B] cursor-pointer"
            >
              Send Property Admin Invite
            </button>
          </form>
        </div>
      )}
    </SuperAdminLayout>
  );
}
