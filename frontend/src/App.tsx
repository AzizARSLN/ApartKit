import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { BankPage } from "./pages/BankPage";
import { ChargesPage } from "./pages/ChargesPage";
import { LoginPage } from "./pages/LoginPage";
import { UnitsPage } from "./pages/ManagementPages";
import { ResidentsPage } from "./pages/ResidentsPage";
import { ExpensesPage, PaymentsPage, TicketsPage } from "./pages/MorePages";
import { KurumPage } from "./pages/KurumPage";
import { AppLayout, DashboardPage } from "./pages/shell";

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
          <Route path="/management/units" element={<UnitsPage />} />
          <Route path="/management/residents" element={<ResidentsPage />} />
          <Route path="/operations/tickets" element={<TicketsPage />} />
          <Route path="/settings" element={<KurumPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
