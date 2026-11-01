import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { AuditPage } from "./pages/AuditPage";
import { BankPage } from "./pages/BankPage";
import { ChargesPage } from "./pages/ChargesPage";
import { AnnouncementsPage, DecisionsPage } from "./pages/CommunicationPages";
import { DashboardPage } from "./pages/DashboardPage";
import { FuelPage } from "./pages/FuelPage";
import { LoginPage } from "./pages/LoginPage";
import { UnitsPage } from "./pages/ManagementPages";
import { ResidentsPage } from "./pages/ResidentsPage";
import { ExpensesPage } from "./pages/MorePages";
import { KurumPage } from "./pages/KurumPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { PersonnelPage } from "./pages/PersonnelPage";
import { ReportsPage } from "./pages/ReportsPage";
import { AppLayout } from "./pages/shell";
import { TicketsPage } from "./pages/TicketsPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/finance/bank" element={<BankPage />} />
          <Route path="/finance/charges" element={<ChargesPage />} />
          <Route path="/finance/payments" element={<PaymentsPage />} />
          <Route path="/finance/expenses" element={<ExpensesPage />} />
          <Route path="/finance/reports" element={<ReportsPage />} />
          <Route path="/management/units" element={<UnitsPage />} />
          <Route path="/management/residents" element={<ResidentsPage />} />
          <Route path="/management/employees" element={<PersonnelPage />} />
          <Route path="/operations/tickets" element={<TicketsPage />} />
          <Route path="/operations/fuel" element={<FuelPage />} />
          <Route path="/communication/announcements" element={<AnnouncementsPage />} />
          <Route path="/communication/decisions" element={<DecisionsPage />} />
          <Route path="/settings" element={<KurumPage />} />
          <Route path="/settings/audit" element={<AuditPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
