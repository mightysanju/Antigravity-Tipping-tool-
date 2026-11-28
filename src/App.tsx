import { MotionConfig } from 'motion/react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { PropertySwitcherProvider } from './auth/PropertySwitcherContext';
import { RoleGuard } from './auth/RoleGuard';
import { DevPersonaBar } from './components/DevPersonaBar';
import { SuperAdminsPage } from './routes/super/SuperAdminsPage';
import { SuperDashboardPage } from './routes/super/SuperDashboardPage';
import { SuperPaymentsPage } from './routes/super/SuperPaymentsPage';
import { SuperPropertiesPage } from './routes/super/SuperPropertiesPage';
import { AdminDepartmentsPage } from './routes/admin/AdminDepartmentsPage';
import { AdminPeoplePage } from './routes/admin/AdminPeoplePage';
import { AdminRoomsPage } from './routes/admin/AdminRoomsPage';
import { AdminAssignmentsPage } from './routes/admin/AdminAssignmentsPage';
import { AdminTipsPage } from './routes/admin/AdminTipsPage';
import { GuestTipPage } from './routes/guest/GuestTipPage';
import { JoinPropertyPage } from './routes/auth/JoinPropertyPage';
import { LoginPage } from './routes/auth/LoginPage';
import { StaffPortalPage } from './routes/staff/StaffPortalPage';
import { SuperIntegrationsPage } from './routes/super/SuperIntegrationsPage';
import { LandingPage } from './routes/LandingPage';
import { getRoleHomeRoute } from './shared/types';

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={getRoleHomeRoute(user.role)} replace />;
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <PropertySwitcherProvider>
          <BrowserRouter>
            <Routes>
              {/* Guest Tipping Routes (Unauthenticated) */}
              <Route path="/tip/room/:roomId" element={<GuestTipPage sourceType="room" />} />
              <Route path="/tip/dept/:departmentId" element={<GuestTipPage sourceType="dept" />} />
              <Route path="/tip/person/:personId" element={<GuestTipPage sourceType="person" />} />

              {/* Auth & Join QR Routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/join/:propertyId" element={<JoinPropertyPage />} />

              {/* Staff Portal */}
              <Route
                path="/staff"
                element={
                  <RoleGuard allowedRoles={['staff']}>
                    <StaffPortalPage />
                  </RoleGuard>
                }
              />

              {/* Property Admin & Department Manager Routes */}
              <Route
                path="/admin/departments"
                element={
                  <RoleGuard allowedRoles={['property_admin', 'super_admin']}>
                    <AdminDepartmentsPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/people"
                element={
                  <RoleGuard allowedRoles={['property_admin', 'super_admin']}>
                    <AdminPeoplePage />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/rooms"
                element={
                  <RoleGuard allowedRoles={['property_admin', 'super_admin']}>
                    <AdminRoomsPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/assignments"
                element={
                  <RoleGuard allowedRoles={['property_admin', 'dept_manager', 'super_admin']}>
                    <AdminAssignmentsPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/admin/tips"
                element={
                  <RoleGuard allowedRoles={['property_admin', 'dept_manager', 'super_admin']}>
                    <AdminTipsPage />
                  </RoleGuard>
                }
              />

              {/* Super Admin Routes */}
              <Route
                path="/super/dashboard"
                element={
                  <RoleGuard allowedRoles={['super_admin']}>
                    <SuperDashboardPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/super/properties"
                element={
                  <RoleGuard allowedRoles={['super_admin']}>
                    <SuperPropertiesPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/super/payments"
                element={
                  <RoleGuard allowedRoles={['super_admin']}>
                    <SuperPaymentsPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/super/admins"
                element={
                  <RoleGuard allowedRoles={['super_admin']}>
                    <SuperAdminsPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/super/integrations"
                element={
                  <RoleGuard allowedRoles={['super_admin']}>
                    <SuperIntegrationsPage />
                  </RoleGuard>
                }
              />

              {/* Public Landing Page */}
              <Route path="/" element={<LandingPage />} />
              <Route path="*" element={<RootRedirect />} />
            </Routes>
            <DevPersonaBar />
          </BrowserRouter>
        </PropertySwitcherProvider>
      </AuthProvider>
    </MotionConfig>
  );
}

export default App;
