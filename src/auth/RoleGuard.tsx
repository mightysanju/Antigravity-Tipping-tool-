import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { getRoleHomeRoute, type AppRole } from '../shared/types';

interface RoleGuardProps {
  allowedRoles: readonly AppRole[];
  children: ReactNode;
}

/**
 * Enforces Section 15 route isolation (L224):
 * - Unauthenticated users redirect to /login.
 * - Authenticated users outside `allowedRoles` redirect immediately to their own home screen.
 */
export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1C110A] text-[#FAF6F0] text-sm">
        Loading workspace...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={getRoleHomeRoute(user.role)} replace />;
  }

  return <>{children}</>;
}
