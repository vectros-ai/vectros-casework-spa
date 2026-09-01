// ---------------------------------------------------------------------------
// App — the route table.
//
// Structure:
//   - `/login` — kicks off Auth0 Universal Login. No RequireAuth, no chrome.
//   - `/accept` — first-login invite acceptance. No RequireAuth, no chrome.
//   - `/callback` — Auth0's redirect-back target, shared by both flows above. No RequireAuth, no chrome.
//   - A layout route wrapping RequireAuth + AppLayout for everything else.
//   - A catch-all `*` renders a dedicated 404.
//
// BrowserRouter is provided by main.tsx (NOT here), so tests can render
// <App /> inside a <MemoryRouter> with a controlled initial URL.
// ---------------------------------------------------------------------------

import { Route, Routes } from 'react-router';
import HomeIcon from '@mui/icons-material/Home';
import BusinessIcon from '@mui/icons-material/Business';
import FolderIcon from '@mui/icons-material/Folder';
import GroupIcon from '@mui/icons-material/Group';
import PeopleIcon from '@mui/icons-material/People';
import SearchIcon from '@mui/icons-material/Search';

import { AppLayout, RequireAuth, RequireScope } from '@vectros-ai/react';
import type { NavItemSpec } from '@vectros-ai/react';
import { BRAND } from './brand';
import { EXCHANGE_RESOLVED_TENANT } from './api/vectrosApi';
import { AccountPage } from './pages/protected/AccountPage';
import { HomePage } from './pages/protected/HomePage';
import { OrgsListPage } from './pages/protected/orgs/OrgsListPage';
import { OrgDetailPage } from './pages/protected/orgs/OrgDetailPage';
import { CasesListPage } from './pages/protected/cases/CasesListPage';
import { CaseDetailPage } from './pages/protected/cases/CaseDetailPage';
import { ClientsListPage } from './pages/protected/clients/ClientsListPage';
import { ClientDetailPage } from './pages/protected/clients/ClientDetailPage';
import { TeamPage } from './pages/protected/team/TeamPage';
import { SearchPage } from './pages/protected/search/SearchPage';
import { AcceptInvitePage } from './pages/public/AcceptInvitePage';
import { CallbackPage } from './pages/public/CallbackPage';
import { LoginPage } from './pages/public/LoginPage';
import { NotFoundPage } from './pages/public/NotFoundPage';
import { CASES_ACTION, CLIENTS_ACTION, ORGS_ACTION, SEARCH_ACTION, TEAM_ACTION } from './lib/scopeActions';

const NAV_ITEMS: ReadonlyArray<NavItemSpec> = [
  { to: '/', labelId: 'layout.navWelcome', gateAction: null, icon: <HomeIcon fontSize="small" /> },
  { to: '/search', labelId: 'layout.navSearch', gateAction: SEARCH_ACTION, icon: <SearchIcon fontSize="small" /> },
  { to: '/cases', labelId: 'layout.navCases', gateAction: CASES_ACTION, icon: <FolderIcon fontSize="small" /> },
  { to: '/clients', labelId: 'layout.navClients', gateAction: CLIENTS_ACTION, icon: <PeopleIcon fontSize="small" /> },
  { to: '/orgs', labelId: 'layout.navOrgs', gateAction: ORGS_ACTION, icon: <BusinessIcon fontSize="small" /> },
  { to: '/team', labelId: 'layout.navTeam', gateAction: TEAM_ACTION, icon: <GroupIcon fontSize="small" /> },
];

export default function App(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept" element={<AcceptInvitePage />} />
      <Route path="/callback" element={<CallbackPage />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout
              brandName={BRAND.productName}
              navItems={NAV_ITEMS}
              scopeGateTenant={EXCHANGE_RESOLVED_TENANT}
            />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route
          path="/search"
          element={
            <RequireScope action={SEARCH_ACTION} tenantOverride={EXCHANGE_RESOLVED_TENANT}>
              <SearchPage />
            </RequireScope>
          }
        />
        <Route
          path="/cases"
          element={
            <RequireScope action={CASES_ACTION} tenantOverride={EXCHANGE_RESOLVED_TENANT}>
              <CasesListPage />
            </RequireScope>
          }
        />
        <Route
          path="/cases/:id"
          element={
            <RequireScope action={CASES_ACTION} tenantOverride={EXCHANGE_RESOLVED_TENANT}>
              <CaseDetailPage />
            </RequireScope>
          }
        />
        <Route
          path="/clients"
          element={
            <RequireScope action={CLIENTS_ACTION} tenantOverride={EXCHANGE_RESOLVED_TENANT}>
              <ClientsListPage />
            </RequireScope>
          }
        />
        <Route
          path="/clients/:id"
          element={
            <RequireScope action={CLIENTS_ACTION} tenantOverride={EXCHANGE_RESOLVED_TENANT}>
              <ClientDetailPage />
            </RequireScope>
          }
        />
        <Route
          path="/orgs"
          element={
            <RequireScope action={ORGS_ACTION} tenantOverride={EXCHANGE_RESOLVED_TENANT}>
              <OrgsListPage />
            </RequireScope>
          }
        />
        <Route
          path="/orgs/:id"
          element={
            <RequireScope action={ORGS_ACTION} tenantOverride={EXCHANGE_RESOLVED_TENANT}>
              <OrgDetailPage />
            </RequireScope>
          }
        />
        <Route
          path="/team"
          element={
            <RequireScope action={TEAM_ACTION} tenantOverride={EXCHANGE_RESOLVED_TENANT}>
              <TeamPage />
            </RequireScope>
          }
        />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
