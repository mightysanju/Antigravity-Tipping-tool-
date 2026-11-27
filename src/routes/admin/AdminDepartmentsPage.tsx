import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { AdminLayout } from '../../components/AdminLayout';
import { useAuth } from '../../auth/AuthContext';
import { usePropertySwitcher } from '../../auth/PropertySwitcherContext';
import { callAdminDirectory, callDeleteDepartment } from '../../lib/apiClient';

interface DepartmentRow {
  id: string;
  propertyId: string;
  name: string;
  isHousekeeping: boolean;
  defaultDistribution: 'split' | 'individual';
  peopleCount: number;
}

export function AdminDepartmentsPage() {
  const { user } = useAuth();
  const { activeProperty } = usePropertySwitcher();
  const propertyId =
    user?.role === 'super_admin' ? activeProperty?.id ?? null : user?.propertyId ?? null;

  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add / Rename Form State
  const [newName, setNewName] = useState('');
  const [newDist, setNewDist] = useState<'split' | 'individual'>('split');
  const [newIsHk, setNewIsHk] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDist, setEditDist] = useState<'split' | 'individual'>('split');

  // AC-8 Forced Reassignment Drawer State
  const [deleteTarget, setDeleteTarget] = useState<DepartmentRow | null>(null);
  const [reassignToId, setReassignToId] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await callAdminDirectory<{ departments: DepartmentRow[] }>({
        action: 'list_departments',
        propertyId,
      });
      setDepartments(res.departments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load departments');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId || !newName.trim()) return;
    setError(null);
    try {
      await callAdminDirectory({
        action: 'upsert_department',
        propertyId,
        departmentId: null,
        name: newName.trim(),
        isHousekeeping: newIsHk,
        defaultDistribution: newDist,
      });
      setNewName('');
      setNewIsHk(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add department');
    }
  }

  async function handleSaveEdit(dept: DepartmentRow) {
    if (!propertyId || !editName.trim()) return;
    setError(null);
    try {
      await callAdminDirectory({
        action: 'upsert_department',
        propertyId,
        departmentId: dept.id,
        name: editName.trim(),
        isHousekeeping: dept.isHousekeeping,
        defaultDistribution: editDist,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update department');
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.peopleCount > 0 && !reassignToId) return;
    setError(null);
    setDeleting(true);
    try {
      await callDeleteDepartment({
        departmentId: deleteTarget.id,
        reassignToDepartmentId: deleteTarget.peopleCount > 0 ? reassignToId : null,
      });
      setDeleteTarget(null);
      setReassignToId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete department');
    } finally {
      setDeleting(false);
    }
  }

  if (!propertyId) {
    return (
      <AdminLayout title="Departments">
        <div className="bg-white border border-[#E7DDD0] rounded-xl p-5 text-sm text-[#5C4B3E]">
          Select a property using the Super Admin Property Switcher to manage its departments.
        </div>
      </AdminLayout>
    );
  }

  const reassignChoices = deleteTarget
    ? departments.filter((d) => d.id !== deleteTarget.id)
    : [];

  return (
    <AdminLayout title="Departments">
      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {/* Add Department Form */}
      <form
        onSubmit={handleAdd}
        className="bg-white border border-[#E7DDD0] rounded-xl p-4 flex flex-wrap items-end gap-3 text-xs"
      >
        <label className="flex-1 min-w-[180px] space-y-1">
          <span className="font-medium text-[#374151]">New Department Name</span>
          <input
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Concierge & Bell"
            className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-1">
          <span className="font-medium text-[#374151]">Default Pool Split</span>
          <select
            value={newDist}
            onChange={(e) => setNewDist(e.target.value as 'split' | 'individual')}
            className="rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm bg-white"
          >
            <option value="split">Split Evenly</option>
            <option value="individual">Individual Amounts</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 py-2 cursor-pointer text-[#374151]">
          <input
            type="checkbox"
            checked={newIsHk}
            onChange={(e) => setNewIsHk(e.target.checked)}
          />
          <span>Housekeeping</span>
        </label>

        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A1A10] text-white px-4 py-2 text-xs font-medium hover:bg-[#3D281B] cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Department</span>
        </button>
      </form>

      {/* Departments Table */}
      <section className="bg-white border border-[#E7DDD0] rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#E7DDD0] bg-[#F9FAFB] text-[#5C4B3E]">
              <th className="py-3 px-4 font-medium">Department</th>
              <th className="py-3 px-4 font-medium">Pool Default</th>
              <th className="py-3 px-4 font-medium text-right">Assigned Staff</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {loading && (
              <tr>
                <td colSpan={4} className="py-8 px-4 text-center text-[#7A6859]">
                  Loading departments...
                </td>
              </tr>
            )}
            {departments.map((dept) => (
              <tr key={dept.id} className="hover:bg-[#F9FAFB]">
                <td className="py-3 px-4">
                  {editingId === dept.id ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="rounded-md border border-[#D8CBB8] px-2.5 py-1 text-xs"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#1C110A]">{dept.name}</span>
                      {dept.isHousekeeping && (
                        <span className="rounded-full bg-[#F5E1C3]/45 text-[#8C5E1A] px-2 py-0.5 font-medium">
                          Housekeeping
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="py-3 px-4">
                  {editingId === dept.id ? (
                    <select
                      value={editDist}
                      onChange={(e) => setEditDist(e.target.value as 'split' | 'individual')}
                      className="rounded-md border border-[#D8CBB8] px-2 py-1 text-xs bg-white"
                    >
                      <option value="split">Split Evenly</option>
                      <option value="individual">Individual</option>
                    </select>
                  ) : (
                    <span className="capitalize">
                      {dept.defaultDistribution === 'split' ? 'Split Evenly' : 'Individual'}
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-right tabular-nums font-medium">{dept.peopleCount}</td>
                <td className="py-3 px-4 text-right">
                  {editingId === dept.id ? (
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveEdit(dept)}
                        className="rounded-md bg-[#2A1A10] text-white px-2.5 py-1 font-medium cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-md border border-[#D8CBB8] px-2.5 py-1 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(dept.id);
                          setEditName(dept.name);
                          setEditDist(dept.defaultDistribution);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-[#D8CBB8] px-2.5 py-1 font-medium text-[#1C110A] hover:bg-[#F3F4F6] cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Rename</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteTarget(dept);
                          setReassignToId('');
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C] px-2.5 py-1 font-medium hover:bg-[#FEE2E2] cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* AC-8 Forced Reassignment Drawer */}
      {deleteTarget && (
        <div className="fixed inset-0 z-40 bg-black/40 flex justify-end">
          <div className="w-full max-w-md bg-white h-full p-6 flex flex-col justify-between">
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-[#E7DDD0] pb-3">
                <h2 className="text-base font-semibold text-[#1C110A]">
                  Delete {deleteTarget.name}
                </h2>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="p-1.5 rounded-lg border border-[#D8CBB8] text-[#5C4B3E] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {deleteTarget.peopleCount > 0 ? (
                <div className="space-y-3">
                  <p className="rounded-lg border border-[#FDE68A] bg-[#FEF3C7] p-3 text-[#92400E]">
                    <strong>{deleteTarget.peopleCount}</strong> team member(s) are currently
                    assigned to <strong>{deleteTarget.name}</strong>. Choose a target department to
                    reassign them before deleting.
                  </p>
                  <label className="block space-y-1">
                    <span className="font-medium text-[#374151]">Reassign Staff To</span>
                    <select
                      value={reassignToId}
                      onChange={(e) => setReassignToId(e.target.value)}
                      className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm bg-white"
                    >
                      <option value="">Select target department...</option>
                      {reassignChoices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : (
                <p className="text-[#5C4B3E]">
                  No team members are assigned to {deleteTarget.name}. Confirm to delete it permanently.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-lg border border-[#D8CBB8] py-2 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  deleting || (deleteTarget.peopleCount > 0 && !reassignToId)
                }
                onClick={() => void handleConfirmDelete()}
                className="flex-1 rounded-lg bg-[#B91C1C] text-white py-2 text-xs font-medium hover:bg-[#991B1B] disabled:opacity-40 cursor-pointer"
              >
                {deleting
                  ? 'Deleting...'
                  : deleteTarget.peopleCount > 0
                    ? 'Confirm Reassign & Delete'
                    : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
